// マーカーの VS Code 側（装飾、ホバー、サイドバーのビュー、コマンド）。
// 判断（保存形式、位置の探し直し、依頼の組み立て、結果の読み込み、木の並び）は
// すべて src/core/marks.ts にあり、ここは VS Code の型に写すだけにしてある。
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import type { ReviewIndex } from './core/index.js';
import {
  anchorMark,
  buildAiRequest,
  captureMark,
  groupMarks,
  loadAiResults,
  loadMarks,
  lineStarts,
  offsetAt,
  planSuggestion,
  posAt,
  refreshMark,
  saveMarks,
  writeAiRequest,
  type AiResultsLoad,
  type Anchor,
  type Mark,
  type MarkFilter,
  type MarkKindConfig,
  type MarksData,
} from './core/marks.js';

/** マーカーを持つ 1 つの原稿の根（catalog.yml のあるディレクトリ）。 */
export interface MarkHost {
  index: ReviewIndex;
  marks: MarksData;
  results: AiResultsLoad;
}

const VERDICT_LABEL: Record<string, string> = { ok: 'OK', fix: '要修正', question: '要確認' };

/** ガターの印（塗った丸。大きさは VS Code が行の高さに合わせる）。 */
function gutterIcon(color: string): vscode.Uri {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><circle cx="1" cy="1" r="1" fill="${color}"/></svg>`;
  return vscode.Uri.parse(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
}

export class MarksUi implements vscode.TreeDataProvider<Node>, vscode.HoverProvider {
  private hosts: MarkHost[] = [];
  private decorations = new Map<string, { open: vscode.TextEditorDecorationType; done: vscode.TextEditorDecorationType }>();
  private filter: MarkFilter = 'open';
  private readonly changed = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private watchers: vscode.Disposable[] = [];

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly hostOf: (uri: vscode.Uri) => MarkHost | undefined
  ) {}

  // -------------------------------------------------------------------------
  // 読み込み

  /** 索引を作り直したときに呼ぶ。marks.json と ai-results.json を読み、装飾を作り直す。 */
  reset(hosts: MarkHost[]): void {
    this.hosts = hosts;
    for (const w of this.watchers) w.dispose();
    this.watchers = [];
    for (const host of hosts) {
      this.reload(host);
      const cfg = host.index.config.marks;
      const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(host.index.root, `${cfg.dir}/*.json`));
      const onFile = () => {
        this.reload(host);
        this.refreshView();
      };
      this.watchers.push(watcher, watcher.onDidChange(onFile), watcher.onDidCreate(onFile), watcher.onDidDelete(onFile));
    }
    for (const d of this.decorations.values()) {
      d.open.dispose();
      d.done.dispose();
    }
    this.decorations.clear();
    this.refreshView();
  }

  private reload(host: MarkHost): void {
    const cfg = host.index.config.marks;
    const load = loadMarks(host.index.root, cfg);
    for (const p of load.problems) this.output.appendLine(`マーカー: ${load.path}: ${p}`);
    host.marks = load.data;
    const results = loadAiResults(host.index.root, cfg, new Set(host.marks.marks.map((m) => m.id)));
    host.results = results;
    for (const p of results.problems) this.output.appendLine(`AI の結果: ${results.path}: ${p}`);
    if (results.unknownIds.length > 0) this.output.appendLine(`AI の結果: marks.json に無い id ${results.unknownIds.join(', ')}（無視した）`);
    if (results.problems.length > 0) {
      void vscode.window.showWarningMessage(`review-assist: ${cfg.dir}/ai-results.json に読めない所があります（出力「Review Assist」）`);
    }
  }

  dispose(): void {
    for (const w of this.watchers) w.dispose();
    for (const d of this.decorations.values()) {
      d.open.dispose();
      d.done.dispose();
    }
  }

  // -------------------------------------------------------------------------
  // 位置

  /** ファイルの今の中身。開いていればエディタの中身、無ければディスク。 */
  textOf(host: MarkHost, file: string): string | undefined {
    const abs = host.index.abs(file);
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === abs);
    if (doc) return doc.getText();
    return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
  }

  private anchorOf(host: MarkHost, mark: Mark): { anchor: Anchor; text?: string } {
    const text = this.textOf(host, mark.file);
    return { anchor: text === undefined ? { kind: 'lost' } : anchorMark(text, mark), text };
  }

  private rangeOf(text: string, start: number, end: number): vscode.Range {
    const starts = lineStarts(text);
    const a = posAt(text, start, starts);
    const b = posAt(text, end, starts);
    return new vscode.Range(a.line, a.column, b.line, b.column);
  }

  private kindOf(host: MarkHost, id: string): MarkKindConfig | undefined {
    return host.index.config.marks.kinds.find((k) => k.id === id);
  }

  // -------------------------------------------------------------------------
  // 装飾

  private decorationFor(kind: MarkKindConfig) {
    const key = `${kind.id}\u0000${kind.color}\u0000${kind.background}`;
    let d = this.decorations.get(key);
    if (!d) {
      d = {
        open: vscode.window.createTextEditorDecorationType({
          backgroundColor: kind.background,
          gutterIconPath: gutterIcon(kind.color),
          gutterIconSize: 'contain',
          overviewRulerColor: kind.color,
          overviewRulerLane: vscode.OverviewRulerLane.Center,
        }),
        // 済みのものは背景を外し、点線の下線だけ残す（ホバーで結果を読み返せるように）。
        done: vscode.window.createTextEditorDecorationType({ textDecoration: `underline dotted ${kind.color}` }),
      };
      this.decorations.set(key, d);
    }
    return d;
  }

  decorate(editor: vscode.TextEditor): void {
    const host = this.hostOf(editor.document.uri);
    if (!host) return;
    const rel = host.index.rel(editor.document.uri.fsPath);
    const text = editor.document.getText();
    const ranges = new Map<vscode.TextEditorDecorationType, vscode.DecorationOptions[]>();
    for (const d of this.decorations.values()) {
      ranges.set(d.open, []);
      ranges.set(d.done, []);
    }
    for (const m of host.marks.marks) {
      if (m.file !== rel) continue;
      const kind = this.kindOf(host, m.kind);
      if (!kind) continue;
      const a = anchorMark(text, m);
      if (a.kind === 'lost') continue;
      const d = this.decorationFor(kind);
      const type = m.status === 'done' ? d.done : d.open;
      if (!ranges.has(type)) ranges.set(type, []);
      ranges.get(type)!.push({ range: this.rangeOf(text, a.start, a.end) });
    }
    for (const [type, list] of ranges) editor.setDecorations(type, list);
  }

  decorateVisible(): void {
    for (const e of vscode.window.visibleTextEditors) this.decorate(e);
  }

  refreshView(): void {
    this.changed.fire(undefined);
    this.decorateVisible();
  }

  // -------------------------------------------------------------------------
  // ホバー

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const host = this.hostOf(document.uri);
    if (!host) return undefined;
    const rel = host.index.rel(document.uri.fsPath);
    const text = document.getText();
    const at = offsetAt(text, { line: position.line, column: position.character });
    const parts: string[] = [];
    let range: vscode.Range | undefined;
    const commands = new Set<string>();
    for (const m of host.marks.marks) {
      if (m.file !== rel) continue;
      const a = anchorMark(text, m);
      if (a.kind === 'lost' || at < a.start || at > a.end) continue;
      range ??= this.rangeOf(text, a.start, a.end);
      const kind = this.kindOf(host, m.kind);
      const link = (cmd: string, label: string) => {
        commands.add(cmd);
        return `[${label}](command:${cmd}?${encodeURIComponent(JSON.stringify([m.id]))})`;
      };
      const lines = [`**${kind?.label ?? m.kind}**（${m.status === 'done' ? '済み' : '未済'}）`];
      if (m.note) lines.push(`メモ: ${m.note}`);
      const r = host.results.results.get(m.id);
      if (r) {
        lines.push(`AI: **${VERDICT_LABEL[r.verdict] ?? r.verdict}** ${r.comment}`);
        if (r.quote !== undefined && r.quote !== text.slice(a.start, a.end)) lines.push('（AI が見た後で文が変わっている）');
        if (r.suggestion !== undefined) lines.push('案:\n\n```review\n' + r.suggestion + '\n```');
      }
      const actions = [link('reviewAssist.toggleMarkDone', m.status === 'done' ? '未済に戻す' : '済みにする'), link('reviewAssist.editMarkNote', 'メモ')];
      if (r?.suggestion !== undefined) actions.push(link('reviewAssist.applySuggestion', '案を当てる'));
      actions.push(link('reviewAssist.removeMark', '外す'));
      lines.push(actions.join(' · '));
      parts.push(lines.join('\n\n'));
    }
    if (parts.length === 0) return undefined;
    const md = new vscode.MarkdownString(parts.join('\n\n---\n\n'));
    md.isTrusted = { enabledCommands: [...commands] };
    return new vscode.Hover(md, range);
  }

  // -------------------------------------------------------------------------
  // ビュー（種類 → 章 → 項目）

  getTreeItem(node: Node): vscode.TreeItem {
    return node.item;
  }

  getChildren(node?: Node): Node[] {
    if (node) return node.children ?? [];
    const out: Node[] = [];
    for (const host of this.hosts) {
      const groups = groupMarks(host.marks, host.index.config.marks, this.filter, (f) => host.index.chapterOfFile(f), host.index.chapterOrder);
      for (const g of groups) {
        const chapters = g.chapters.map((c) => {
          const marks = c.marks.map((m) => this.markNode(host, m));
          const item = new vscode.TreeItem(c.chapter || '（章に属さない）', vscode.TreeItemCollapsibleState.Expanded);
          item.description = `${marks.length}`;
          return { item, children: marks };
        });
        const total = g.chapters.reduce((n, c) => n + c.marks.length, 0);
        const item = new vscode.TreeItem(g.kind.label, vscode.TreeItemCollapsibleState.Expanded);
        item.description = `${total}${this.hosts.length > 1 ? `（${host.index.root}）` : ''}`;
        out.push({ item, children: chapters });
      }
    }
    return out;
  }

  private markNode(host: MarkHost, m: Mark): Node {
    const { anchor, text } = this.anchorOf(host, m);
    const shown = anchor.kind === 'lost' || text === undefined ? m.quote : text.slice(anchor.start, anchor.end);
    const item = new vscode.TreeItem(shown.split('\n')[0], vscode.TreeItemCollapsibleState.None);
    const r = host.results.results.get(m.id);
    const line = anchor.kind === 'lost' || text === undefined ? m.line : posAt(text, anchor.start).line + 1;
    const desc = [`${m.file}:${line}`];
    if (anchor.kind === 'lost') desc.unshift('位置を見失った');
    if (r) desc.unshift(`AI ${VERDICT_LABEL[r.verdict] ?? r.verdict}`);
    if (m.status === 'done') desc.unshift('済み');
    item.description = desc.join(' · ');
    const tip = new vscode.MarkdownString();
    tip.appendText(m.quote);
    if (m.note) tip.appendMarkdown('\n\n').appendText(`メモ: ${m.note}`);
    if (r) tip.appendMarkdown('\n\n').appendText(`AI: ${VERDICT_LABEL[r.verdict] ?? r.verdict} ${r.comment}`);
    item.tooltip = tip;
    item.iconPath = new vscode.ThemeIcon(anchor.kind === 'lost' ? 'warning' : m.status === 'done' ? 'pass' : 'circle-filled');
    item.contextValue = `mark.${m.status}${r?.suggestion !== undefined ? '.suggestion' : ''}`;
    item.command = { command: 'reviewAssist.openMark', title: '開く', arguments: [m.id] };
    return { item, markId: m.id };
  }

  // -------------------------------------------------------------------------
  // コマンド

  private find(arg: unknown): { host: MarkHost; mark: Mark } | undefined {
    const id = typeof arg === 'string' ? arg : arg && typeof arg === 'object' && 'markId' in arg ? (arg as Node).markId : undefined;
    if (!id) return undefined;
    for (const host of this.hosts) {
      const mark = host.marks.marks.find((m) => m.id === id);
      if (mark) return { host, mark };
    }
    return undefined;
  }

  /** 引数が無いとき（コマンドパレットから）は、カーソルの上のマーカー。複数なら選ばせる。 */
  private async target(arg: unknown): Promise<{ host: MarkHost; mark: Mark } | undefined> {
    const found = this.find(arg);
    if (found) return found;
    const editor = vscode.window.activeTextEditor;
    const host = editor && this.hostOf(editor.document.uri);
    if (!editor || !host) return undefined;
    const rel = host.index.rel(editor.document.uri.fsPath);
    const text = editor.document.getText();
    const at = offsetAt(text, { line: editor.selection.active.line, column: editor.selection.active.character });
    const here = host.marks.marks.filter((m) => {
      if (m.file !== rel) return false;
      const a = anchorMark(text, m);
      return a.kind !== 'lost' && at >= a.start && at <= a.end;
    });
    if (here.length === 0) {
      void vscode.window.showInformationMessage('review-assist: カーソルの位置にマーカーがありません');
      return undefined;
    }
    if (here.length === 1) return { host, mark: here[0] };
    const pick = await vscode.window.showQuickPick(
      here.map((m) => ({ label: m.quote.split('\n')[0], description: this.kindOf(host, m.kind)?.label ?? m.kind, mark: m })),
      { placeHolder: 'どのマーカー？' }
    );
    return pick && { host, mark: pick.mark };
  }

  private save(host: MarkHost): void {
    saveMarks(host.index.root, host.index.config.marks, host.marks);
    this.refreshView();
  }

  async addMark(arg?: { kind?: string } | string): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const host = editor && this.hostOf(editor.document.uri);
    if (!editor || !host) {
      void vscode.window.showInformationMessage('review-assist: 原稿（catalog.yml のあるフォルダの .re）を開いて範囲を選んでください');
      return;
    }
    if (editor.selection.isEmpty) {
      void vscode.window.showInformationMessage('review-assist: マーカーを付ける範囲を選んでください');
      return;
    }
    const cfg = host.index.config.marks;
    const wanted = typeof arg === 'string' ? arg : arg?.kind;
    let kind = cfg.kinds.find((k) => k.id === wanted);
    if (!kind) {
      const pick = await vscode.window.showQuickPick(
        cfg.kinds.map((k) => ({ label: k.label, description: k.id, markKind: k })),
        { placeHolder: 'マーカーの種類' }
      );
      if (!pick) return;
      kind = pick.markKind;
    }
    const note = await vscode.window.showInputBox({ prompt: `${kind.label}: メモ（空でもよい。Esc でやめる）` });
    if (note === undefined) return;
    const text = editor.document.getText();
    const start = editor.document.offsetAt(editor.selection.start);
    const end = editor.document.offsetAt(editor.selection.end);
    const mark = captureMark({
      text,
      file: host.index.rel(editor.document.uri.fsPath),
      start,
      end,
      kind: kind.id,
      note,
      contextLength: cfg.contextLength,
      existingIds: host.marks.marks.map((m) => m.id),
    });
    if (!mark) return;
    host.marks.marks.push(mark);
    this.save(host);
  }

  async removeMark(arg?: unknown): Promise<void> {
    const t = await this.target(arg);
    if (!t) return;
    t.host.marks.marks = t.host.marks.marks.filter((m) => m !== t.mark);
    this.save(t.host);
  }

  async toggleDone(arg?: unknown): Promise<void> {
    const t = await this.target(arg);
    if (!t) return;
    t.mark.status = t.mark.status === 'done' ? 'open' : 'done';
    this.save(t.host);
  }

  async editNote(arg?: unknown): Promise<void> {
    const t = await this.target(arg);
    if (!t) return;
    const note = await vscode.window.showInputBox({ prompt: 'メモ', value: t.mark.note });
    if (note === undefined) return;
    t.mark.note = note;
    this.save(t.host);
  }

  async openMark(arg?: unknown): Promise<void> {
    const t = this.find(arg);
    if (!t) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(t.host.index.abs(t.mark.file)));
    const text = doc.getText();
    const a = anchorMark(text, t.mark);
    const range = a.kind === 'lost' ? new vscode.Range(t.mark.line - 1, 0, t.mark.line - 1, 0) : this.rangeOf(text, a.start, a.end);
    const editor = await vscode.window.showTextDocument(doc, { selection: range });
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
    if (a.kind === 'lost') void vscode.window.showWarningMessage(`review-assist: このマーカーは位置を見失っています（付けたときの ${t.mark.line} 行目を開きました）`);
  }

  async applySuggestion(arg?: unknown): Promise<void> {
    const t = await this.target(arg);
    if (!t) return;
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(t.host.index.abs(t.mark.file)));
    const text = doc.getText();
    const plan = planSuggestion(text, t.mark, t.host.results.results.get(t.mark.id));
    if (!plan.ok) {
      void vscode.window.showInformationMessage(`review-assist: 案を当てられません（${plan.reason}）`);
      return;
    }
    if (plan.stale) {
      const go = await vscode.window.showWarningMessage('AI が見た文と、今の原稿の文が違います。それでも案を当てますか？', { modal: true }, '当てる');
      if (go !== '当てる') return;
    }
    const range = this.rangeOf(text, plan.start, plan.end);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(doc.uri, range, plan.replacement);
    if (!(await vscode.workspace.applyEdit(edit))) return;
    // マーカーを当てた後の文に追いつかせる（自動で済みにはしない。著者が見て決める）。
    const after = doc.getText();
    const start = plan.start;
    const end = plan.start + plan.replacement.length;
    const refreshed = refreshMark(after, t.mark, t.host.index.config.marks.contextLength, { kind: 'fuzzy', start, end });
    Object.assign(t.mark, refreshed);
    this.save(t.host);
    await vscode.window.showTextDocument(doc, { selection: this.rangeOf(after, start, end) });
  }

  async writeRequest(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    const host = (editor && this.hostOf(editor.document.uri)) ?? (this.hosts.length === 1 ? this.hosts[0] : undefined);
    if (!host) {
      void vscode.window.showInformationMessage('review-assist: どの原稿か決まりません（原稿の .re を開いてから実行してください）');
      return;
    }
    const cfg = host.index.config.marks;
    const req = buildAiRequest(host.index, host.marks, cfg, { textOf: (f) => this.textOf(host, f) });
    if (req.ids.length === 0) {
      void vscode.window.showInformationMessage(`review-assist: 未済の「${this.kindOf(host, cfg.aiKind)?.label ?? cfg.aiKind}」のマーカーがありません`);
      return;
    }
    const file = writeAiRequest(host.index.root, cfg, req);
    await vscode.window.showTextDocument(vscode.Uri.file(file), { preview: true });
    void vscode.window.showInformationMessage(
      `review-assist: ${req.ids.length} 件を ${cfg.dir}/ai-check.md に書き出しました${req.lost.length > 0 ? `（うち ${req.lost.length} 件は位置を見失っている）` : ''}。Claude Code に「AI チェックして」と頼んでください`
    );
  }

  async chooseFilter(): Promise<void> {
    const items: { label: string; value: MarkFilter }[] = [
      { label: '未済だけ', value: 'open' },
      { label: '済みだけ', value: 'done' },
      { label: '全部', value: 'all' },
    ];
    const pick = await vscode.window.showQuickPick(items, { placeHolder: `今: ${items.find((i) => i.value === this.filter)?.label}` });
    if (!pick) return;
    this.filter = pick.value;
    this.refreshView();
  }

  /** 原稿を保存したとき: そのファイルのマーカーを今の文で取り直して保存する（見失ったものは触らない）。 */
  onSaved(document: vscode.TextDocument): void {
    const host = this.hostOf(document.uri);
    if (!host) return;
    const rel = host.index.rel(document.uri.fsPath);
    const text = document.getText();
    let changed = false;
    host.marks.marks = host.marks.marks.map((m) => {
      if (m.file !== rel) return m;
      const r = refreshMark(text, m, host.index.config.marks.contextLength);
      if (r !== m && (r.quote !== m.quote || r.prefix !== m.prefix || r.suffix !== m.suffix || r.line !== m.line)) changed = true;
      return r;
    });
    if (changed) this.save(host);
    else this.refreshView();
  }
}

export interface Node {
  item: vscode.TreeItem;
  children?: Node[];
  markId?: string;
}
