// 「この節を PDF で開く」の PDF の画面（dist/pdfview.js）を Chromium で開き、言われたページが出るかを確かめる。
//
//   node tools/check-pdfview.mjs <本のディレクトリ> [<ページ> ...] [--shot <png>]
//
// tools/pdf-harness.html と dist/ を http で配り（file:// では ES モジュールと worker が読めない）、拡張と同じく
// PDF のバイト列を load で渡す。ページごとに: 送られた shown のページ、そのページの要素が窓の上端にあること、
// そのページの canvas が描かれていること（白でない画素があること）を見る。
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const core = require(path.join(repo, 'dist', 'core.js'));
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const root = path.resolve(args[0] ?? '');
const shotAt = args.indexOf('--shot');
const shot = shotAt >= 0 ? args[shotAt + 1] : undefined;
const pages = args.slice(1).filter((a, i, all) => /^\d+$/.test(a) && all[i] !== shot).map(Number);
if (pages.length === 0) pages.push(37, 1, 84);
const index = new core.ReviewIndex(root);
index.build();
const pdfPath = index.abs(index.config.pdf);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const files = {
  '/': path.join(here, 'pdf-harness.html'),
  '/dist/pdfview.js': path.join(repo, 'dist', 'pdfview.js'),
  '/dist/pdf.worker.min.mjs': path.join(repo, 'dist', 'pdf.worker.min.mjs'),
  '/book.pdf': pdfPath,
};
await page.route('http://ra.test/**', (route) => {
  const f = files[new URL(route.request().url()).pathname];
  if (!f) return route.fulfill({ status: 404 });
  const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.pdf') ? 'application/pdf' : 'text/javascript';
  return route.fulfill({ contentType: type, body: fs.readFileSync(f) });
});
await page.goto('http://ra.test/');
await page.waitForFunction(() => window.__reviewAssistHost?.some((m) => m.type === 'ready'));

let failures = 0;
const t0 = Date.now();
// 拡張と同じく、バイト列を load で渡す（ページは最初の 1 つ）
await page.evaluate(async (first) => {
  const data = new Uint8Array(await (await fetch('/book.pdf')).arrayBuffer());
  window.__reviewAssistHost = [];
  window.postMessage({ type: 'load', data, page: first, name: 'book.pdf' }, '*');
}, pages[0]);
for (const [i, n] of pages.entries()) {
  if (i > 0) await page.evaluate((n) => { window.__reviewAssistHost = []; window.postMessage({ type: 'goto', page: n }, '*'); }, n);
  await page.waitForFunction(() => window.__reviewAssistHost.some((m) => m.type === 'shown' || m.type === 'error'), null, { timeout: 30000 });
  if (i === 0) console.log(`読み込みと最初のページまで ${Date.now() - t0} ms`);
  const r = await page.evaluate((n) => {
    const shown = window.__reviewAssistHost.find((m) => m.type === 'shown' || m.type === 'error');
    const el = document.querySelector(`.page[data-page="${n}"]`);
    const box = el.getBoundingClientRect();
    const canvas = el.querySelector('canvas');
    let ink = 0;
    if (canvas) {
      const d = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let k = 0; k < d.length; k += 16) if (d[k] < 200) ink++;
    }
    return { shown, top: Math.round(box.top), canvas: !!canvas, ink };
  }, n);
  const ok = r.shown?.type === 'shown' && r.shown.page === n && Math.abs(r.top) <= 1 && r.canvas && r.ink > 0;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} p.${n}: shown ${JSON.stringify(r.shown)}、ページの上端 ${r.top}px、canvas ${r.canvas}、黒い画素 ${r.ink}`);
}
if (shot) await page.screenshot({ path: shot });
if (errors.length) {
  failures++;
  console.log('エラー:', errors);
}
await browser.close();
process.exit(failures === 0 ? 0 : 1);
