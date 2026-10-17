// 記法を畳む編集画面（dist/webview.js）を、VS Code 無しで Chromium（Playwright）に開いて確かめる。
//
//   node tools/check-editor.mjs <本のディレクトリ> [--only <ファイル>] [--latency <ファイル>] [--json <出力>]
//
// 本の .re を全部（catalog.yml の章、設定 chapters の元ファイル、生成物も）1 本ずつ開いて:
//   1. pageerror と console.error が 0
//   2. 開いただけでは文字列が 1 文字も変わらない（webview の文書が元と同一、編集の送信が 0）
//   3. 畳んだ記法ごとに、カーソルを外に置くと記法が隠れ、中に置くと記法が出る（行の DOM の文字で見る）
//   4. カーソルを全部の記法に入れて回った後でも文字列が同一
// --latency のファイルでは、打つときの遅さを測る（1 文字ごとの処理の時間と、次の描画までの時間）。
//
// Chromium は ~/.cache/ms-playwright にあるもの（playwright-core 1.63 の chromium-1243）を使う。
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, '..', 'dist', 'core.js'));

const args = process.argv.slice(2);
const root = path.resolve(args[0] ?? '');
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const only = opt('--only');
const latencyFile = opt('--latency');
const jsonOut = opt('--json');
if (!fs.existsSync(path.join(root, 'catalog.yml'))) {
  console.error(`catalog.yml がありません: ${root}`);
  process.exit(2);
}

const index = new core.ReviewIndex(root);
index.build();
// 開く .re: 索引に入るもの全部と、索引から外れた生成物（contents/opcodes.re）も。
const files = [...new Set([...index.files.keys(), ...index.listReFiles()])].sort();
const generated = new Set([...index.chapters.values()].filter((c) => c.generated).map((c) => c.catalogFile));
const isGenerated = (rel) => generated.has(rel);
const targets = only ? files.filter((f) => f === only) : files;

function dataFor(rel, text) {
  index.updateFile(rel, text);
  const parsed = index.files.get(rel) ?? core.parseReview(rel, text, '');
  const images = {};
  for (const [id, p] of Object.entries(core.imagePaths(index, parsed))) {
    const abs = index.abs(p);
    if (fs.existsSync(abs)) images[id] = pathToFileURL(abs).toString();
  }
  const pageLoad = core.loadPageIndex(index);
  return {
    refs: core.refLabels(index, parsed),
    images,
    completions: core.completionCandidates(index, rel),
    ...(pageLoad.pages ? { pages: core.headingPages(index, pageLoad.pages, rel, parsed), pagesStale: false } : {}),
  };
}

const browser = await chromium.launch();
// 縦に長い窓にして、CodeMirror が一度に描く範囲を広げる（スクロールの回数を減らすため）。
const page = await browser.newPage({ viewport: { width: 1200, height: 4000 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
await page.goto(pathToFileURL(path.join(here, 'editor-harness.html')).toString());
await page.waitForFunction(() => window.__reviewAssistHost?.some((m) => m.type === 'ready'));

const results = [];
const totals = { files: 0, items: 0, checked: 0, failures: 0, roundTripFailures: 0, folded: {}, raw: {} };

for (const rel of targets) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  const data = dataFor(rel, text);
  const errBefore = errors.length;
  const t0 = Date.now();
  const r = await page.evaluate(
    async ({ text, data, config, textWidth }) => {
      const raf = () => new Promise((res) => requestAnimationFrame(() => res()));
      window.__reviewAssistHost = [];
      window.postMessage({ type: 'init', text, eol: '\n', config, textWidth, seq: 0, ...data }, '*');
      await new Promise((res) => setTimeout(res, 0));
      await raf();
      const ra = window.__reviewAssist;
      const view = ra.view;
      const sameAfterOpen = view.state.sliceDoc() === text;
      const plan = ra.plan();
      const doc = view.state.doc;
      // 行の DOM を、行の頭の位置で探す（domAtPos は中身を全部隠した行で前の行の終わりを返すことがあるため）。
      const lineText = (pos) => {
        const from = doc.lineAt(pos).from;
        for (const el of view.contentDOM.children) {
          if (!el.classList.contains('cm-line')) continue;
          if (view.posAtDOM(el, 0) === from) return el.textContent;
        }
        return null;
      };
      const ensureVisible = async (pos) => {
        if (pos >= view.viewport.from && pos <= view.viewport.to) return;
        view.dispatch({ effects: window.__reviewAssistScroll(pos) });
        await raf();
        await raf();
      };
      // 確かめる記法: 隠す印がある項目。[置くカーソル, 中にいるとき行に出るはずの文字列, 外のとき行の頭か全体の判定]
      const checks = [];
      for (const it of plan.items) {
        const src = doc.sliceString(it.from, it.to);
        switch (it.t) {
          case 'inline':
            checks.push({ it, at: it.from + 1, inside: (s) => s.includes(src), outside: (s) => !s.includes(src) });
            break;
          case 'heading': {
            const marks = doc.sliceString(it.from, it.markTo);
            if (!marks) break;
            checks.push({ it, at: it.from, inside: (s) => s.startsWith(marks), outside: (s) => !s.startsWith(marks) });
            break;
          }
          case 'list': {
            const marks = doc.sliceString(it.from, it.markerTo);
            checks.push({ it, at: it.from, inside: (s) => s.startsWith(marks), outside: (s) => !s.startsWith(marks) });
            break;
          }
          case 'directive': {
            const head = `//${it.name}`;
            checks.push({ it, at: it.from, inside: (s) => s.startsWith(head), outside: (s) => !s.includes(head) });
            break;
          }
          case 'blockEnd':
          case 'tableRule':
            checks.push({ it, at: it.from, inside: (s) => s === src, outside: (s) => s === '' });
            break;
          default:
            break;
        }
      }
      const failures = [];
      for (const c of checks) {
        const line = doc.lineAt(c.it.from);
        // 外: 別の行（前の行、無ければ次の行）にカーソルを置く
        const other = line.number > 1 ? doc.line(line.number - 1).from : line.number < doc.lines ? doc.line(line.number + 1).from : 0;
        await ensureVisible(c.it.from);
        view.dispatch({ selection: { anchor: other } });
        let out = lineText(c.it.from);
        if (out === null) {
          // 描く範囲の端にあった。真ん中に寄せてからもう一度
          view.dispatch({ effects: window.__reviewAssistScroll(c.it.from) });
          await raf();
          await raf();
          out = lineText(c.it.from);
        }
        view.dispatch({ selection: { anchor: c.at } });
        const ins = lineText(c.it.from);
        const okOut = out !== null && c.outside(out);
        const okIn = ins !== null && c.inside(ins);
        if (!okOut || !okIn) {
          failures.push({ kind: c.it.t, op: c.it.op ?? c.it.name, line: line.number, src: doc.sliceString(c.it.from, c.it.to), out, ins, okOut, okIn });
        }
      }
      const sameAfterWalk = view.state.sliceDoc() === text;
      const edits = window.__reviewAssistHost.filter((m) => m.type === 'edit').length;
      return { sameAfterOpen, sameAfterWalk, edits, items: plan.items.length, checked: checks.length, failures: failures.slice(0, 20), failureCount: failures.length };
    },
    { text, data, config: index.config.editor, textWidth: core.resolveTextWidth(root, index.config.editor) }
  );
  // 数えるのは索引に入る原稿だけ（生成物の contents/opcodes.re は元ファイルと同じ中身なので二重になる）。
  const plan = core.planFolds(text);
  if (index.files.has(rel) && !isGenerated(rel)) for (const [k, n] of core.countFolded(plan)) totals.folded[k] = (totals.folded[k] ?? 0) + n;
  if (index.files.has(rel) && !isGenerated(rel)) for (const [k, n] of core.countRaw(plan)) totals.raw[k] = (totals.raw[k] ?? 0) + n;
  const fileErrors = errors.slice(errBefore);
  const ok = r.sameAfterOpen && r.sameAfterWalk && r.edits === 0 && r.failureCount === 0 && fileErrors.length === 0;
  totals.files++;
  totals.items += r.items;
  totals.checked += r.checked;
  totals.failures += r.failureCount;
  if (!r.sameAfterOpen || !r.sameAfterWalk || r.edits !== 0) totals.roundTripFailures++;
  results.push({ file: rel, bytes: Buffer.byteLength(text), ms: Date.now() - t0, ...r, errors: fileErrors });
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${rel}  ${Buffer.byteLength(text)} B  記法 ${r.checked} 件を確かめた  ${Date.now() - t0} ms` +
      (ok ? '' : `  同一(開いて ${r.sameAfterOpen}・回って ${r.sameAfterWalk})  編集の送信 ${r.edits}  失敗 ${r.failureCount}  エラー ${fileErrors.length}`)
  );
  for (const f of r.failures) console.log(`      ${f.kind} ${f.op} L${f.line} ${JSON.stringify(f.src)} 外=${JSON.stringify(f.out)} 中=${JSON.stringify(f.ins)}`);
  for (const e of fileErrors) console.log(`      ${e}`);
}

let latency;
if (latencyFile) {
  const text = fs.readFileSync(path.join(root, latencyFile), 'utf8');
  const data = dataFor(latencyFile, text);
  latency = await page.evaluate(
    async ({ text, data, config, textWidth }) => {
      const raf = () => new Promise((res) => requestAnimationFrame(() => res()));
      window.__reviewAssistHost = [];
      window.postMessage({ type: 'init', text, eol: '\n', config, textWidth, seq: 0, ...data }, '*');
      await new Promise((res) => setTimeout(res, 0));
      await raf();
      const view = window.__reviewAssist.view;
      // 真ん中あたりの地の文の行末にカーソルを置く
      const plan = window.__reviewAssist.plan();
      let line = Math.floor(view.state.doc.lines / 2);
      while (plan.lineKinds[line - 1] !== 'prose' || view.state.doc.line(line).length === 0) line++;
      const pos = view.state.doc.line(line).to;
      view.dispatch({ selection: { anchor: pos }, effects: window.__reviewAssistScroll(pos) });
      await raf();
      await raf();
      window.__latency = { line, samples: [] };
      return { line };
    },
    { text, data, config: index.config.editor, textWidth: core.resolveTextWidth(root, index.config.editor) }
  );
  // 本物のキー入力（keydown → beforeinput → CodeMirror の更新）。1 文字ごとに、keydown の時刻（event.timeStamp）から
  //   update: CodeMirror が文書と DOM を更新し終えた時（updateListener。畳む一覧と装飾の作り直しを含む）
  //   frame:  その後の最初の requestAnimationFrame（CodeMirror の測り直しが済み、次に描画される）
  // までを取る。
  await page.evaluate(() => {
    const view = window.__reviewAssist.view;
    let t0 = 0;
    let key = '';
    view.contentDOM.addEventListener(
      'keydown',
      (e) => {
        t0 = e.timeStamp;
        key = e.key;
      },
      true
    );
    window.__reviewAssistOnUpdate = (docChanged) => {
      if (!docChanged || t0 === 0) return;
      const start = t0;
      const update = performance.now() - start;
      t0 = 0;
      requestAnimationFrame(() => window.__latency.samples.push({ update, frame: performance.now() - start, key }));
    };
  });
  const typed = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuv';
  for (const ch of typed) {
    await page.keyboard.press(ch);
    await page.waitForTimeout(20);
  }
  await page.waitForTimeout(200);
  // 同期部分の内訳: planFolds（parser を含む）と装飾の作り直し
  const breakdown = await page.evaluate(() => {
    const view = window.__reviewAssist.view;
    const n = 20;
    const t = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      view.dispatch({ changes: { from: view.state.selection.main.head, insert: 'x' }, selection: { anchor: view.state.selection.main.head + 1 } });
      t.push(performance.now() - t0);
    }
    const t2 = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      window.__reviewAssistPlan(view.state.doc.toString());
      t2.push(performance.now() - t0);
    }
    return { dispatch: t, plan: t2 };
  });
  const samples = await page.evaluate(() => window.__latency.samples);
  const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { n: s.length, median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) };
  };
  latency = {
    file: latencyFile,
    bytes: Buffer.byteLength(text),
    line: latency.line,
    keyToUpdate: stat(samples.map((s) => s.update)),
    keyToFrame: stat(samples.map((s) => s.frame)),
    dispatch: stat(breakdown.dispatch),
    planFolds: stat(breakdown.plan),
  };
  console.log(`遅さ ${latencyFile}（${latency.bytes} B、${latency.line} 行目で打った）`);
  console.log(`  キー → 更新の終わり   ${JSON.stringify(latency.keyToUpdate)} ms`);
  console.log(`  キー → 次の rAF       ${JSON.stringify(latency.keyToFrame)} ms`);
  console.log(`  dispatch 1 回         ${JSON.stringify(latency.dispatch)} ms`);
  console.log(`  planFolds 1 回        ${JSON.stringify(latency.planFolds)} ms`);
}

await browser.close();

console.log('');
console.log(`ファイル ${totals.files}、畳む一覧の項目 ${totals.items}、カーソルで確かめた記法 ${totals.checked}、失敗 ${totals.failures}、` +
  `文字列が変わった・編集を送ったファイル ${totals.roundTripFailures}、pageerror と console.error ${errors.length}`);
console.log('畳んだもの:', JSON.stringify(totals.folded));
console.log('記法のまま:', JSON.stringify(totals.raw));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ totals, results, latency, errors }, null, 2));
process.exit(totals.failures === 0 && totals.roundTripFailures === 0 && errors.length === 0 ? 0 : 1);
