// 記法を畳む編集画面（0.3.0）の webview の中身。CodeMirror 6。
//
// 原稿は `.re` の文字列のまま持ち、記法は「見せ方」（CodeMirror の装飾）で畳むだけ。文字列は 1 文字も
// 書き換えない。どこを畳むかは `src/core/fold.ts`（parser.ts を使う）が決める。保存・取り消し・dirty の印は
// VS Code の TextDocument のもの（ここでは取り消しの履歴を持たない）。
//
// VS Code 無しでも動く（tools/editor-harness.html から Playwright で開く）。`acquireVsCodeApi` が
// 無ければ、`window.__reviewAssistHost` に送ったものを溜める。
import { Annotation, ChangeSet, EditorSelection, EditorState, StateEffect, StateField, type StateEffectType, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, hoverTooltip, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { search, searchKeymap } from '@codemirror/search';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import type { EditorConfig } from '../core/editor-config.js';
import { refKey, wrapInline, type CompletionCandidate } from '../core/editing.js';
import type { DiagView, EditorData, HostMessage, LineCol, MarkView, RefLabel, TextChange, ViewMessage } from '../core/editor-protocol.js';
import { planFolds, type FoldPlan, type InlineFold } from '../core/fold.js';
import { stripInline } from '../core/parser.js';
import { css } from './style.js';

// ---------------------------------------------------------------------------
// 拡張とのやりとり

interface VsCodeApi {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}
declare const acquireVsCodeApi: (() => VsCodeApi) | undefined;

const api: VsCodeApi =
  typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : {
        postMessage: (m) => {
          const w = window as unknown as { __reviewAssistHost?: unknown[] };
          (w.__reviewAssistHost ??= []).push(m);
        },
        getState: () => undefined,
        setState: () => undefined,
      };

function post(message: ViewMessage): void {
  api.postMessage(message);
}

/** 拡張から来た変更（送り返さない）。 */
const fromHost = Annotation.define<boolean>();

// ---------------------------------------------------------------------------
// 状態

interface Shared {
  config: EditorConfig;
  refs: Record<string, RefLabel>;
  images: Record<string, string>;
  completions: CompletionCandidate[];
}

const setShared = StateEffect.define<Partial<Shared>>();
const sharedField = StateField.define<Shared>({
  create: () => ({ config: { hidx: 'hide', headingScale: [1], tableGap: 0 }, refs: {}, images: {}, completions: [] }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setShared)) value = { ...value, ...e.value };
    return value;
  },
});

/** 畳む一覧。文字列が変わったときだけ作り直す。 */
const planField = StateField.define<FoldPlan>({
  create: (state) => planFolds(state.doc.toString(), { tableGap: state.field(sharedField, false)?.config.tableGap ?? 0 }),
  update(plan, tr) {
    const gapChanged = tr.effects.some((e) => e.is(setShared) && e.value.config !== undefined);
    if (!tr.docChanged && !gapChanged) return plan;
    return planFolds(tr.state.doc.toString(), { tableGap: tr.state.field(sharedField).config.tableGap });
  },
});

// マーカーと診断。拡張から来た位置を、その後の編集で写しながら持つ。
interface Ranged<T> {
  from: number;
  to: number;
  item: T;
}
const setMarks = StateEffect.define<Ranged<MarkView>[]>();
const setDiags = StateEffect.define<Ranged<DiagView>[]>();

function rangedField<T>(effect: StateEffectType<Ranged<T>[]>) {
  return StateField.define<Ranged<T>[]>({
    create: () => [],
    update(value, tr) {
      for (const e of tr.effects) if (e.is(effect)) return e.value;
      if (!tr.docChanged) return value;
      return value
        .map((r) => ({ ...r, from: tr.changes.mapPos(r.from, 1), to: tr.changes.mapPos(r.to, -1) }))
        .filter((r) => r.to >= r.from);
    },
  });
}
const marksField = rangedField<MarkView>(setMarks);
const diagsField = rangedField<DiagView>(setDiags);

// ---------------------------------------------------------------------------
// 札などの小さな部品

class ChipWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly cls: string,
    readonly title = ''
  ) {
    super();
  }
  override eq(other: ChipWidget): boolean {
    return other.text === this.text && other.cls === this.cls && other.title === this.title;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = `cm-ra-chip ${this.cls}`;
    el.textContent = this.text;
    if (this.title) el.title = this.title;
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

/** 何も出さない（記法の印を隠す）。 */
const hide = Decoration.replace({});

class PadWidget extends WidgetType {
  constructor(readonly width: number) {
    super();
  }
  override eq(other: PadWidget): boolean {
    return other.width === this.width;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-ra-tab';
    el.style.width = `${this.width}ch`;
    return el;
  }
}

class BulletWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }
  override eq(other: BulletWidget): boolean {
    return other.text === this.text;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-ra-bullet';
    el.textContent = this.text;
    return el;
  }
}

class HeaderWidget extends WidgetType {
  constructor(
    readonly kind: string,
    readonly id: string,
    readonly caption: string
  ) {
    super();
  }
  override eq(other: HeaderWidget): boolean {
    return other.kind === this.kind && other.id === this.id && other.caption === this.caption;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-ra-head';
    if (this.kind) {
      const k = document.createElement('span');
      k.className = 'cm-ra-chip cm-ra-chip-kind';
      k.textContent = this.kind;
      el.appendChild(k);
    }
    if (this.id) {
      const k = document.createElement('span');
      k.className = 'cm-ra-chip cm-ra-chip-id';
      k.textContent = this.id;
      el.appendChild(k);
    }
    if (this.caption) {
      const c = document.createElement('span');
      c.className = 'cm-ra-caption';
      c.textContent = this.caption;
      el.appendChild(c);
    }
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

class RuleWidget extends WidgetType {
  constructor(readonly label: string) {
    super();
  }
  override eq(other: RuleWidget): boolean {
    return other.label === this.label;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-ra-rule';
    if (this.label) el.textContent = this.label;
    return el;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | undefined,
    readonly id: string,
    readonly scale: number | undefined
  ) {
    super();
  }
  override eq(other: ImageWidget): boolean {
    return other.src === this.src && other.id === this.id && other.scale === this.scale;
  }
  override toDOM(): HTMLElement {
    const el = document.createElement('div');
    el.className = 'cm-ra-figure';
    if (this.src) {
      const img = document.createElement('img');
      img.src = this.src;
      img.alt = this.id;
      // `scale=` は本文の幅に対する比（Re:VIEW の `//image` の第 3 引数）。そのまま幅の比にする。
      if (this.scale !== undefined) img.style.width = `${this.scale * 100}%`;
      el.appendChild(img);
    } else {
      el.textContent = `（図 ${this.id} の PNG がありません）`;
      el.classList.add('cm-ra-missing');
    }
    return el;
  }
  override get estimatedHeight(): number {
    return -1;
  }
}

const OP_LABEL: Record<string, string> = { chap: '章', hd: '節', table: '表', list: 'リスト', img: '図', fn: '脚注' };
const LOOK_LABEL: Record<string, string> = { list: 'リスト', listnum: 'リスト', emlist: '', emlistnum: '', cmd: 'cmd', source: 'ソース', table: '表', image: '図' };

// ---------------------------------------------------------------------------
// 畳む

/** 選択のどれかが [from, to] に触れている（端も含む。隣にカーソルを置けば記法が出る）。 */
function touched(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) if (r.from <= to && r.to >= from) return true;
  return false;
}

function lineTouched(state: EditorState, line: number): boolean {
  const l = state.doc.line(line + 1);
  return touched(state, l.from, l.to);
}

function inlineDecos(it: InlineFold, shared: Shared, out: Range<Decoration>[]): void {
  const hideEscapes = () => {
    for (const e of it.escapes) out.push(hide.range(e, e + 1));
  };
  switch (it.op) {
    case 'code':
    case 'b': {
      out.push(hide.range(it.from, it.argFrom));
      if (it.argTo > it.argFrom) out.push(Decoration.mark({ class: it.op === 'code' ? 'cm-ra-code' : 'cm-ra-bold' }).range(it.argFrom, it.argTo));
      hideEscapes();
      out.push(hide.range(it.argTo, it.to));
      return;
    }
    case 'hidx':
      if (shared.config.hidx === 'faint') out.push(Decoration.mark({ class: 'cm-ra-faint' }).range(it.from, it.to));
      else out.push(hide.range(it.from, it.to));
      return;
    case 'embed':
      out.push(Decoration.replace({ widget: new ChipWidget('embed', 'cm-ra-chip-embed', it.arg) }).range(it.from, it.to));
      return;
    case 'br':
      out.push(Decoration.replace({ widget: new ChipWidget('↵', 'cm-ra-chip-br', '@<br>{}') }).range(it.from, it.to));
      return;
    case 'href': {
      const labelFrom = it.comma !== undefined ? it.comma + 1 : it.argFrom;
      out.push(hide.range(it.from, labelFrom));
      if (it.argTo > labelFrom) out.push(Decoration.mark({ class: 'cm-ra-link', attributes: { title: it.arg.split(',')[0] } }).range(labelFrom, it.argTo));
      for (const e of it.escapes) if (e >= labelFrom) out.push(hide.range(e, e + 1));
      out.push(hide.range(it.argTo, it.to));
      return;
    }
    default: {
      const label = shared.refs[refKey(it.op, it.arg)];
      const head = OP_LABEL[it.op] ?? it.op;
      const cls = label === undefined ? 'cm-ra-chip-ref' : label.ok ? 'cm-ra-chip-ref' : 'cm-ra-chip-broken';
      const text = `${head} ${label?.text ?? it.arg}`;
      const title = `@<${it.op}>{${it.arg}}${label && !label.ok ? (label.ambiguous ? '（曖昧）' : '（先が見つからない）') : ''}`;
      out.push(Decoration.replace({ widget: new ChipWidget(text, cls, title) }).range(it.from, it.to));
    }
  }
}

function buildFolds(state: EditorState): DecorationSet {
  const plan = state.field(planField);
  const shared = state.field(sharedField);
  const out: Range<Decoration>[] = [];
  /** 頭の行を札に置き換えた行（その行のインライン命令は畳まない。札が覆っている）。 */
  const coveredLines = new Set<number>();
  const doc = state.doc;
  const lineFrom = (ln: number) => doc.line(ln + 1).from;

  for (const it of plan.items) {
    if (it.t !== 'directive') continue;
    const revealed = lineTouched(state, it.line);
    const lf = lineFrom(it.line);
    out.push(Decoration.line({ class: `cm-ra-dir cm-ra-dir-${it.look}` }).range(lf));
    if (it.look === 'image') {
      const scaleArg = it.args.find((a) => /^scale=/.test(a));
      const scale = scaleArg ? Number(scaleArg.slice('scale='.length)) : undefined;
      const lineEnd = doc.line(it.line + 1).to;
      out.push(
        Decoration.widget({ widget: new ImageWidget(it.id ? shared.images[it.id] : undefined, it.id ?? '', Number.isFinite(scale) ? scale : undefined), block: true, side: 1 }).range(lineEnd)
      );
    }
    if (revealed || it.to === it.from) continue;
    coveredLines.add(it.line);
    const caption = it.caption !== undefined ? stripInline(it.caption) : '';
    switch (it.look) {
      case 'code':
      case 'table':
      case 'image':
        out.push(Decoration.replace({ widget: new HeaderWidget(LOOK_LABEL[it.name] ?? it.name, it.id ?? '', caption) }).range(it.from, it.to));
        break;
      case 'quote':
        out.push(Decoration.replace({ widget: new HeaderWidget('引用', '', '') }).range(it.from, it.to));
        break;
      case 'footnote':
        out.push(Decoration.replace({ widget: new HeaderWidget('脚注', it.id ?? '', caption) }).range(it.from, it.to));
        break;
      case 'pagebreak':
        out.push(Decoration.replace({ widget: new RuleWidget('改ページ') }).range(it.from, it.to));
        break;
      case 'tsize':
        out.push(Decoration.replace({ widget: new ChipWidget(`tsize ${it.args[0] ?? ''}`, 'cm-ra-chip-tsize') }).range(it.from, it.to));
        break;
    }
  }

  for (const it of plan.items) {
    switch (it.t) {
      case 'directive':
      case 'raw':
        break;
      case 'inline':
        if (coveredLines.has(it.line) || touched(state, it.from, it.to)) break;
        inlineDecos(it, shared, out);
        break;
      case 'heading': {
        const lf = lineFrom(it.line);
        out.push(Decoration.line({ class: `cm-ra-h cm-ra-h${Math.min(it.level, 6)}` }).range(lf));
        if (lineTouched(state, it.line) || it.markTo <= it.from) break;
        const chips = [it.modifier ? `[${it.modifier}]` : '', it.label ? `{${it.label}}` : ''].filter(Boolean).join(' ');
        out.push((chips ? Decoration.replace({ widget: new ChipWidget(chips, 'cm-ra-chip-label') }) : hide).range(it.from, it.markTo));
        break;
      }
      case 'comment':
        out.push(Decoration.line({ class: 'cm-ra-comment' }).range(lineFrom(it.line)));
        break;
      case 'list': {
        out.push(Decoration.line({ class: `cm-ra-li cm-ra-li-${it.kind}` }).range(lineFrom(it.line)));
        if (lineTouched(state, it.line)) break;
        // 深さは全角の空白で表す（字下げの幅を新しい数にしないため）。
        const text = it.kind === 'ul' ? `${'　'.repeat(it.depth - 1)}• ` : it.kind === 'ol' ? `${it.number ?? ''}. ` : '';
        out.push((text ? Decoration.replace({ widget: new BulletWidget(text) }) : hide).range(it.from, it.markerTo));
        if (it.kind === 'dl' && it.to > it.markerTo) out.push(Decoration.mark({ class: 'cm-ra-bold' }).range(it.markerTo, it.to));
        break;
      }
      case 'body':
        out.push(Decoration.line({ class: `cm-ra-body cm-ra-body-${it.look}` }).range(lineFrom(it.line)));
        break;
      case 'blockEnd':
        out.push(Decoration.line({ class: `cm-ra-end cm-ra-end-${it.look}` }).range(lineFrom(it.line)));
        if (!lineTouched(state, it.line) && it.to > it.from) out.push(hide.range(it.from, it.to));
        break;
      case 'tableRow': {
        out.push(Decoration.line({ class: `cm-ra-tr${it.header ? ' cm-ra-th' : ''}${it.firstColumnHeader ? ' cm-ra-th1' : ''}` }).range(lineFrom(it.line)));
        // タブは記法というより区切りなので、カーソルがあっても揃えたままにする（セルを打つ間に列が動かない）。
        for (const s of it.seps) out.push(Decoration.replace({ widget: new PadWidget(s.pad) }).range(s.from, s.to));
        break;
      }
      case 'tableRule':
        out.push(Decoration.line({ class: 'cm-ra-trule' }).range(lineFrom(it.line)));
        if (!lineTouched(state, it.line)) out.push(hide.range(it.from, it.to));
        break;
    }
  }
  return Decoration.set(out, true);
}

const foldField = StateField.define<DecorationSet>({
  create: (state) => buildFolds(state),
  update(value, tr) {
    if (!tr.docChanged && !tr.selection && !tr.effects.some((e) => e.is(setShared))) return value;
    return buildFolds(tr.state);
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** マーカーと診断の装飾。畳む装飾とは別の層（重なっても畳む方を邪魔しない）。 */
const overlayField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (!tr.docChanged && !tr.effects.some((e) => e.is(setMarks) || e.is(setDiags))) return value;
    const out: Range<Decoration>[] = [];
    for (const m of tr.state.field(marksField)) {
      if (m.to <= m.from) continue;
      const style = m.item.status === 'done' ? `text-decoration: underline dotted ${m.item.color}` : `background-color: ${m.item.background}`;
      out.push(Decoration.mark({ class: `cm-ra-mark cm-ra-mark-${m.item.status}`, attributes: { style } }).range(m.from, m.to));
    }
    for (const d of tr.state.field(diagsField)) {
      // 幅 0 の診断（行末など）は 1 文字分に広げる。広げられなければ出さない。
      let { from, to } = d;
      if (to <= from) {
        if (from < tr.state.doc.length) to = from + 1;
        else continue;
      }
      out.push(Decoration.mark({ class: `cm-ra-diag cm-ra-diag-${d.item.severity}` }).range(from, to));
    }
    return Decoration.set(out, true);
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// ホバー（マーカーの中身と操作、診断の文）

const markHover = hoverTooltip((view, pos) => {
  const marks = view.state.field(marksField).filter((m) => m.from <= pos && pos <= m.to);
  const diags = view.state.field(diagsField).filter((d) => d.from <= pos && pos <= Math.max(d.to, d.from + 1));
  if (marks.length === 0 && diags.length === 0) return null;
  const from = Math.min(...marks.map((m) => m.from), ...diags.map((d) => d.from));
  const to = Math.max(...marks.map((m) => m.to), ...diags.map((d) => d.to));
  return {
    pos: from,
    end: to,
    above: true,
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cm-ra-hover';
      for (const d of diags) {
        const p = document.createElement('div');
        p.className = `cm-ra-hover-diag cm-ra-hover-${d.item.severity}`;
        p.textContent = `${d.item.message}${d.item.source ? `（${d.item.source}）` : ''}`;
        dom.appendChild(p);
      }
      for (const m of marks) {
        const box = document.createElement('div');
        box.className = 'cm-ra-hover-mark';
        const title = document.createElement('div');
        title.innerHTML = '';
        const strong = document.createElement('strong');
        strong.textContent = m.item.kindLabel;
        title.appendChild(strong);
        title.appendChild(document.createTextNode(`（${m.item.status === 'done' ? '済み' : '未済'}）`));
        box.appendChild(title);
        if (m.item.note) {
          const n = document.createElement('div');
          n.textContent = `メモ: ${m.item.note}`;
          box.appendChild(n);
        }
        if (m.item.verdict) {
          const r = document.createElement('div');
          r.textContent = `AI: ${m.item.verdictLabel ?? m.item.verdict} ${m.item.comment ?? ''}`;
          box.appendChild(r);
          if (m.item.stale) {
            const s = document.createElement('div');
            s.textContent = '（AI が見た後で文が変わっている）';
            box.appendChild(s);
          }
          if (m.item.suggestion !== undefined) {
            const pre = document.createElement('pre');
            pre.textContent = m.item.suggestion;
            box.appendChild(pre);
          }
        }
        const actions = document.createElement('div');
        actions.className = 'cm-ra-hover-actions';
        const button = (label: string, command: string) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.addEventListener('click', () => post({ type: 'command', command, args: [m.item.id] }));
          actions.appendChild(b);
        };
        button(m.item.status === 'done' ? '未済に戻す' : '済みにする', 'reviewAssist.toggleMarkDone');
        button('メモ', 'reviewAssist.editMarkNote');
        if (m.item.hasSuggestion) button('案を当てる', 'reviewAssist.applySuggestion');
        button('外す', 'reviewAssist.removeMark');
        box.appendChild(actions);
        dom.appendChild(box);
      }
      return { dom };
    },
  };
});

// ---------------------------------------------------------------------------
// 参照の候補

function completionSource(context: CompletionContext): CompletionResult | null {
  const m = context.matchBefore(/@<(chap|hd|list|table|img)>\{[^}\s]*/);
  if (!m) return null;
  const op = /@<([a-z]+)>/.exec(m.text)![1];
  const from = m.from + m.text.indexOf('{') + 1;
  const candidates = context.state.field(sharedField).completions.filter((c) => c.op === op);
  return {
    from,
    options: candidates.map((c) => ({
      label: c.id,
      detail: c.detail,
      apply: (view: EditorView, _completion: unknown, f: number, t: number) => {
        const next = view.state.sliceDoc(t, t + 1);
        const insert = next === '}' ? c.id : `${c.id}}`;
        view.dispatch({ changes: { from: f, to: t, insert }, selection: { anchor: f + insert.length + (next === '}' ? 1 : 0) } });
      },
    })),
    validFor: /^[^}\s]*$/,
  };
}

// ---------------------------------------------------------------------------
// 拡張との同期

let view: EditorView | undefined;
let seq = 0;
/** 送ったが拡張がまだ当て終えていない編集（拡張から来た位置を写すため）。 */
let pending: { seq: number; changes: ChangeSet; startDoc: Text }[] = [];
let needSync = false;

function toLineCol(doc: Text, pos: number): LineCol {
  const l = doc.lineAt(pos);
  return { line: l.number - 1, col: pos - l.from };
}

function fromLineCol(doc: Text, lc: LineCol): number {
  const ln = Math.min(Math.max(lc.line, 0), doc.lines - 1);
  const l = doc.line(ln + 1);
  return l.from + Math.min(Math.max(lc.col, 0), l.length);
}

/** 拡張が `hostSeq` まで当てた時点の位置を、今の文書の位置に直す。 */
function mapper(hostSeq: number): (lc: LineCol, assoc: number) => number {
  const later = pending.filter((p) => p.seq > hostSeq);
  if (later.length === 0 || !view) {
    const doc = view!.state.doc;
    return (lc) => fromLineCol(doc, lc);
  }
  const base = later[0].startDoc;
  let changes = later[0].changes;
  for (const p of later.slice(1)) changes = changes.compose(p.changes);
  return (lc, assoc) => changes.mapPos(fromLineCol(base, lc), assoc);
}

function applyData(data: EditorData, hostSeq: number): void {
  if (!view) return;
  const effects: StateEffect<unknown>[] = [];
  const shared: Partial<Shared> = {};
  if (data.refs) shared.refs = data.refs;
  if (data.images) shared.images = data.images;
  if (data.completions) shared.completions = data.completions;
  if (Object.keys(shared).length > 0) effects.push(setShared.of(shared));
  const map = mapper(hostSeq);
  if (data.marks) effects.push(setMarks.of(data.marks.map((m) => ({ from: map(m.from, 1), to: map(m.to, -1), item: m }))));
  if (data.diagnostics) effects.push(setDiags.of(data.diagnostics.map((d) => ({ from: map(d.from, 1), to: map(d.to, -1), item: d }))));
  if (effects.length > 0) view.dispatch({ effects });
}

/** 拡張の側の文字列に合わせる（共通の頭と尻を残して、間だけ置き換える。カーソルは写る）。 */
function replaceText(text: string): void {
  if (!view) return;
  const cur = view.state.sliceDoc();
  if (cur === text) return;
  let a = 0;
  const max = Math.min(cur.length, text.length);
  while (a < max && cur.charCodeAt(a) === text.charCodeAt(a)) a++;
  let b = 0;
  while (b < max - a && cur.charCodeAt(cur.length - 1 - b) === text.charCodeAt(text.length - 1 - b)) b++;
  // CRLF の原稿では sliceDoc の位置と文書の位置が違うので、行と桁で直す。
  const eol = view.state.lineBreak;
  const toPos = (s: string, off: number) => {
    const before = s.slice(0, off).split(eol);
    return fromLineCol(view!.state.doc, { line: before.length - 1, col: before[before.length - 1].length });
  };
  view.dispatch({
    changes: { from: toPos(cur, a), to: toPos(cur, cur.length - b), insert: text.slice(a, text.length - b) },
    annotations: [fromHost.of(true)],
  });
}

const sendEdits = EditorView.updateListener.of((u) => {
  // tools/check-editor.mjs が打つときの遅さを測る口（VS Code の中では使わない）
  (window as unknown as { __reviewAssistOnUpdate?: (docChanged: boolean) => void }).__reviewAssistOnUpdate?.(u.docChanged);
  for (const tr of u.transactions) {
    if (!tr.docChanged || tr.annotation(fromHost)) continue;
    const changes: TextChange[] = [];
    const start = tr.startState.doc;
    tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
      changes.push({ from: toLineCol(start, fromA), to: toLineCol(start, toA), insert: inserted.toString() });
    });
    seq++;
    pending.push({ seq, changes: tr.changes, startDoc: start });
    post({ type: 'edit', seq, changes });
  }
  if (u.selectionSet) {
    const s = u.state.selection.main;
    post({ type: 'selection', anchor: toLineCol(u.state.doc, s.anchor), head: toLineCol(u.state.doc, s.head) });
  }
});

function onAck(hostSeq: number): void {
  pending = pending.filter((p) => p.seq > hostSeq);
  if (pending.length === 0 && needSync) {
    needSync = false;
    post({ type: 'sync' });
  }
}

function themeFor(config: EditorConfig): Extension {
  const rules: Record<string, Record<string, string>> = {};
  for (let i = 1; i <= 6; i++) {
    const s = config.headingScale[Math.min(i, config.headingScale.length) - 1];
    rules[`.cm-ra-h${i}`] = { fontSize: `${s}em` };
  }
  return EditorView.theme(rules);
}

function create(msg: Extract<HostMessage, { type: 'init' }>): void {
  const parent = document.getElementById('editor') ?? document.body;
  view?.destroy();
  pending = [];
  seq = msg.seq;
  const state = EditorState.create({
    doc: msg.text,
    extensions: [
      EditorState.lineSeparator.of(msg.eol),
      sharedField.init(() => ({ config: msg.config, refs: msg.refs ?? {}, images: msg.images ?? {}, completions: msg.completions ?? [] })),
      planField,
      foldField,
      marksField,
      diagsField,
      overlayField,
      EditorView.lineWrapping,
      keymap.of([...searchKeymap, ...defaultKeymap]),
      search({ top: true }),
      autocompletion({ override: [completionSource], activateOnTyping: true }),
      markHover,
      sendEdits,
      EditorView.baseTheme(css),
      themeFor(msg.config),
    ],
  });
  view = new EditorView({ state, parent });
  applyData(msg, msg.seq);
  // タブを裏に回すと webview は捨てられる（retainContextWhenHidden を使っていない）。戻ったときに
  // スクロールとカーソルを戻す。
  const saved = api.getState() as { top?: number; anchor?: number; head?: number } | undefined;
  if (saved?.anchor !== undefined && saved.head !== undefined && Math.max(saved.anchor, saved.head) <= view.state.doc.length) {
    view.dispatch({ selection: { anchor: saved.anchor, head: saved.head } });
  }
  if (saved?.top !== undefined) {
    const top = saved.top;
    requestAnimationFrame(() => view?.scrollDOM.scrollTo({ top }));
  }
  const remember = () => {
    if (!view) return;
    const sel = view.state.selection.main;
    api.setState({ top: view.scrollDOM.scrollTop, anchor: sel.anchor, head: sel.head });
  };
  view.scrollDOM.addEventListener('scroll', remember);
  view.contentDOM.addEventListener('keyup', remember);
  view.contentDOM.addEventListener('mouseup', remember);
  view.focus();
}

function onMessage(msg: HostMessage): void {
  switch (msg.type) {
    case 'init':
      create(msg);
      break;
    case 'text':
      if (pending.length > 0) needSync = true;
      else replaceText(msg.text);
      break;
    case 'ack':
      onAck(msg.seq);
      break;
    case 'data':
      applyData(msg, msg.seq);
      break;
    case 'wrap': {
      if (!view) break;
      const r = view.state.selection.main;
      const w = wrapInline(msg.op, view.state.sliceDoc(r.from, r.to));
      if (w === undefined) {
        post({ type: 'log', level: 'info', message: '行をまたぐ範囲はインライン命令で囲めません' });
        break;
      }
      view.dispatch({ changes: { from: r.from, to: r.to, insert: w }, selection: { anchor: r.from + w.length } });
      view.focus();
      break;
    }
    case 'insert': {
      if (!view) break;
      const at = view.state.selection.main.head;
      view.dispatch({ changes: { from: at, insert: msg.text }, selection: { anchor: at + msg.cursor } });
      view.focus();
      break;
    }
    case 'reveal': {
      if (!view) break;
      const from = fromLineCol(view.state.doc, msg.from);
      const to = fromLineCol(view.state.doc, msg.to);
      view.dispatch({ selection: EditorSelection.single(from, to), scrollIntoView: true });
      view.focus();
      break;
    }
  }
}

window.addEventListener('message', (e: MessageEvent) => {
  try {
    onMessage(e.data as HostMessage);
  } catch (err) {
    post({ type: 'log', level: 'error', message: err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err) });
    throw err;
  }
});

// Playwright（tools/check-editor.mjs）が中を見るための口。
(window as unknown as { __reviewAssist: unknown }).__reviewAssist = {
  get view() {
    return view;
  },
  plan: () => view?.state.field(planField),
  folds: () => view?.state.field(foldField),
  marks: () => view?.state.field(marksField).map((m) => ({ from: m.from, to: m.to, id: m.item.id })),
  diagnostics: () => view?.state.field(diagsField).map((d) => ({ from: d.from, to: d.to, message: d.item.message })),
  pending: () => pending.length,
};
(window as unknown as { __reviewAssistScroll: unknown }).__reviewAssistScroll = (pos: number) => EditorView.scrollIntoView(pos, { y: 'center' });
(window as unknown as { __reviewAssistPlan: unknown }).__reviewAssistPlan = (text: string) =>
  planFolds(text, { tableGap: view?.state.field(sharedField).config.tableGap ?? 0 });

post({ type: 'ready' });
