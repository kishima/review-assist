// 編集画面（dist/webview.js）と拡張の側のやりとりを、拡張の側を Node で真似して確かめる。
//
//   node tools/check-editor-sync.mjs <本のディレクトリ> [<ファイル>]
//
// 拡張の側の真似は editor-ui.ts と同じ手順: webview から来た編集を applyTextChanges で文字列に当て、
// ack を返す。外からの変更は全文（text）で送る。確かめること:
//   1. 本物のキー入力（英字、日本語の確定文字列、改行、BackSpace）の後で、拡張の側の文字列と webview の文書が同一
//   2. 外からの変更（取り消しや別のエディタ）を受けると webview の文書がそれに合い、送り返さない
//   3. まだ ack の来ていない編集があるときの外からの変更は、ack の後に sync を頼む（食い違わない）
//   4. マーカーと診断が装飾になり、拡張が古い番号で送った位置が、その後の編集で正しく写る
//   5. 囲む（@<code>{}）・雛形を入れる・参照の候補・マーカーのホバーのボタン
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright-core');
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, '..', 'dist', 'core.js'));

const root = path.resolve(process.argv[2] ?? '');
const rel = process.argv[3] ?? 'contents/preface.re';
const index = new core.ReviewIndex(root);
index.build();
const original = fs.readFileSync(path.join(root, rel), 'utf8');
const parsed = index.files.get(rel);
const data = { refs: core.refLabels(index, parsed), images: {}, completions: core.completionCandidates(index, rel) };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
});
await page.goto(pathToFileURL(path.join(here, 'editor-harness.html')).toString());

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok || !detail ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};

// 拡張の側の真似
let mirror = original;
let appliedSeq = 0;
const take = () => page.evaluate(() => window.__reviewAssistHost.splice(0));
const post = (m) => page.evaluate((m) => window.postMessage(m, '*'), m);
const settle = () => page.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => r()), 0)));
async function pump({ ack = true } = {}) {
  await settle();
  const sent = await take();
  const other = [];
  for (const m of sent) {
    if (m.type === 'edit') {
      mirror = core.applyTextChanges(mirror, m.changes, '\n');
      appliedSeq = m.seq;
      if (ack) await post({ type: 'ack', seq: m.seq });
    } else other.push(m);
  }
  await settle();
  return { sent, other };
}
const docText = () => page.evaluate(() => window.__reviewAssist.view.state.sliceDoc());

await page.evaluate(() => (window.__reviewAssistHost = []));
await post({ type: 'init', text: original, eol: '\n', config: index.config.editor, seq: 0, ...data });
await settle();
await take();

// 1. 本物のキー入力
const lineNo = original.split('\n').findIndex((l, i) => i > 3 && /^[^=#/ ]/.test(l) && l.length > 10);
await page.evaluate((ln) => {
  const v = window.__reviewAssist.view;
  const pos = v.state.doc.line(ln + 1).to;
  v.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
  v.focus();
}, lineNo);
await page.keyboard.type('abc');
await page.keyboard.insertText('日本語の確定');
await page.keyboard.press('Enter');
await page.keyboard.type('xyz');
await page.keyboard.press('Backspace');
await pump();
check('1. キー入力の後、拡張の側の文字列と webview の文書が同一', (await docText()) === mirror);
check('1. 打ったものが入っている', mirror.includes('abc日本語の確定\nxy'));

// 2. 外からの変更（先頭に 1 行足す）
mirror = '#@# 外から足した行\n' + mirror;
await post({ type: 'text', text: mirror, seq: appliedSeq });
const r2 = await pump();
check('2. 外からの変更に合う', (await docText()) === mirror);
check('2. 外からの変更を送り返さない', !r2.sent.some((m) => m.type === 'edit'));

// 3. ack の来ていない編集があるときの外からの変更
await page.keyboard.type('Q');
await settle();
const pendingEdits = (await take()).filter((m) => m.type === 'edit');
// 拡張の側では、その編集を当てる前に外からの変更が来た（例: ディスクからの読み直し）
const external = '#@# もう 1 行\n' + mirror;
await post({ type: 'text', text: external, seq: appliedSeq });
await settle();
const stillOld = await docText();
check('3. ack 前の外からの変更はすぐには当てない', !stillOld.startsWith('#@# もう 1 行'));
// 拡張の側は外からの変更の後に、webview の編集を当てる（位置は少しずれうるが、最後に sync で合わせる）
mirror = external;
for (const m of pendingEdits) {
  mirror = core.applyTextChanges(mirror, m.changes, '\n');
  appliedSeq = m.seq;
  await post({ type: 'ack', seq: m.seq });
}
await settle();
const afterAck = await take();
check('3. ack の後に sync を頼む', afterAck.some((m) => m.type === 'sync'));
await post({ type: 'text', text: mirror, seq: appliedSeq });
await pump();
check('3. sync の後で同一', (await docText()) === mirror);

// 4. マーカーと診断。古い番号（ack 前）で送った位置が、その後の編集で写るか
await page.evaluate(() => {
  const v = window.__reviewAssist.view;
  v.dispatch({ selection: { anchor: 0 } });
});
const markLine = mirror.split('\n').findIndex((l, i) => i > 5 && /^[^=#/ ]/.test(l) && l.length > 10);
const seqBefore = appliedSeq;
await page.keyboard.insertText('先頭に足した\n');
await settle();
const unacked = (await take()).filter((m) => m.type === 'edit');
await post({
  type: 'data',
  seq: seqBefore,
  marks: [
    { id: 'm1', from: { line: markLine, col: 0 }, to: { line: markLine, col: 4 }, kind: 'ai-check', kindLabel: 'AI チェック', color: '#40C8AE', background: '#40C8AE33', status: 'open', note: 'メモ', verdict: 'fix', verdictLabel: '要修正', comment: '理由', hasSuggestion: true, suggestion: '案' },
  ],
  diagnostics: [{ from: { line: markLine, col: 2 }, to: { line: markLine, col: 6 }, severity: 'warning', message: '規則', source: 'review-assist' }],
});
await settle();
const mapped = await page.evaluate((ml) => {
  const v = window.__reviewAssist.view;
  const m = window.__reviewAssist.marks()[0];
  const line = v.state.doc.lineAt(m.from);
  return { line: line.number - 1, col: m.from - line.from, text: v.state.sliceDoc(m.from, m.to), want: v.state.doc.line(ml + 2).text.slice(0, 4) };
}, markLine);
check('4. 古い番号で来たマーカーの位置が、後の編集（1 行足した）で写る', mapped.line === markLine + 1 && mapped.text === mapped.want, JSON.stringify(mapped));
for (const m of unacked) {
  mirror = core.applyTextChanges(mirror, m.changes, '\n');
  appliedSeq = m.seq;
  await post({ type: 'ack', seq: m.seq });
}
await settle();
const deco = await page.evaluate((ml) => {
  const v = window.__reviewAssist.view;
  const pos = v.state.doc.line(ml + 2).from;
  v.dispatch({ effects: window.__reviewAssistScroll(pos) });
  return new Promise((r) =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => r({ mark: document.querySelectorAll('.cm-ra-mark').length, diag: document.querySelectorAll('.cm-ra-diag-warning').length }))
    )
  );
}, markLine);
check('4. マーカーと診断が装飾になる', deco.mark > 0 && deco.diag > 0, JSON.stringify(deco));

// ホバーとボタン
// マーカー（0〜4 桁）と診断（2〜6 桁）の両方に入る 3 桁目
const box = await page.evaluate(() => {
  const v = window.__reviewAssist.view;
  const m = window.__reviewAssist.marks()[0];
  const a = v.coordsAtPos(m.from + 3, 1);
  return { x: a.left + 1, y: (a.top + a.bottom) / 2 };
});
await page.mouse.move(box.x, box.y);
await page.waitForSelector('.cm-ra-hover', { timeout: 3000 }).catch(() => undefined);
const hover = await page.evaluate(() => {
  const h = document.querySelector('.cm-ra-hover');
  return h ? { text: h.textContent, buttons: [...h.querySelectorAll('button')].map((b) => b.textContent) } : null;
});
check('4. ホバーにメモ・AI の結果・診断・ボタン', !!hover && hover.text.includes('メモ: メモ') && hover.text.includes('要修正') && hover.text.includes('規則') && hover.buttons.includes('案を当てる'), JSON.stringify(hover));
if (hover) {
  await page.click('.cm-ra-hover button');
  const sent = await take();
  check('4. ボタンでコマンドを頼む', sent.some((m) => m.type === 'command' && m.command === 'reviewAssist.toggleMarkDone' && m.args[0] === 'm1'), JSON.stringify(sent));
}
await page.mouse.move(5, 5);

// 5. 囲む
await page.evaluate((ml) => {
  const v = window.__reviewAssist.view;
  const l = v.state.doc.line(ml + 2);
  v.dispatch({ selection: { anchor: l.from, head: l.from + 3 } });
}, markLine);
const selected = await page.evaluate(() => {
  const v = window.__reviewAssist.view;
  const s = v.state.selection.main;
  return v.state.sliceDoc(s.from, s.to);
});
await post({ type: 'wrap', op: 'code' });
await pump();
check('5. 選んだ所を @<code>{} で囲む', mirror.includes(`@<code>{${selected.replace(/\\/g, '\\\\').replace(/\}/g, '\\}')}}`) && (await docText()) === mirror);

// 雛形
const tpl = core.BLOCK_TEMPLATES[0];
await page.evaluate(() => {
  const v = window.__reviewAssist.view;
  v.dispatch({ selection: { anchor: 0 } });
});
await post({ type: 'insert', text: tpl.text, cursor: tpl.cursor });
await pump();
const cursor = await page.evaluate(() => window.__reviewAssist.view.state.selection.main.head);
check('5. 雛形を入れ、カーソルを id の所に置く', mirror.startsWith(tpl.text) && cursor === tpl.cursor && (await docText()) === mirror);

// 参照の候補
await page.evaluate(() => {
  const v = window.__reviewAssist.view;
  v.dispatch({ selection: { anchor: v.state.doc.line(v.state.doc.lines).to } });
  v.focus();
});
await page.keyboard.press('Enter');
await page.keyboard.type('@<chap>{');
await page.waitForSelector('.cm-tooltip-autocomplete li', { timeout: 3000 }).catch(() => undefined);
const options = await page.evaluate(() => [...document.querySelectorAll('.cm-tooltip-autocomplete li')].map((li) => li.textContent));
check('5. @<chap>{ で章の候補', options.length === index.chapterOrder.length, `${options.length} 件`);
await page.keyboard.press('Enter');
await pump();
const lastLine = mirror.split('\n').pop();
check('5. 候補を選ぶと @<chap>{id} が閉じる', /^@<chap>\{[^}]+\}$/.test(lastLine) && (await docText()) === mirror, JSON.stringify(lastLine));

check('pageerror と console.error が 0', errors.length === 0, errors.join(' / '));
await browser.close();
console.log(failures === 0 ? 'すべて通った' : `${failures} 件失敗`);
process.exit(failures === 0 ? 0 : 1);
