// 紙面（本の PDF）と編集画面（紙面に近い見た目）で、改行の位置がどれくらい合うかを数える。合わせ込みはしない。
//
//   node tools/compare-page.mjs <本のディレクトリ> [--images <出力先ディレクトリ> <ファイル>:<見出しの題> ...] [--json <出力>]
//
// 1. PDF の本文の行（明朝の和文がある行）を pdf.js で取り、行をつないだ 1 本の文字列と、行の切れ目の位置を作る
// 2. 編集画面（dist/webview.js、設定 editor.page の既定）で本の章を全部開き、地の文の行（見出し・箇条・ブロック・
//    コメントでない行）を、画面に出ている行（折り返しを含む）に分ける。段落は空行までの地の文の行のまとまり
// 3. 段落の文字列（畳んだ表示の文字）が PDF の文字列にそのまま 1 か所だけ見つかる段落について、PDF の改行の位置に
//    編集画面の改行（折り返しか原稿の改行）があるかを数える。参照の札（PDF では「第 3 章」などになる）を含む段落や、
//    PDF を作った後で直した段落は文字列が合わないので数えない（数えなかった段落の数も出す）
// 4. --images で、指定した節の PDF のページと編集画面を横に並べた画像を作る
//
// 文字列は NFKC にして空白を除き、PDF の字形の差し替え（∕ → /、‧ → ・）をそろえる（book_mruby3 の tools/pdf_pages.py と同じ考え方）。
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, '..');
const core = require(path.join(repo, 'dist', 'core.js'));
const { chromium } = require('playwright-core');
const pdfjs = await import(path.join(repo, 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));

const args = process.argv.slice(2);
const root = path.resolve(args[0] ?? '');
const imgIdx = args.indexOf('--images');
const imageDir = imgIdx >= 0 ? args[imgIdx + 1] : undefined;
const imageTargets = imgIdx >= 0 ? args.slice(imgIdx + 2).filter((a) => !a.startsWith('--')) : [];
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;

const index = new core.ReviewIndex(root);
index.build();
const config = index.config.editor;
const textWidth = core.resolveTextWidth(root, config);
const pageLoad = core.loadPageIndex(index);
const pdfPath = index.abs(index.config.pdf);
const pdfBytes = fs.readFileSync(pdfPath);

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '').replace(/∕/g, '/').replace(/‧/g, '・');

// ---------------------------------------------------------------------------
// 1. PDF の本文の行
const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBytes), disableFontFace: true, verbosity: 0 }).promise;
const cleanFont = (n) => n.replace(/^[A-Z]{6}\+/, '');
let stream = '';
const pdfBreaks = new Set(); // stream の中の、PDF の行の終わりの位置
const pdfLineStarts = []; // [stream の位置, ページ]
for (let n = 1; n <= doc.numPages; n++) {
  const page = await doc.getPage(n);
  await page.getOperatorList();
  const tc = await page.getTextContent();
  const lines = [];
  for (const it of tc.items) {
    if (!it.str) continue;
    let font = it.fontName;
    try {
      font = cleanFont(page.commonObjs.get(it.fontName).name);
    } catch {
      /* そのまま */
    }
    const y = it.transform[5];
    let l = lines.find((x) => Math.abs(x.y - y) < 0.5);
    if (!l) lines.push((l = { y, items: [] }));
    l.items.push({ x: it.transform[4], str: it.str, font });
  }
  lines.sort((a, b) => b.y - a.y);
  for (const l of lines) {
    // 本文の行: 明朝の和文があり、ゴシック（見出し・キャプション・柱）が無い
    if (!l.items.some((i) => /SerifCJK/.test(i.font)) || l.items.some((i) => /SansCJK|NimbusSan/.test(i.font))) continue;
    l.items.sort((a, b) => a.x - b.x);
    const t = norm(l.items.map((i) => i.str).join(''));
    if (!t) continue;
    pdfLineStarts.push([stream.length, n]);
    stream += t;
    pdfBreaks.add(stream.length);
  }
}

// ---------------------------------------------------------------------------
// 2. 編集画面の行
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 4000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(pathToFileURL(path.join(here, 'editor-harness.html')).toString());

function dataFor(rel, text) {
  index.updateFile(rel, text);
  const parsed = index.files.get(rel);
  return {
    refs: core.refLabels(index, parsed),
    images: {},
    completions: [],
    ...(pageLoad.pages ? { pages: core.headingPages(index, pageLoad.pages, rel, parsed), pagesStale: false } : {}),
  };
}

async function openFile(rel) {
  const text = fs.readFileSync(index.abs(rel), 'utf8');
  await page.evaluate(
    async ({ text, data, config, textWidth }) => {
      window.__reviewAssistHost = [];
      window.postMessage({ type: 'init', text, eol: '\n', config, textWidth, seq: 0, ...data }, '*');
      await new Promise((r) => setTimeout(r, 0));
      await document.fonts.ready;
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    { text, data: dataFor(rel, text), config, textWidth }
  );
  return text;
}

/** 地の文の段落ごとの、画面の行（折り返しと原稿の改行で切れた文字列）の並び。 */
async function editorParagraphs() {
  return page.evaluate(async () => {
    const view = window.__reviewAssist.view;
    const plan = window.__reviewAssist.plan();
    const raf = () => new Promise((r) => requestAnimationFrame(() => r()));
    const doc = view.state.doc;
    // 地の文の行: prose で、見出し・箇条・空行でない
    const special = new Set();
    for (const it of plan.items) if (it.t === 'heading' || it.t === 'list') special.add(it.line);
    const isProse = (ln) => plan.lineKinds[ln] === 'prose' && !special.has(ln) && doc.line(ln + 1).length > 0;
    const rowsOfLine = (el) => {
      const rows = [];
      let cur = '';
      let top;
      const range = document.createRange();
      // 新しい行とみなす下がり幅: 行の送りの半分（同じ行の中の書体の違いによる上端の差より大きく、次の行より小さい）
      const step = parseFloat(getComputedStyle(el).lineHeight) / 2;
      const push = (text, t) => {
        if (top !== undefined && t > top + step) {
          rows.push(cur);
          cur = '';
        }
        if (top === undefined || t > top + step) top = t;
        cur += text;
      };
      const walk = (node) => {
        for (const c of node.childNodes) {
          if (c.nodeType === 3) {
            for (let i = 0; i < c.data.length; i++) {
              range.setStart(c, i);
              range.setEnd(c, i + 1);
              const rects = range.getClientRects();
              if (rects.length === 0) continue;
              push(c.data[i], rects[rects.length - 1].top);
            }
          } else if (c.nodeType === 1) {
            if (c.classList.contains('cm-ra-chip') || c.classList.contains('cm-widgetBuffer')) {
              if (c.textContent) push(c.textContent, c.getBoundingClientRect().top);
            } else walk(c);
          }
        }
      };
      walk(el);
      if (cur) rows.push(cur);
      return rows;
    };
    // カーソルは先頭（章の題）に置き、地の文の記法はどれも畳まれている
    view.dispatch({ selection: { anchor: 0 } });
    const paragraphs = [];
    let para;
    for (let ln = 0; ln < doc.lines; ln++) {
      if (!isProse(ln)) {
        if (para) paragraphs.push(para);
        para = undefined;
        continue;
      }
      const pos = doc.line(ln + 1).from;
      if (pos < view.viewport.from || pos > view.viewport.to) {
        view.dispatch({ effects: window.__reviewAssistScroll(pos) });
        await raf();
        await raf();
      }
      let el;
      for (const e of view.contentDOM.children) if (e.classList.contains('cm-line') && view.posAtDOM(e, 0) === pos) el = e;
      if (!el) continue;
      para ??= { line: ln + 1, rows: [], sourceBreaks: [] };
      if (para.rows.length > 0) para.sourceBreaks.push(para.rows.length);
      para.rows.push(...rowsOfLine(el));
    }
    if (para) paragraphs.push(para);
    return paragraphs;
  });
}

// ---------------------------------------------------------------------------
// 3. 数える
const files = [...index.files.keys()].filter((f) => index.chapterOfFile(f)).sort();
const single = { paragraphs: 0, pdfBreaks: 0, hit: 0, hitNear1: 0, editorBreaks: 0 };
const totals = { paragraphs: 0, matched: 0, notFound: 0, ambiguous: 0, pdfBreaks: 0, hit: 0, hitNear1: 0, editorBreaks: 0, editorWraps: 0, sourceBreaks: 0, extraWraps: 0, extraSource: 0 };
const perLine = { pdf: [], editor: [] };
const examples = [];
for (const rel of files) {
  await openFile(rel);
  const paras = await editorParagraphs();
  for (const p of paras) {
    totals.paragraphs++;
    const rows = p.rows.map(norm);
    const text = rows.join('');
    if (text.length < 10) continue;
    const at = stream.indexOf(text);
    if (at < 0) {
      totals.notFound++;
      continue;
    }
    if (stream.indexOf(text, at + 1) >= 0) {
      totals.ambiguous++;
      continue;
    }
    totals.matched++;
    // 段落の中の PDF の改行（段落の終わりは数えない）
    const pdfIn = [];
    for (let k = at + 1; k < at + text.length; k++) if (pdfBreaks.has(k)) pdfIn.push(k - at);
    // 編集画面の改行（折り返しと原稿の改行）
    const edIn = [];
    const sourceAt = new Set();
    let acc = 0;
    rows.forEach((r, i) => {
      acc += r.length;
      if (i < rows.length - 1) {
        edIn.push(acc);
        if (p.sourceBreaks.includes(i + 1)) sourceAt.add(acc);
      }
    });
    const edSet = new Set(edIn);
    totals.pdfBreaks += pdfIn.length;
    for (const b of pdfIn) {
      if (edSet.has(b)) totals.hit++;
      if (edSet.has(b) || edSet.has(b - 1) || edSet.has(b + 1)) totals.hitNear1++;
    }
    // 原稿で 1 行の段落（原稿の改行が無い）だけ: 折り返しの位置そのものが合うか
    if (p.sourceBreaks.length === 0) {
      single.paragraphs++;
      single.pdfBreaks += pdfIn.length;
      single.editorBreaks += edIn.length;
      for (const b of pdfIn) {
        if (edSet.has(b)) single.hit++;
        if (edSet.has(b) || edSet.has(b - 1) || edSet.has(b + 1)) single.hitNear1++;
      }
    }
    const pdfSet = new Set(pdfIn);
    for (const b of edIn) {
      totals.editorBreaks++;
      if (sourceAt.has(b)) {
        totals.sourceBreaks++;
        if (!pdfSet.has(b)) totals.extraSource++;
      } else {
        totals.editorWraps++;
        if (!pdfSet.has(b)) totals.extraWraps++;
      }
    }
    // 1 行の文字数（段落の最後の行と、原稿の改行の前の行は数えない = 折り返した行だけ）
    let prev = 0;
    for (const b of pdfIn) {
      perLine.pdf.push(b - prev);
      prev = b;
    }
    prev = 0;
    for (const b of edIn) {
      if (!sourceAt.has(b)) perLine.editor.push(b - prev);
      prev = b;
    }
    if (examples.length < 5 && pdfIn.length > 0) examples.push({ file: rel, line: p.line, pdf: pdfIn, editor: edIn, source: [...sourceAt] });
  }
  console.log(`${rel}: 段落 ${paras.length}`);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : undefined;
};
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : '-');
console.log('');
console.log(`段落 ${totals.paragraphs}、PDF に同じ文字列が 1 か所だけあった ${totals.matched}、無かった ${totals.notFound}、2 か所以上 ${totals.ambiguous}`);
console.log(`PDF の段落の中の改行 ${totals.pdfBreaks}: 編集画面も同じ位置で改行 ${totals.hit}（${pct(totals.hit, totals.pdfBreaks)}）、±1 文字 ${totals.hitNear1}（${pct(totals.hitNear1, totals.pdfBreaks)}）`);
console.log(
  `編集画面の改行 ${totals.editorBreaks}: 折り返し ${totals.editorWraps}（うち PDF に無い ${totals.extraWraps}）、原稿の改行 ${totals.sourceBreaks}（うち PDF に無い ${totals.extraSource}）`
);
console.log(
  `原稿で 1 行の段落 ${single.paragraphs}: PDF の改行 ${single.pdfBreaks}、同じ位置 ${single.hit}（${pct(single.hit, single.pdfBreaks)}）、` +
    `±1 文字 ${single.hitNear1}（${pct(single.hitNear1, single.pdfBreaks)}）、編集画面の折り返し ${single.editorBreaks}`
);
console.log(`折り返した 1 行の文字数（中央値）: PDF ${median(perLine.pdf)}、編集画面 ${median(perLine.editor)}（行 ${perLine.pdf.length} / ${perLine.editor.length}）`);

// ---------------------------------------------------------------------------
// 4. 並べた画像
if (imageDir) {
  fs.mkdirSync(imageDir, { recursive: true });
  const pdfPage = await browser.newPage({ viewport: { width: 900, height: 1300 } });
  // pdf.js を http で配る（file:// では ES モジュールが読めない）
  const serve = {
    '/pdf.mjs': path.join(repo, 'node_modules', 'pdfjs-dist', 'build', 'pdf.mjs'),
    '/pdf.worker.mjs': path.join(repo, 'node_modules', 'pdfjs-dist', 'build', 'pdf.worker.mjs'),
    '/book.pdf': pdfPath,
  };
  await pdfPage.route('http://ra.test/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    if (p === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body style="margin:0;background:#fff"><canvas id="c"></canvas></body>' });
    const f = serve[p];
    if (!f) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: p.endsWith('.pdf') ? 'application/pdf' : 'text/javascript', body: fs.readFileSync(f) });
  });
  await pdfPage.goto('http://ra.test/');
  for (const target of imageTargets) {
    const [rel, title] = target.split(':');
    const text = await openFile(rel);
    const parsed = core.parseReview(rel, text, index.chapterOfFile(rel));
    const h = parsed.headings.find((x) => x.plainTitle === title);
    if (!h) {
      console.log(`見出しが無い: ${target}`);
      continue;
    }
    const found = core.lookupPage(index, pageLoad.pages, rel, h.span.start.line);
    if (found.kind !== 'ok') continue;
    // 編集画面: 見出しを上に置いて、PDF の本文の幅と同じ px の幅で撮る
    const shot = await page.evaluate(async (line) => {
      const view = window.__reviewAssist.view;
      const pos = view.state.doc.line(line + 1).from;
      view.dispatch({ selection: { anchor: 0 }, effects: window.__reviewAssistScroll(pos) });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const content = view.contentDOM.getBoundingClientRect();
      const top = view.coordsAtPos(pos).top - 8;
      return { x: content.left - 16, y: top, width: content.width + 32, fontPx: parseFloat(getComputedStyle(view.contentDOM).fontSize) };
    }, h.span.start.line);
    const editorPng = path.join(imageDir, `${path.basename(rel, '.re')}-${found.page}-editor.png`);
    // 紙面の 1 ページの高さに当たる px（PDF の本文の幅 412pt が編集画面の本文の幅 textWidth × fontPx に当たる比で）
    const pt = shot.width / (textWidth.zw * shot.fontPx) * 412.13; // 撮る幅に当たる PDF の pt
    const scale = shot.width / pt;
    const heightPx = Math.min(3900 - shot.y, 728.5 * scale);
    await page.screenshot({ path: editorPng, clip: { x: shot.x, y: shot.y, width: shot.width, height: heightPx } });
    // PDF: 同じ倍率で描く
    const pdfPng = path.join(imageDir, `${path.basename(rel, '.re')}-${found.page}-pdf.png`);
    await pdfPage.evaluate(
      async ({ n, scale }) => {
        const pdfjsLib = await import('/pdf.mjs');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
        const d = await pdfjsLib.getDocument('/book.pdf').promise;
        const p = await d.getPage(n);
        const vp = p.getViewport({ scale });
        const c = document.getElementById('c');
        c.width = vp.width;
        c.height = vp.height;
        await p.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      },
      { n: found.page, scale }
    );
    await pdfPage.setViewportSize({ width: Math.ceil(515.91 * scale), height: Math.ceil(728.5 * scale) });
    await pdfPage.locator('#c').screenshot({ path: pdfPng });
    // 横に並べた 1 枚にする（左が PDF、右が編集画面）
    const side = path.join(imageDir, `${path.basename(rel, '.re')}-p${found.page}.png`);
    const sidePage = await browser.newPage({ viewport: { width: 1800, height: 1400 } });
    const img = (f) => `data:image/png;base64,${fs.readFileSync(f).toString('base64')}`;
    await sidePage.setContent(
      `<body style="margin:0;background:#888;display:flex;gap:8px;align-items:flex-start;width:max-content">` +
        `<img src="${img(pdfPng)}"><img src="${img(editorPng)}" style="background:#fff"></body>`
    );
    await sidePage.locator('body').screenshot({ path: side });
    await sidePage.close();
    fs.rmSync(pdfPng);
    fs.rmSync(editorPng);
    console.log(`画像: ${side}（左 PDF p.${found.page}、右 編集画面。倍率 ${scale.toFixed(3)} px/pt）`);
  }
}

await browser.close();
if (errors.length) console.log('pageerror:', errors);
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ totals, single, examples, medians: { pdf: median(perLine.pdf), editor: median(perLine.editor) } }, null, 2));
