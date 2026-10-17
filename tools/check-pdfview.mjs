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
const files = {
  '/': path.join(here, 'pdf-harness.html'),
  '/dist/pdfview.js': path.join(repo, 'dist', 'pdfview.js'),
  '/dist/pdf.worker.min.mjs': path.join(repo, 'dist', 'pdf.worker.min.mjs'),
  '/book.pdf': pdfPath,
};

// PDF の渡し方。拡張の今の渡し方は url。bytes と json は postMessage でバイト列を渡したとき（古い渡し方と、その代わりの道）:
//   bytes  Uint8Array のまま届く（手元の窓で structured clone されたとき）
//   json   JSON を通った形で届く（{"0":37,"1":80,…} の普通のオブジェクト）。リモートの窓（WSL）で VS Code が
//          メッセージを直列化したときに起きうる形で、0.3.0 の最初の形では pdf.js が「Invalid PDF binary data」で落ちた
//   nourl  url から読めない（404）。webview が fetchFailed を拡張に送ること（拡張はバイト列を送り直す）だけを見る
const modes = (args.find((a) => a.startsWith('--modes='))?.slice('--modes='.length) ?? 'url,bytes,json,nourl').split(',');
let failures = 0;
for (const mode of modes) {
  const page = await browser.newPage({ viewport: { width: 700, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.route('http://ra.test/**', (route) => {
    const f = files[new URL(route.request().url()).pathname];
    if (!f) return route.fulfill({ status: 404 });
    const type = f.endsWith('.html') ? 'text/html' : f.endsWith('.pdf') ? 'application/pdf' : 'text/javascript';
    return route.fulfill({ contentType: type, body: fs.readFileSync(f) });
  });
  await page.goto('http://ra.test/');
  await page.waitForFunction(() => window.__reviewAssistHost?.some((m) => m.type === 'ready'));
  console.log(`渡し方 ${mode}:`);
  const t0 = Date.now();
  await page.evaluate(
    async ({ first, mode }) => {
      window.__reviewAssistHost = [];
      if (mode === 'url' || mode === 'nourl') {
        window.postMessage({ type: 'load', url: mode === 'url' ? '/book.pdf' : '/nosuch.pdf', page: first, name: 'book.pdf' }, '*');
        return;
      }
      const bytes = new Uint8Array(await (await fetch('/book.pdf')).arrayBuffer());
      const data = mode === 'json' ? JSON.parse(JSON.stringify(bytes)) : bytes;
      window.postMessage({ type: 'load', data, page: first, name: 'book.pdf' }, '*');
    },
    { first: pages[0], mode }
  );
  if (mode === 'nourl') {
    const got = await page
      .waitForFunction(() => window.__reviewAssistHost.find((m) => m.type === 'fetchFailed'), null, { timeout: 10000 })
      .then((h) => h.jsonValue(), () => undefined);
    console.log(`  ${got ? 'ok  ' : 'FAIL'} fetchFailed ${JSON.stringify(got)}`);
    if (!got) failures++;
    await page.close();
    continue;
  }
  for (const [i, n] of pages.entries()) {
    if (i > 0)
      await page.evaluate((n) => {
        window.__reviewAssistHost = [];
        window.postMessage({ type: 'goto', page: n }, '*');
      }, n);
    const done = await page
      .waitForFunction(() => window.__reviewAssistHost.some((m) => m.type === 'shown' || m.type === 'error'), null, { timeout: 30000 })
      .then(() => true, () => false);
    if (!done) {
      failures++;
      console.log(`FAIL p.${n}: 30 秒たっても shown も error も来ない`);
      break;
    }
    if (i === 0) console.log(`  読み込みと最初のページまで ${Date.now() - t0} ms`);
    const r = await page.evaluate((n) => {
      const shown = window.__reviewAssistHost.find((m) => m.type === 'shown' || m.type === 'error');
      const el = document.querySelector(`.page[data-page="${n}"]`);
      if (!el) return { shown };
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
    console.log(`  ${ok ? 'ok  ' : 'FAIL'} p.${n}: ${JSON.stringify(r.shown)}、ページの上端 ${r.top}px、canvas ${r.canvas}、黒い画素 ${r.ink}`);
    if (!ok) break;
  }
  if (shot && mode === modes[0]) await page.screenshot({ path: shot });
  if (errors.length) {
    failures++;
    console.log('  エラー:', errors);
  }
  await page.close();
}
await browser.close();
process.exit(failures === 0 ? 0 : 1);
