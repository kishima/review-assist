// 編集画面（0.3.0）に拡張の側から送るもの。参照の札に出す題、参照の候補、図の PNG の場所。
// 索引（ReviewIndex）を読むので webview の束には入らない。VS Code には依存しない。
import { refKey, type CompletionCandidate } from './editing.js';
import type { HeadingPage, LineCol, MarkView, RefLabel, TextChange } from './editor-protocol.js';
import { lookupPage, type PageIndex } from './pdfpages.js';
import { anchorMark, lineStarts, posAt, type AiResult, type MarksConfig, type MarksData } from './marks.js';
import type { ReviewIndex, Target } from './index.js';
import { readSecnolevel } from './booklayout.js';
import { buildPrintedIndex, type PrintedIndex } from './printed.js';
import { stripInline } from './parser.js';
import { imagePreviewPath, resolveRefDetailed } from './resolve.js';
import type { ParsedFile } from './types.js';


/**
 * その原稿にある参照の札を全部。同じ参照は 1 つにまとめる。札の文字は紙面に印刷されるもの（`第3章`、`「9.19 EXCEPT…」`、
 * `表3.1`、`*2`。規則は printed.ts）、参照先の題やキャプションは `title`（ホバー）。
 */
export function refLabels(index: ReviewIndex, parsed: ParsedFile, printed: PrintedIndex = buildPrintedIndex(index), secnolevel = readSecnolevel(index.root)): Record<string, RefLabel> {
  const out: Record<string, RefLabel> = {};
  for (const ref of parsed.refs) {
    if (!['chap', 'hd', 'table', 'list', 'img', 'fn'].includes(ref.op)) continue;
    const key = refKey(ref.op, ref.arg);
    if (out[key]) continue;
    const r = resolveRefDetailed(index, ref);
    if (r.kind === 'ambiguous') {
      out[key] = { text: ref.arg, ok: false, ambiguous: true };
      continue;
    }
    if (r.kind === 'miss') {
      out[key] = { text: ref.arg, ok: false };
      continue;
    }
    out[key] = printedLabel(index, printed, secnolevel, ref.op, r.target);
  }
  return out;
}

function printedLabel(index: ReviewIndex, printed: PrintedIndex, secnolevel: number, op: string, t: Target): RefLabel {
  const chap = t.chapter.id;
  const chapNo = printed.chapterNumber.get(chap);
  if (t.kind === 'chapter') {
    const title = index.headingsOfChapter(chap).find((h) => h.level === 1)?.plainTitle || chap;
    const label = printed.chapterLabel.get(chap) ?? '';
    // 番号の無い章（前付け・後付け）は Re:VIEW では空の文字列が印刷される。札が空では読めないので題を出す
    return { text: label || `「${title}」`, ok: true, title: `${label ? `${label} ` : ''}${title}` };
  }
  if (t.heading) {
    const h = t.heading;
    const nums = h.indexId !== undefined ? printed.headings.get(`${chap}|${h.indexId}`) : undefined;
    const number = chapNo !== undefined && nums ? [chapNo, ...nums].join('.') : undefined;
    const withNumber = number !== undefined && number.split('.').length <= secnolevel;
    return { text: withNumber ? `「${number} ${h.plainTitle}」` : `「${h.plainTitle}」`, ok: true, title: h.path.filter(Boolean).join(' > ') };
  }
  const b = t.block!;
  const caption = b.caption !== undefined ? stripInline(b.caption) : '';
  if (op === 'fn') {
    const n = printed.footnotes.get(`${chap}\u0000${b.id}`);
    return { text: n !== undefined ? `*${n}` : '*', ok: true, title: caption };
  }
  const group = op === 'list' ? 'list' : op === 'table' ? 'table' : 'image';
  const head = op === 'list' ? 'リスト' : op === 'table' ? '表' : '図';
  const seq = printed.blocks.get(`${chap}\u0000${group}\u0000${b.id}`);
  const number = seq === undefined ? b.id ?? '' : chapNo !== undefined ? `${chapNo}.${seq}` : String(seq);
  return { text: `${head}${number}`, ok: true, title: caption };
}

/**
 * 参照の候補。同じ章の中は id（見出しはラベル、無ければ索引の鍵）だけ、ほかの章は `章ID|id`
 * （Re:VIEW の `inline_hd` と `@<list>{chap|id}` の書き方）。`@<chap>` は章 ID。
 */
export function completionCandidates(index: ReviewIndex, file: string): CompletionCandidate[] {
  const own = index.chapterOfFile(file);
  const out: CompletionCandidate[] = [];
  for (const id of index.chapterOrder) {
    const top = index.headingsOfChapter(id).find((h) => h.level === 1);
    out.push({ op: 'chap', id, detail: top?.plainTitle ?? '' });
  }
  const blockOps: Record<string, string[]> = { list: ['list'], table: ['table', 'imgtable'], img: ['image', 'imgtable', 'indepimage'] };
  for (const chapter of index.chapterOrder) {
    const prefix = chapter === own ? '' : `${chapter}|`;
    for (const h of index.headingsOfChapter(chapter)) {
      if (h.indexId === undefined) continue;
      out.push({ op: 'hd', id: prefix + (h.label ?? h.indexId), detail: h.plainTitle });
    }
    for (const b of index.blocksOfChapter(chapter)) {
      if (!b.id) continue;
      for (const [op, kinds] of Object.entries(blockOps)) {
        if (kinds.includes(b.kind)) out.push({ op, id: prefix + b.id, detail: b.caption !== undefined ? stripInline(b.caption) : '' });
      }
    }
  }
  return out;
}

/** その原稿の `//image` の id → PNG のワークスペース相対パス（設定 `imagePreview`）。 */
export function imagePaths(index: ReviewIndex, parsed: ParsedFile): Record<string, string> {
  const out: Record<string, string> = {};
  for (const b of parsed.blocks) {
    if (b.kind !== 'image' && b.kind !== 'indepimage') continue;
    const p = imagePreviewPath(index, b);
    if (p && b.id) out[b.id] = p;
  }
  return out;
}

const VERDICT_LABEL: Record<string, string> = { ok: 'OK', fix: '要修正', question: '要確認' };

/**
 * その原稿のマーカーを、今の文字列で探し直して編集画面に送る形にする（見失ったものは出さない。
 * ビューには出ている）。
 */
export function markViews(text: string, file: string, data: MarksData, results: Map<string, AiResult>, config: MarksConfig): MarkView[] {
  const out: MarkView[] = [];
  const starts = lineStarts(text);
  const lc = (offset: number): LineCol => {
    const p = posAt(text, offset, starts);
    return { line: p.line, col: p.column };
  };
  for (const m of data.marks) {
    if (m.file !== file) continue;
    const kind = config.kinds.find((k) => k.id === m.kind);
    if (!kind) continue;
    const a = anchorMark(text, m);
    if (a.kind === 'lost') continue;
    const view: MarkView = {
      id: m.id,
      from: lc(a.start),
      to: lc(a.end),
      kind: m.kind,
      kindLabel: kind.label,
      color: kind.color,
      background: kind.background,
      status: m.status,
      note: m.note,
    };
    const r = results.get(m.id);
    if (r) {
      view.verdict = r.verdict;
      view.verdictLabel = VERDICT_LABEL[r.verdict] ?? r.verdict;
      view.comment = r.comment;
      if (r.suggestion !== undefined) {
        view.hasSuggestion = true;
        view.suggestion = r.suggestion;
      }
      if (r.quote !== undefined && r.quote !== text.slice(a.start, a.end)) view.stale = true;
    }
    out.push(view);
  }
  return out;
}

/**
 * webview から来た編集を文字列に当てる（拡張の側が「webview が持っているはずの文字列」を追うため）。
 * 位置はどれも当てる前の文字列での行と桁。入れる文字列の改行は原稿の改行（`eol`）にそろえる
 * （VS Code の TextDocument も同じようにそろえる）。
 */
export function applyTextChanges(text: string, changes: TextChange[], eol: string): string {
  const starts: number[] = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  const lineEnd = (line: number) => {
    if (line + 1 < starts.length) {
      const nl = starts[line + 1] - 1;
      return nl > 0 && text[nl - 1] === '\r' ? nl - 1 : nl;
    }
    return text.length;
  };
  const off = (p: LineCol) => {
    const line = Math.min(Math.max(p.line, 0), starts.length - 1);
    return Math.min(starts[line] + Math.max(p.col, 0), lineEnd(line));
  };
  const sorted = changes.map((c) => ({ from: off(c.from), to: off(c.to), insert: c.insert.replace(/\r?\n/g, eol) })).sort((a, b) => b.from - a.from);
  let out = text;
  for (const c of sorted) out = out.slice(0, c.from) + c.insert + out.slice(c.to);
  return out;
}

/**
 * 見出しの行ごとの PDF のページ（設定 `pageIndex` の索引から）。章の題（`=`）は章のページ、ほかの見出しは
 * その見出しの鍵がそのまま索引にあるときだけ（上の段や章の先頭に落としたページは、その見出しのページではないので出さない）。
 */
export function headingPages(index: ReviewIndex, pages: PageIndex, file: string, parsed: ParsedFile): HeadingPage[] {
  const out: HeadingPage[] = [];
  for (const h of parsed.headings) {
    const line = h.span.start.line;
    const r = lookupPage(index, pages, file, line);
    if (r.kind !== 'ok' || r.heading !== h) continue;
    if (r.via === 'heading' || (h.level === 1 && r.via === 'chapter')) out.push({ line, page: r.page });
  }
  return out;
}
