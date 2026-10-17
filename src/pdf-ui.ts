// 「この節を PDF で開く」の、VS Code の中の PDF の画面（0.3.0）。webview（dist/pdfview.js、pdf.js）を編集画面の横に開き、
// 言われたページへ飛ぶ。PDF は拡張の側で workspace.fs で読んでバイト列で送るので、WSL や SSH のリモートの窓でも開ける
// （0.2.0 までは PDF の file: の URI を既定のビューアに渡していて、リモートの窓では vscode-remote: のリンクになって開けなかった）。
import * as crypto from 'node:crypto';
import * as vscode from 'vscode';
import type { PdfHostMessage, PdfViewMessage } from './core/editor-protocol.js';

export const PDF_VIEW_TYPE = 'reviewAssist.pdf';

export class PdfPanel implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  /** 送ってある PDF（同じ PDF で更新時刻も同じなら、ページを飛ぶだけ）。 */
  private loaded: { uri: string; mtime: number } | undefined;
  /** webview の用意ができる前に頼まれたもの。 */
  private pending: { pdf: vscode.Uri; page: number } | undefined;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly output: vscode.OutputChannel
  ) {}

  dispose(): void {
    this.panel?.dispose();
  }

  /** PDF の画面を編集画面の横に出し、そのページへ。フォーカスは原稿に残す。 */
  async show(pdf: vscode.Uri, page: number): Promise<void> {
    if (!this.panel) {
      this.panel = vscode.window.createWebviewPanel(
        PDF_VIEW_TYPE,
        'PDF',
        { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          // 裏に回すたびに PDF を送り直して全ページを並べ直さないよう、中身を保つ
          retainContextWhenHidden: true,
          localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
        }
      );
      this.ready = false;
      this.loaded = undefined;
      this.panel.webview.html = this.html(this.panel.webview);
      this.panel.webview.onDidReceiveMessage((m: PdfViewMessage) => this.onMessage(m));
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.ready = false;
        this.loaded = undefined;
      });
    } else {
      this.panel.reveal(this.panel.viewColumn, true);
    }
    this.pending = { pdf, page };
    if (this.ready) await this.flush();
  }

  private async flush(): Promise<void> {
    const p = this.pending;
    if (!p || !this.panel) return;
    this.pending = undefined;
    const stat = await vscode.workspace.fs.stat(p.pdf);
    if (this.loaded && this.loaded.uri === p.pdf.toString() && this.loaded.mtime === stat.mtime) {
      this.post({ type: 'goto', page: p.page });
      return;
    }
    const data = await vscode.workspace.fs.readFile(p.pdf);
    this.loaded = { uri: p.pdf.toString(), mtime: stat.mtime };
    this.panel.title = `PDF: ${p.pdf.path.split('/').pop()}`;
    this.post({ type: 'load', data, page: p.page, name: p.pdf.path.split('/').pop() ?? 'PDF' });
  }

  private post(m: PdfHostMessage): void {
    void this.panel?.webview.postMessage(m);
  }

  private onMessage(m: PdfViewMessage): void {
    if (m.type === 'ready') {
      this.ready = true;
      void this.flush();
    } else if (m.type === 'error') {
      this.output.appendLine(`PDF の画面: ${m.message}`);
      void vscode.window.showWarningMessage(`review-assist: PDF を表示できません（${m.message}）`);
    } else if (m.type === 'shown') {
      this.output.appendLine(`PDF の画面: p.${m.page} / ${m.pages}`);
    }
  }

  private html(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const script = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'pdfview.js'));
    const worker = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'pdf.worker.min.mjs'));
    // worker は取ってきて blob: の URL から作る（connect-src と worker-src blob:）。pdf.js は埋め込みの書体を data: や FontFace で読む
    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; worker-src blob:; connect-src ${webview.cspSource}; img-src ${webview.cspSource} data: blob:; font-src data: blob:; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="pdf-worker" content="${worker}">
<style>
  html, body { margin: 0; padding: 0; height: 100%; background: var(--vscode-editorWidget-background); }
  #pages { height: 100%; overflow-y: auto; }
  .page { background: #fff; margin-bottom: 1px; }
</style>
</head>
<body>
<div id="pages"></div>
<script type="module" nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}
