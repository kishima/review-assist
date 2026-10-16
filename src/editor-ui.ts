// 記法を畳む編集画面（0.3.0）の VS Code 側。CustomTextEditorProvider で webview（dist/webview.js、
// CodeMirror 6）を開き、TextDocument と双方向に同期する。保存・取り消し・dirty の印は TextDocument の
// もの。判断（畳む範囲、参照の札、候補、マーカーの位置、編集の当て方）は src/core/ にあり、ここは
// 写して送るだけ。
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { BLOCK_TEMPLATES, wrapInline } from './core/editing.js';
import { defaultEditorConfig } from './core/editor-config.js';
import { applyTextChanges, completionCandidates, imagePaths, markViews, refLabels } from './core/editor-data.js';
import type { DiagView, EditorData, HostMessage, LineCol, ViewMessage } from './core/editor-protocol.js';
import type { MarkHost } from './marks-ui.js';

export const EDITOR_VIEW_TYPE = 'reviewAssist.editor';

interface Session {
  document: vscode.TextDocument;
  panel: vscode.WebviewPanel;
  /** 当て終えた webview の編集の番号。 */
  appliedSeq: number;
  /** webview が持っているはずの文字列（ずれたら全文を送り直す）。 */
  mirror: string;
  /** 自分の編集を当てている最中（そのときの変更の通知は送り返さない）。 */
  applying: number;
  queue: Promise<void>;
  selection?: { anchor: LineCol; head: LineCol };
  ready: boolean;
  /** 最後に送った札・図・マーカーなど（JSON）。変わっていないものは送らない（webview は受けるたびに装飾を作り直すため）。 */
  lastSent: Map<string, string>;
}

function eolOf(document: vscode.TextDocument): '\n' | '\r\n' {
  return document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
}

function severityOf(s: vscode.DiagnosticSeverity): DiagView['severity'] {
  switch (s) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    default:
      return 'hint';
  }
}

export class ReviewEditorProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private sessions = new Set<Session>();
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel,
    private readonly hostOf: (uri: vscode.Uri) => MarkHost | undefined
  ) {
    // extension.ts の onDidChangeTextDocument（索引の更新）より後に登録されるので、ここで索引を読むと
    // 今の文字列の解析が入っている。
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument((e) => this.onDocumentChanged(e)),
      vscode.languages.onDidChangeDiagnostics((e) => {
        for (const s of this.sessions) if (e.uris.some((u) => u.toString() === s.document.uri.toString())) this.sendData(s, { diagnostics: this.diagnostics(s) });
      }),
      vscode.workspace.onDidSaveTextDocument(() => {
        // 保存のときに索引全体が作り直される（extension.ts）。ほかの章の題やブロックが変わっているかもしれない。
        for (const s of this.sessions) if (s.ready) this.sendData(s, { ...this.fileData(s), completions: this.completions(s) });
      })
    );
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }

  // -------------------------------------------------------------------------
  // 開く

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    const host = this.hostOf(document.uri);
    const roots = [vscode.Uri.joinPath(this.extensionUri, 'dist')];
    if (host) roots.push(vscode.Uri.file(host.index.root));
    panel.webview.options = { enableScripts: true, localResourceRoots: roots };
    panel.webview.html = this.html(panel.webview);
    const session: Session = { document, panel, appliedSeq: 0, mirror: document.getText(), applying: 0, queue: Promise.resolve(), ready: false, lastSent: new Map() };
    this.sessions.add(session);
    panel.onDidDispose(() => this.sessions.delete(session));
    panel.webview.onDidReceiveMessage((m: ViewMessage) => this.onMessage(session, m));
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview.js'));
    // style-src の 'unsafe-inline' は CodeMirror が <style> を差し込むのと、行の装飾の style 属性のため。
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>html, body, #editor { height: 100%; margin: 0; padding: 0; overflow: hidden; } body { background: var(--vscode-editor-background); }</style>
</head>
<body data-vscode-context='{"webviewSection":"editor"}'>
<div id="editor"></div>
<script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }

  // -------------------------------------------------------------------------
  // 送るもの

  private post(s: Session, m: HostMessage): void {
    void s.panel.webview.postMessage(m);
  }

  private fileData(s: Session): EditorData {
    const host = this.hostOf(s.document.uri);
    if (!host) return {};
    const rel = host.index.rel(s.document.uri.fsPath);
    const parsed = host.index.files.get(rel);
    const text = s.document.getText();
    const data: EditorData = {
      marks: markViews(text, rel, host.marks, host.results.results, host.index.config.marks),
    };
    if (parsed) {
      data.refs = refLabels(host.index, parsed);
      const images: Record<string, string> = {};
      for (const [id, p] of Object.entries(imagePaths(host.index, parsed))) {
        const abs = host.index.abs(p);
        if (fs.existsSync(abs)) images[id] = s.panel.webview.asWebviewUri(vscode.Uri.file(abs)).toString();
      }
      data.images = images;
    }
    return data;
  }

  private completions(s: Session) {
    const host = this.hostOf(s.document.uri);
    return host ? completionCandidates(host.index, host.index.rel(s.document.uri.fsPath)) : [];
  }

  private diagnostics(s: Session): DiagView[] {
    return vscode.languages.getDiagnostics(s.document.uri).map((d) => {
      const v: DiagView = {
        from: { line: d.range.start.line, col: d.range.start.character },
        to: { line: d.range.end.line, col: d.range.end.character },
        severity: severityOf(d.severity),
        message: d.message,
      };
      if (d.source) v.source = d.source;
      return v;
    });
  }

  private sendInit(s: Session): void {
    const host = this.hostOf(s.document.uri);
    const config = host?.index.config.editor ?? defaultEditorConfig();
    s.mirror = s.document.getText();
    const data: EditorData = { ...this.fileData(s), completions: this.completions(s), diagnostics: this.diagnostics(s) };
    s.lastSent.clear();
    for (const [k, v] of Object.entries(data)) s.lastSent.set(k, JSON.stringify(v));
    this.post(s, { type: 'init', text: s.mirror, eol: eolOf(s.document), config, seq: s.appliedSeq, ...data });
  }

  private sendData(s: Session, data: EditorData): void {
    if (!s.ready) return;
    const changed: EditorData = {};
    for (const [k, v] of Object.entries(data) as [keyof EditorData, unknown][]) {
      const json = JSON.stringify(v);
      if (s.lastSent.get(k) === json) continue;
      s.lastSent.set(k, json);
      (changed as Record<string, unknown>)[k] = v;
    }
    if (Object.keys(changed).length === 0) return;
    this.post(s, { type: 'data', seq: s.appliedSeq, ...changed });
  }

  /** 索引を作り直したとき（設定・catalog.yml が変わった）。開いている画面を全部作り直す。 */
  reset(): void {
    for (const s of this.sessions) if (s.ready) this.sendInit(s);
  }

  /** マーカーか AI の結果が変わったとき。 */
  marksChanged(): void {
    for (const s of this.sessions) {
      const host = this.hostOf(s.document.uri);
      if (!host || !s.ready) continue;
      const rel = host.index.rel(s.document.uri.fsPath);
      this.sendData(s, { marks: markViews(s.document.getText(), rel, host.marks, host.results.results, host.index.config.marks) });
    }
  }

  // -------------------------------------------------------------------------
  // 受け取るもの

  private onMessage(s: Session, m: ViewMessage): void {
    switch (m.type) {
      case 'ready':
        s.ready = true;
        this.sendInit(s);
        break;
      case 'edit':
        this.enqueueEdit(s, m);
        break;
      case 'selection':
        s.selection = { anchor: m.anchor, head: m.head };
        break;
      case 'sync':
        s.mirror = s.document.getText();
        this.post(s, { type: 'text', text: s.mirror, seq: s.appliedSeq });
        break;
      case 'command':
        void vscode.commands.executeCommand(m.command, ...m.args);
        break;
      case 'log':
        this.output.appendLine(`編集画面: ${m.message}`);
        if (m.level === 'info') void vscode.window.showInformationMessage(`review-assist: ${m.message}`);
        break;
    }
  }

  private enqueueEdit(s: Session, m: Extract<ViewMessage, { type: 'edit' }>): void {
    s.queue = s.queue.then(async () => {
      const edit = new vscode.WorkspaceEdit();
      for (const c of m.changes) edit.replace(s.document.uri, new vscode.Range(c.from.line, c.from.col, c.to.line, c.to.col), c.insert);
      s.mirror = applyTextChanges(s.mirror, m.changes, eolOf(s.document));
      s.applying++;
      let ok = false;
      try {
        ok = await vscode.workspace.applyEdit(edit);
      } finally {
        s.applying--;
      }
      s.appliedSeq = m.seq;
      // 当てられなかった・当てた結果が webview と違う（間に別の変更が入った）ときは全文を送り直す。
      if (!ok || s.document.getText() !== s.mirror) {
        this.output.appendLine(`編集画面: ${s.document.uri.fsPath} の同期がずれたので全文を送り直した（当てられた: ${ok}）`);
        s.mirror = s.document.getText();
        this.post(s, { type: 'text', text: s.mirror, seq: s.appliedSeq });
      }
      this.post(s, { type: 'ack', seq: m.seq });
      this.sendData(s, this.fileData(s));
    });
  }

  private onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
    if (e.contentChanges.length === 0) return;
    for (const s of this.sessions) {
      if (s.document !== e.document || !s.ready) continue;
      if (s.applying > 0) continue; // 自分の編集。当て終えたところで ack と一緒に送る
      // 外からの変更（取り消し、普通のエディタ、ディスクからの読み直し、案を当てる）。
      const text = e.document.getText();
      if (text !== s.mirror) {
        s.mirror = text;
        this.post(s, { type: 'text', text, seq: s.appliedSeq });
      }
      this.sendData(s, this.fileData(s));
    }
  }

  // -------------------------------------------------------------------------
  // コマンドから使う口

  /** 前に出ている編集画面。 */
  activeSession(): Session | undefined {
    for (const s of this.sessions) if (s.panel.active) return s;
    return undefined;
  }

  /** 前に出ている編集画面の文書と選択（マーカーを付けるとき）。 */
  activeSelection(): { document: vscode.TextDocument; anchor: vscode.Position; active: vscode.Position } | undefined {
    const s = this.activeSession();
    if (!s) return undefined;
    const sel = s.selection ?? { anchor: { line: 0, col: 0 }, head: { line: 0, col: 0 } };
    return {
      document: s.document,
      anchor: new vscode.Position(sel.anchor.line, sel.anchor.col),
      active: new vscode.Position(sel.head.line, sel.head.col),
    };
  }

  /** その文書を開いている編集画面があれば、そこで範囲を選んで前に出す。無ければ false。 */
  reveal(uri: vscode.Uri, range: vscode.Range): boolean {
    const list = [...this.sessions].filter((s) => s.document.uri.toString() === uri.toString());
    const s = list.find((x) => x.panel.active) ?? list.find((x) => x.panel.visible) ?? list[0];
    if (!s) return false;
    s.panel.reveal(s.panel.viewColumn);
    this.post(s, { type: 'reveal', from: { line: range.start.line, col: range.start.character }, to: { line: range.end.line, col: range.end.character } });
    return true;
  }

  hasSession(uri: vscode.Uri): boolean {
    return [...this.sessions].some((s) => s.document.uri.toString() === uri.toString());
  }

  // -------------------------------------------------------------------------
  // コマンド

  /** 選んだ範囲を `@<op>{}` で囲む（編集画面でも普通のエディタでも）。 */
  async wrap(op: string | undefined): Promise<void> {
    let name = op;
    if (!name) {
      name = (await vscode.window.showQuickPick(['code', 'b', 'i', 'tt', 'hidx', 'kw', 'em', 'strong'], { placeHolder: '囲むインライン命令' })) ?? undefined;
      if (!name) return;
    }
    const s = this.activeSession();
    if (s) {
      this.post(s, { type: 'wrap', op: name });
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const text = editor.document.getText(editor.selection);
    const wrapped = wrapInline(name, text);
    if (wrapped === undefined) {
      void vscode.window.showInformationMessage('review-assist: 行をまたぐ範囲はインライン命令で囲めません');
      return;
    }
    const sel = editor.selection;
    await editor.edit((b) => b.replace(sel, wrapped));
  }

  /** ブロックの雛形を入れる。 */
  async insertBlock(): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      BLOCK_TEMPLATES.map((t) => ({ label: t.label, template: t })),
      { placeHolder: '入れるブロック' }
    );
    if (!pick) return;
    const t = pick.template;
    const s = this.activeSession();
    if (s) {
      this.post(s, { type: 'insert', text: t.text, cursor: t.cursor });
      return;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const at = editor.selection.active;
    const doc = editor.document;
    const offset = doc.offsetAt(at);
    if (!(await editor.edit((b) => b.insert(at, t.text)))) return;
    const p = doc.positionAt(offset + t.cursor);
    editor.selection = new vscode.Selection(p, p);
  }

  /** 編集画面 ⇔ 普通のエディタ。開いていた方のタブは閉じる。 */
  async toggle(uri?: vscode.Uri): Promise<void> {
    const group = vscode.window.tabGroups.activeTabGroup;
    const before = group.activeTab;
    const s = this.activeSession();
    let target: vscode.Uri | undefined = uri;
    let viewType: string;
    if (s) {
      target ??= s.document.uri;
      viewType = 'default';
    } else {
      target ??= vscode.window.activeTextEditor?.document.uri;
      viewType = EDITOR_VIEW_TYPE;
    }
    if (!target) {
      void vscode.window.showInformationMessage('review-assist: 開いている原稿（.re）がありません');
      return;
    }
    await vscode.commands.executeCommand('vscode.openWith', target, viewType, group.viewColumn);
    if (before && before !== vscode.window.tabGroups.activeTabGroup.activeTab) {
      const input = before.input;
      const same =
        (input instanceof vscode.TabInputText && input.uri.toString() === target.toString()) ||
        (input instanceof vscode.TabInputCustom && input.uri.toString() === target.toString());
      if (same) await vscode.window.tabGroups.close(before, true);
    }
  }
}
