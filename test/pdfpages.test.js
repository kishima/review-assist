// 「この節を PDF で開く」の判断（src/core/pdfpages.ts）。索引 JSON の読み込み、
// カーソル位置 → 鍵の組み立て、上の段・章の先頭への落とし方。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ReviewIndex, loadConfig, loadPageIndex, headingAt, pageKeys, lookupPage } = require('../dist/core.js');

const SAMPLE = path.join(__dirname, 'fixtures', 'sample');

function sampleIndex() {
  const idx = new ReviewIndex(SAMPLE);
  idx.build();
  return idx;
}

// contents/first.re の行（0 起点）:
//   0 `= 最初の章`  2 `== 導入`  9 `=== 細かい話`  ... `==={chap_dup} 仕組み` ... `=== チャート`
function lineOf(idx, text) {
  const parsed = idx.files.get('contents/first.re');
  const n = parsed.lines.findIndex((l) => l.startsWith(text));
  assert.ok(n >= 0, `${text} が fixture に無い`);
  return n;
}

test('loadConfig: pdf と pageIndex を読む', () => {
  const c = loadConfig(SAMPLE).config;
  assert.strictEqual(c.pdf, 'sample.pdf');
  assert.strictEqual(c.pageIndex, 'pages.json');
});

test('loadPageIndex: 索引 JSON を読む', () => {
  const load = loadPageIndex(sampleIndex());
  assert.strictEqual(load.problem, undefined);
  assert.strictEqual(load.path, 'pages.json');
  assert.strictEqual(load.pages['first|導入'], 3);
  assert.strictEqual(load.pages['gen|chap_A'], 21);
});

test('loadPageIndex: 設定が無い・ファイルが無い・壊れている', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-'));
  fs.writeFileSync(path.join(dir, 'catalog.yml'), 'CHAPS:\n');

  const noSetting = new ReviewIndex(dir);
  noSetting.build();
  assert.strictEqual(loadPageIndex(noSetting).problem, 'not-configured');

  fs.writeFileSync(path.join(dir, '.review-assist.json'), JSON.stringify({ pageIndex: 'p.json' }));
  const missing = new ReviewIndex(dir);
  missing.build();
  assert.strictEqual(loadPageIndex(missing).problem, 'missing');

  fs.writeFileSync(path.join(dir, 'p.json'), '{ 壊れている');
  const broken = new ReviewIndex(dir);
  broken.build();
  const r = loadPageIndex(broken);
  assert.strictEqual(r.problem, 'broken');
  assert.ok(r.error);

  // 配列や数以外の値は索引として受け取らない
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify(['a']));
  const arr = new ReviewIndex(dir);
  arr.build();
  assert.strictEqual(loadPageIndex(arr).problem, 'broken');
  fs.writeFileSync(path.join(dir, 'p.json'), JSON.stringify({ a: 1, b: 'x' }));
  const mixed = new ReviewIndex(dir);
  mixed.build();
  assert.deepStrictEqual(loadPageIndex(mixed).pages, { a: 1 });
});

test('headingAt: カーソルの行から見て直近の見出し', () => {
  const idx = sampleIndex();
  const intro = lineOf(idx, '== 導入');
  const detail = lineOf(idx, '=== 細かい話');
  assert.strictEqual(headingAt(idx, 'contents/first.re', 0).plainTitle, '最初の章');
  assert.strictEqual(headingAt(idx, 'contents/first.re', intro).plainTitle, '導入'); // 見出しの行そのもの
  assert.strictEqual(headingAt(idx, 'contents/first.re', intro + 1).plainTitle, '導入');
  assert.strictEqual(headingAt(idx, 'contents/first.re', detail + 1).plainTitle, '細かい話');
  // ファイルの終わりより後を指しても、最後の見出しに落ち着く
  const parsed = idx.files.get('contents/first.re');
  const last = parsed.headings[parsed.headings.length - 1];
  assert.strictEqual(headingAt(idx, 'contents/first.re', parsed.lines.length + 10).plainTitle, last.plainTitle);
  // 索引に無いファイルは見出しが決まらない
  assert.strictEqual(headingAt(idx, 'contents/どこにも無い.re', 0), undefined);
});

test('pageKeys: 見出し → 上の段 → 章の先頭', () => {
  const idx = sampleIndex();
  assert.deepStrictEqual(pageKeys(idx, 'contents/first.re', lineOf(idx, '=== 細かい話') + 1), [
    'first|導入|細かい話',
    'first|導入',
    'first',
  ]);
  // 章の題（`=`）は headline index に入らないので、鍵は章 ID だけ
  assert.deepStrictEqual(pageKeys(idx, 'contents/first.re', 0), ['first']);
  // ラベルのある見出しは、鍵もラベル（Re:VIEW の HeadlineIndex と同じ）
  assert.deepStrictEqual(pageKeys(idx, 'contents/first.re', lineOf(idx, '==={chap_dup}') + 1), [
    'first|導入|chap_dup',
    'first|導入',
    'first',
  ]);
  // 章をまたぐ生成物（chapters で読み替えた sub/*.re）も章 ID は gen
  assert.deepStrictEqual(pageKeys(idx, 'sub/a.re', 0), ['gen|chap_A', 'gen']);
  // 章に属さないファイルは鍵が作れない
  assert.deepStrictEqual(pageKeys(idx, 'contents/どこにも無い.re', 0), []);
});

test('lookupPage: 見出しで当たる', () => {
  const idx = sampleIndex();
  const pages = loadPageIndex(idx).pages;
  const r = lookupPage(idx, pages, 'contents/first.re', lineOf(idx, '=== 細かい話') + 1);
  assert.strictEqual(r.kind, 'ok');
  assert.strictEqual(r.page, 4);
  assert.strictEqual(r.key, 'first|導入|細かい話');
  assert.strictEqual(r.via, 'heading');
  assert.strictEqual(r.heading.plainTitle, '細かい話');
});

test('lookupPage: 索引に無い見出しは上の段へ落ちる', () => {
  const idx = sampleIndex();
  const pages = loadPageIndex(idx).pages;
  // `=== チャート` は fixture の pages.json に入れていない
  const r = lookupPage(idx, pages, 'contents/first.re', lineOf(idx, '=== チャート') + 1);
  assert.strictEqual(r.kind, 'ok');
  assert.strictEqual(r.key, 'first|導入');
  assert.strictEqual(r.page, 3);
  assert.strictEqual(r.via, 'ancestor');
});

test('lookupPage: 見出しより前・上の段も無いときは章の先頭', () => {
  const idx = sampleIndex();
  const pages = loadPageIndex(idx).pages;
  const top = lookupPage(idx, pages, 'contents/first.re', 0);
  assert.strictEqual(top.kind, 'ok');
  assert.strictEqual(top.key, 'first');
  assert.strictEqual(top.via, 'chapter');

  // 読み替えた章（sub/*.re が章 gen の中身）でも、鍵は章 ID + ラベル
  const r = lookupPage(idx, pages, 'sub/b.re', 0);
  assert.strictEqual(r.kind, 'ok');
  assert.strictEqual(r.key, 'gen|chap_B');
  assert.strictEqual(r.page, 24);
});

test('lookupPage: 章ごと索引に無い・章に属さない', () => {
  const idx = sampleIndex();
  const pages = loadPageIndex(idx).pages;
  const notFound = lookupPage(idx, pages, 'contents/after.re', 0);
  assert.strictEqual(notFound.kind, 'not-found');
  assert.deepStrictEqual(notFound.keys, ['after']);

  const noChapter = lookupPage(idx, pages, 'contents/どこにも無い.re', 0);
  assert.strictEqual(noChapter.kind, 'no-chapter');
});
