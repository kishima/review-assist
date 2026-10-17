// VS Code 側の薄い層。判断はすべて src/core/ にあり、ここは型を写すだけにしてある
// （Extension Development Host が使えない環境で作ったので、試験できるのは core だけ）。
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { diagnoseFile, unreferencedTableDiagnostics, duplicateIdDiagnostics } from './core/diagnostics.js';
import { ReviewIndex } from './core/index.js';
import { buildOutline, type OutlineNode } from './core/outline.js';
import { loadPageIndex, lookupPage } from './core/pdfpages.js';
import { describeTarget, imagePreviewPath, isReferenceOp, resolveRef } from './core/resolve.js';
import { parseInlineOps } from './core/parser.js';
import type { Diagnostic, InlineRef, Span } from './core/types.js';
import { emptyMarks, type MarksData, type AiResultsLoad } from './core/marks.js';
import { MarksUi, type MarkHost } from './marks-ui.js';
import { EDITOR_VIEW_TYPE, ReviewEditorProvider } from './editor-ui.js';
import { PdfPanel } from './pdf-ui.js';

const LANGUAGE = 'review';

class Workspace implements MarkHost {
  readonly index: ReviewIndex;
  marks: MarksData = emptyMarks();
  results: AiResultsLoad = { results: new Map(), problems: [], unknownIds: [] };
  constructor(readonly folder: vscode.WorkspaceFolder, root: string) {
    this.index = new ReviewIndex(root);
    this.index.build();
  }
}

let workspaces: Workspace[] = [];
let collection: vscode.DiagnosticCollection;
let output: vscode.OutputChannel;
let marksUi: MarksUi;
let editorProvider: ReviewEditorProvider | undefined;
let pdfPanel: PdfPanel;

/** そのファイルを含むワークスペース（catalog.yml のあるディレクトリ）を探す。 */
function workspaceOf(uri: vscode.Uri): Workspace | undefined {
  const file = uri.fsPath;
  let best: Workspace | undefined;
  for (const ws of workspaces) {
    if (file.startsWith(ws.index.root + path.sep) && (!best || ws.index.root.length > best.index.root.length)) best = ws;
  }
  return best;
}

/** フォルダの下から catalog.yml のあるディレクトリを見つける（直下と 1 段下まで）。 */
function findRoots(folder: vscode.WorkspaceFolder): string[] {
  const base = folder.uri.fsPath;
  const roots: string[] = [];
  if (fs.existsSync(path.join(base, 'catalog.yml'))) roots.push(base);
  try {
    for (const e of fs.readdirSync(base, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
      const sub = path.join(base, e.name);
      if (fs.existsSync(path.join(sub, 'catalog.yml'))) roots.push(sub);
    }
  } catch {
    /* 読めないフォルダは飛ばす */
  }
  return roots;
}

function toRange(span: Span): vscode.Range {
  return new vscode.Range(span.start.line, span.start.column, span.end.line, span.end.column);
}

function toSeverity(s: Diagnostic['severity']): vscode.DiagnosticSeverity {
  switch (s) {
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warning':
      return vscode.DiagnosticSeverity.Warning;
    case 'info':
      return vscode.DiagnosticSeverity.Information;
    default:
      return vscode.DiagnosticSeverity.Hint;
  }
}

function publish(ws: Workspace, files: string[]): void {
  // 索引全体を見る診断（参照されていない表、id の二重）は、どのファイルに出すかが
  // 索引側で決まるので、まとめて作ってからファイルごとに配る。
  const global = [...unreferencedTableDiagnostics(ws.index), ...duplicateIdDiagnostics(ws.index)];
  for (const rel of files) {
    const diags = [...diagnoseFile(ws.index, rel), ...global.filter((d) => d.file === rel)];
    collection.set(
      vscode.Uri.file(ws.index.abs(rel)),
      diags.map((d) => {
        const diag = new vscode.Diagnostic(toRange(d.span), d.message, toSeverity(d.severity));
        diag.source = 'review-assist';
        diag.code = d.code;
        return diag;
      })
    );
  }
}

function publishAll(ws: Workspace): void {
  publish(ws, [...ws.index.files.keys()]);
}

function refreshAll(): void {
  collection.clear();
  workspaces = [];
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    for (const root of findRoots(folder)) {
      const ws = new Workspace(folder, root);
      workspaces.push(ws);
      output.appendLine(`索引: ${root}（${ws.index.chapters.size} 章、${ws.index.files.size} ファイル）`);
      if (ws.index.configLoad.error) {
        void vscode.window.showWarningMessage(`review-assist: .review-assist.json が読めません（${ws.index.configLoad.error}）`);
      }
      publishAll(ws);
    }
  }
  marksUi?.reset(workspaces);
  editorProvider?.reset();
  // 「マーカー」ビューは原稿のあるワークスペースでだけ出す（package.json の views の when）。
  void vscode.commands.executeCommand('setContext', 'reviewAssist.hasBook', workspaces.length > 0);
}

/** カーソル位置にあるインライン命令を返す。 */
function refAt(ws: Workspace, document: vscode.TextDocument, position: vscode.Position): InlineRef | undefined {
  const rel = ws.index.rel(document.uri.fsPath);
  const line = document.lineAt(position.line).text;
  for (const op of parseInlineOps(line)) {
    if (position.character < op.start || position.character > op.end) continue;
    return {
      file: rel,
      op: op.op,
      arg: op.arg,
      span: { start: { line: position.line, column: op.start }, end: { line: position.line, column: op.end } },
      argSpan: { start: { line: position.line, column: op.argStart }, end: { line: position.line, column: op.argEnd } },
      chapter: ws.index.chapterOfFile(rel),
    };
  }
  return undefined;
}

const definitionProvider: vscode.DefinitionProvider = {
  provideDefinition(document, position) {
    const ws = workspaceOf(document.uri);
    if (!ws) return undefined;
    const ref = refAt(ws, document, position);
    if (!ref || !isReferenceOp(ref.op)) return undefined;
    const target = resolveRef(ws.index, ref);
    if (!target) return undefined;
    const uri = vscode.Uri.file(ws.index.abs(target.file));
    const span = target.heading?.selectionSpan ?? target.block?.span ?? { start: { line: 0, column: 0 }, end: { line: 0, column: 0 } };
    return new vscode.Location(uri, toRange(span));
  },
};

const hoverProvider: vscode.HoverProvider = {
  provideHover(document, position) {
    const ws = workspaceOf(document.uri);
    if (!ws) return undefined;
    const ref = refAt(ws, document, position);
    if (!ref || !isReferenceOp(ref.op)) return undefined;
    const target = resolveRef(ws.index, ref);
    const md = new vscode.MarkdownString();
    md.supportHtml = false;
    if (!target) {
      md.appendMarkdown(`\`@<${ref.op}>{${ref.arg}}\` の先が見つかりません。`);
      return new vscode.Hover(md, toRange(ref.span));
    }
    md.appendMarkdown(describeTarget(ws.index, target).join('\n\n'));
    if (target.block && (target.block.kind === 'image' || target.block.kind === 'indepimage')) {
      const preview = imagePreviewPath(ws.index, target.block);
      if (preview) {
        const abs = ws.index.abs(preview);
        if (fs.existsSync(abs)) {
          md.appendMarkdown(`\n\n![${target.block.id}](${vscode.Uri.file(abs).toString()})`);
        } else {
          md.appendMarkdown(`\n\n（プレビュー \`${preview}\` はまだありません）`);
        }
      }
    }
    return new vscode.Hover(md, toRange(ref.span));
  },
};

function toSymbol(node: OutlineNode): vscode.DocumentSymbol {
  const kind =
    node.kind === 'heading'
      ? vscode.SymbolKind.Namespace
      : node.kind === 'table'
        ? vscode.SymbolKind.Struct
        : node.kind === 'image'
          ? vscode.SymbolKind.File
          : node.kind === 'footnote'
            ? vscode.SymbolKind.Constant
            : vscode.SymbolKind.Function;
  const symbol = new vscode.DocumentSymbol(node.name, node.detail, kind, toRange(node.span), toRange(node.selectionSpan));
  symbol.children = node.children.map(toSymbol);
  return symbol;
}

const symbolProvider: vscode.DocumentSymbolProvider = {
  provideDocumentSymbols(document) {
    const ws = workspaceOf(document.uri);
    if (!ws) return [];
    const rel = ws.index.rel(document.uri.fsPath);
    ws.index.updateFile(rel, document.getText());
    const parsed = ws.index.files.get(rel);
    if (!parsed) return [];
    // 既定は見出しだけ。表・リスト・図・脚注は設定 outline.blocks に入れた種類だけ出す。
    return buildOutline(parsed, { blocks: ws.index.config.outline.blocks }).map(toSymbol);
  },
};

/**
 * 「この節を PDF で開く」の、どの PDF のどのページか。カーソルの直近の見出し（無ければ章の先頭）のページを索引 JSON から引く。
 * 開けない理由は全部メッセージで言い、undefined を返す。原稿は普通のエディタか、記法を畳む編集画面の前にある方。
 */
function pdfTarget(): { pdfAbs: string; pdfRel: string; page: number; where: string } | undefined {
  const editor = vscode.window.activeTextEditor;
  const custom = editorProvider?.activeSelection();
  const document = editor?.document ?? custom?.document;
  const line = editor ? editor.selection.active.line : custom?.active.line;
  if (!document || line === undefined) {
    void vscode.window.showInformationMessage('review-assist: エディタが開いていません');
    return undefined;
  }
  const ws = workspaceOf(document.uri);
  if (!ws) {
    void vscode.window.showInformationMessage('review-assist: このファイルは原稿（catalog.yml のあるフォルダ）の中にありません');
    return undefined;
  }
  const pdfRel = ws.index.config.pdf;
  if (!pdfRel) {
    void vscode.window.showWarningMessage('review-assist: .review-assist.json に "pdf"（PDF のパス）を書いてください');
    return undefined;
  }
  const pdfAbs = ws.index.abs(pdfRel);
  if (!fs.existsSync(pdfAbs)) {
    void vscode.window.showWarningMessage(`review-assist: PDF ${pdfRel} がありません（先に本をビルドしてください）`);
    return undefined;
  }
  const load = loadPageIndex(ws.index);
  if (!load.pages) {
    const why =
      load.problem === 'not-configured'
        ? '.review-assist.json に "pageIndex"（見出し → ページの索引 JSON）を書いてください'
        : load.problem === 'missing'
          ? `索引 ${load.path} がありません（本側の tools/pdf_pages.py が PDF と一緒に作ります）`
          : `索引 ${load.path} が読めません（${load.error}）`;
    void vscode.window.showWarningMessage(`review-assist: ${why}`);
    return undefined;
  }

  const rel = ws.index.rel(document.uri.fsPath);
  ws.index.updateFile(rel, document.getText());
  const found = lookupPage(ws.index, load.pages, rel, line);
  if (found.kind === 'no-chapter') {
    void vscode.window.showInformationMessage(`review-assist: ${rel} は catalog.yml のどの章にも属していないので、ページが決まりません`);
    return undefined;
  }
  if (found.kind === 'not-found') {
    void vscode.window.showInformationMessage(
      `review-assist: この見出しは索引にありません（引いた鍵: ${found.keys.join('、')}）。PDF を作り直すと入ります`
    );
    return undefined;
  }
  const where = found.via === 'heading' ? found.heading?.plainTitle : found.via === 'chapter' ? '章の先頭' : `上の段 ${found.key}`;
  return { pdfAbs, pdfRel, page: found.page, where: where ?? found.key };
}

/**
 * 「この節を PDF で開く」（0.3.0 から）: VS Code の中の PDF の画面（pdf.js）を原稿の横に開いて、そのページへ。
 * PDF は拡張の側で読んで送るので、WSL・SSH のリモートの窓でも開ける。
 */
function openInPdf(): void {
  const t = pdfTarget();
  if (!t) return;
  // ワークスペースの URI の形（リモートなら vscode-remote:）で読む。拡張はワークスペースの側で動いているので file: でも読めるが、
  // workspace.fs を通しておけば、どちらの側で動いても同じ
  const ws = workspaces.find((w) => t.pdfAbs.startsWith(w.index.root));
  const asUri = (abs: string) => (ws ? ws.folder.uri.with({ path: vscode.Uri.file(abs).path }) : vscode.Uri.file(abs));
  const uri = asUri(t.pdfAbs);
  const root = asUri(path.dirname(t.pdfAbs));
  void pdfPanel.show(uri, t.page, root).catch((e) => void vscode.window.showWarningMessage(`review-assist: ${t.pdfRel} を開けませんでした（${e instanceof Error ? e.message : String(e)}）`));
  output.appendLine(`PDF: ${t.pdfRel} p.${t.page}（${t.where}）`);
}

/**
 * 「この節を PDF で開く（外のビューアで）」: 0.2.0 までの動き。`file:///…/book.pdf#page=N` を既定のビューアに渡す
 * （ページ番号の渡し方は Adobe の open parameters。Chrome / Edge / Firefox / Preview も同じ形を読む）。
 * リモートの窓（WSL・SSH）では、手元の PC から file: の PDF が見えないので開けないことがある。
 */
function openInPdfExternal(): void {
  const t = pdfTarget();
  if (!t) return;
  const uri = vscode.Uri.file(t.pdfAbs).with({ fragment: `page=${t.page}` });
  void vscode.env.openExternal(uri).then((ok) => {
    if (!ok) void vscode.window.showWarningMessage(`review-assist: ${t.pdfRel} を開けませんでした`);
  });
  output.appendLine(`PDF（外）: ${t.pdfRel} p.${t.page}（${t.where}）`);
}

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('Review Assist');
  collection = vscode.languages.createDiagnosticCollection('review-assist');
  context.subscriptions.push(output, collection);
  marksUi = new MarksUi(output, workspaceOf);
  pdfPanel = new PdfPanel(context.extensionUri, output);
  context.subscriptions.push(pdfPanel);
  context.subscriptions.push(marksUi, vscode.window.registerTreeDataProvider('reviewAssist.marks', marksUi));

  refreshAll();

  const selector: vscode.DocumentSelector = { language: LANGUAGE, scheme: 'file' };
  context.subscriptions.push(
    vscode.languages.registerDefinitionProvider(selector, definitionProvider),
    vscode.languages.registerHoverProvider(selector, hoverProvider),
    vscode.languages.registerDocumentSymbolProvider(selector, symbolProvider),
    vscode.languages.registerHoverProvider(selector, marksUi),
    vscode.commands.registerCommand('reviewAssist.addMark', (arg?: { kind?: string } | string) => marksUi.addMark(arg)),
    vscode.commands.registerCommand('reviewAssist.addMarkAiCheck', () => marksUi.addMark('ai-check')),
    vscode.commands.registerCommand('reviewAssist.addMarkReadLater', () => marksUi.addMark('read-later')),
    vscode.commands.registerCommand('reviewAssist.removeMark', (arg?: unknown) => marksUi.removeMark(arg)),
    vscode.commands.registerCommand('reviewAssist.toggleMarkDone', (arg?: unknown) => marksUi.toggleDone(arg)),
    vscode.commands.registerCommand('reviewAssist.editMarkNote', (arg?: unknown) => marksUi.editNote(arg)),
    vscode.commands.registerCommand('reviewAssist.openMark', (arg?: unknown) => marksUi.openMark(arg)),
    vscode.commands.registerCommand('reviewAssist.applySuggestion', (arg?: unknown) => marksUi.applySuggestion(arg)),
    vscode.commands.registerCommand('reviewAssist.writeAiRequest', () => marksUi.writeRequest()),
    vscode.commands.registerCommand('reviewAssist.filterMarks', () => marksUi.chooseFilter()),
    vscode.window.onDidChangeVisibleTextEditors(() => marksUi.decorateVisible()),
    vscode.commands.registerCommand('reviewAssist.reindex', () => {
      refreshAll();
      void vscode.window.showInformationMessage('review-assist: 索引を作り直しました');
    }),
    vscode.commands.registerCommand('reviewAssist.openInPdf', () => openInPdf()),
    vscode.commands.registerCommand('reviewAssist.openInPdfExternal', () => openInPdfExternal()),
    vscode.commands.registerCommand('reviewAssist.showIndexStats', () => {
      output.clear();
      for (const ws of workspaces) {
        output.appendLine(`${ws.index.root}`);
        output.appendLine(`  設定: ${ws.index.configLoad.path ?? '(既定値)'}`);
        for (const id of ws.index.chapterOrder) {
          const c = ws.index.chapters.get(id)!;
          output.appendLine(`  ${id}${c.generated ? '（生成物。元は設定 chapters）' : ''}: ${c.files.join(', ')}`);
        }
      }
      output.show();
    }),
    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId !== LANGUAGE) return;
      const ws = workspaceOf(e.document.uri);
      if (!ws) return;
      const rel = ws.index.rel(e.document.uri.fsPath);
      ws.index.updateFile(rel, e.document.getText());
      publish(ws, [rel]);
      // マーカーは文字列で位置を探し直す（打つたびに。1 件 0.1 ms ほど。docs/verification/marks.md）。
      for (const editor of vscode.window.visibleTextEditors) if (editor.document === e.document) marksUi.decorate(editor);
    }),
    vscode.workspace.onDidOpenTextDocument((doc) => {
      if (doc.languageId !== LANGUAGE) return;
      const ws = workspaceOf(doc.uri);
      if (!ws) return;
      const rel = ws.index.rel(doc.uri.fsPath);
      ws.index.updateFile(rel, doc.getText());
      publish(ws, [rel]);
    }),
    vscode.workspace.onDidSaveTextDocument((doc) => {
      const ws = workspaceOf(doc.uri);
      if (!ws) return;
      // 保存のときだけは索引全体を見直す（参照されていない表の判定が他のファイルに及ぶ）。
      ws.index.updateFile(ws.index.rel(doc.uri.fsPath), doc.getText());
      publishAll(ws);
      if (doc.languageId === LANGUAGE) marksUi.onSaved(doc);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => refreshAll())
  );

  // 記法を畳む編集画面（0.3.0）。上の onDidChangeTextDocument（索引の更新）より後に作る
  // （編集画面は変更の通知で索引を読むので、先に索引が今の文字列になっている必要がある）。
  editorProvider = new ReviewEditorProvider(context.extensionUri, output, workspaceOf);
  marksUi.setBridge(editorProvider);
  context.subscriptions.push(
    editorProvider,
    vscode.window.registerCustomEditorProvider(EDITOR_VIEW_TYPE, editorProvider, {
      supportsMultipleEditorsPerDocument: true,
    }),
    vscode.commands.registerCommand('reviewAssist.toggleEditor', (uri?: vscode.Uri) => editorProvider!.toggle(uri instanceof vscode.Uri ? uri : undefined)),
    vscode.commands.registerCommand('reviewAssist.wrapInline', (arg?: { op?: string } | string) =>
      editorProvider!.wrap(typeof arg === 'string' ? arg : arg?.op)
    ),
    vscode.commands.registerCommand('reviewAssist.wrapCode', () => editorProvider!.wrap('code')),
    vscode.commands.registerCommand('reviewAssist.wrapBold', () => editorProvider!.wrap('b')),
    vscode.commands.registerCommand('reviewAssist.insertBlock', () => editorProvider!.insertBlock())
  );

  // 設定ファイルと catalog.yml が変わったら索引を作り直す。
  const watcher = vscode.workspace.createFileSystemWatcher('**/{.review-assist.json,catalog.yml}');
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(() => refreshAll()),
    watcher.onDidCreate(() => refreshAll()),
    watcher.onDidDelete(() => refreshAll())
  );
}

export function deactivate(): void {
  workspaces = [];
}
