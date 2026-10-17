// 「この節を PDF で開く」の、VS Code の中の PDF の画面（0.3.0）。pdf.js（pdfjs-dist の legacy ビルド。VS Code 1.85 の
// Chromium 114 で動くもの）でページを描き、言われたページへ飛ぶ。PDF のバイト列は拡張が workspace.fs で読んで送る
// （WSL や SSH のリモートの窓でも、webview が動く PC から PDF のファイルが見えなくてよい）。
//
// VS Code 無しでも動く（tools/pdf-harness.html）。`acquireVsCodeApi` が無ければ、送るものを `window.__reviewAssistHost` に溜める。
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfHostMessage, PdfViewMessage } from '../core/editor-protocol.js';

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


const post = (m: PdfViewMessage) => api.postMessage(m);

// pdf.js の worker。webview の中では拡張の資源の URL から直に Worker を作れないので、取ってきて blob の URL にする。
const workerUrl = document.querySelector('meta[name="pdf-worker"]')?.getAttribute('content') ?? '';
let workerReady: Promise<void> | undefined;
function setupWorker(): Promise<void> {
  workerReady ??= (async () => {
    const code = await (await fetch(workerUrl)).text();
    const blob = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    pdfjsLib.GlobalWorkerOptions.workerPort = new Worker(blob, { type: 'module' });
  })();
  return workerReady;
}

const container = document.getElementById('pages')!;
let doc: PDFDocumentProxy | undefined;
let pageEls: HTMLDivElement[] = [];
/** 描いた倍率（ページごと）。窓の幅が変わったら描き直す。 */
const rendered = new Map<number, number>();
let target = 1;

/** 窓の幅にページの幅を合わせる倍率。 */
function scaleFor(width: number): number {
  return container.clientWidth / width;
}

async function renderPage(n: number): Promise<void> {
  if (!doc) return;
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  const scale = scaleFor(base.width);
  if (rendered.get(n) === scale) return;
  rendered.set(n, scale);
  const vp = page.getViewport({ scale: scale * window.devicePixelRatio });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  canvas.style.width = '100%';
  await page.render({ canvasContext: canvas.getContext('2d')!, viewport: vp }).promise;
  const el = pageEls[n - 1];
  el.replaceChildren(canvas);
}

/** 見えているページを描く。 */
const observer = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) void renderPage(Number((e.target as HTMLElement).dataset.page));
});

async function layout(): Promise<void> {
  if (!doc) return;
  observer.disconnect();
  container.replaceChildren();
  pageEls = [];
  rendered.clear();
  // ページの大きさはどのページも同じとは限らないので、1 枚ずつ読む（数百ページで数十 ms）
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.page = String(n);
    el.style.aspectRatio = `${base.width} / ${base.height}`;
    container.appendChild(el);
    pageEls.push(el);
    observer.observe(el);
  }
}

async function goto(n: number): Promise<void> {
  if (!doc) return;
  target = Math.min(Math.max(1, n), doc.numPages);
  const el = pageEls[target - 1];
  el.scrollIntoView({ block: 'start' });
  await renderPage(target);
  api.setState({ page: target });
  post({ type: 'shown', page: target, pages: doc.numPages });
}

window.addEventListener('message', (e: MessageEvent) => {
  const m = e.data as PdfHostMessage;
  void (async () => {
    try {
      if (m.type === 'load') {
        await setupWorker();
        doc = await pdfjsLib.getDocument({ data: m.data }).promise;
        document.title = m.name;
        await layout();
        await goto(m.page);
      } else if (m.type === 'goto') {
        await goto(m.page);
      }
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  })();
});

// 窓の幅が変わったら、見えているページから描き直す（いま見ているページは保つ）
let resizeQueued = false;
new ResizeObserver(() => {
  if (resizeQueued || !doc) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    rendered.clear();
    for (const el of pageEls) {
      const r = el.getBoundingClientRect();
      if (r.bottom >= 0 && r.top <= window.innerHeight) void renderPage(Number(el.dataset.page));
    }
  });
}).observe(container);

(window as unknown as { __reviewAssistPdf: unknown }).__reviewAssistPdf = { target: () => target, pages: () => doc?.numPages };

post({ type: 'ready' });
