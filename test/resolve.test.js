// 参照の解決。規則は Re:VIEW 2.5.0 の inline_hd / Index#[] / HeadlineIndex.parse に合わせてある。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { ReviewIndex, resolveRefDetailed, splitChapterPrefix, lookupIndex, imagePreviewPath } = require('../dist/core.js');

const ROOT = path.join(__dirname, 'fixtures', 'sample');

function index() {
  const idx = new ReviewIndex(ROOT);
  idx.build();
  return idx;
}

/** ファイルの中の n 番目の `@<op>{...}` を取る。 */
function refOf(idx, file, op, arg) {
  const parsed = idx.files.get(file);
  assert.ok(parsed, `${file} が索引にない`);
  const ref = parsed.refs.find((r) => r.op === op && r.arg === arg);
  assert.ok(ref, `${file} に @<${op}>{${arg}} がない`);
  return ref;
}

test('catalog.yml の 4 節すべてから章 ID を作る', () => {
  const idx = index();
  assert.deepStrictEqual(idx.chapterOrder, ['preface', 'first', 'gen', 'appx', 'after']);
  assert.strictEqual(idx.chapters.get('preface').section, 'PREDEF');
  assert.strictEqual(idx.chapters.get('appx').section, 'APPENDIX');
  assert.strictEqual(idx.chapters.get('after').section, 'POSTDEF');
});

test('設定 chapters で章の元ファイルを読み替え、生成物は索引から外す', () => {
  const idx = index();
  const gen = idx.chapters.get('gen');
  assert.strictEqual(gen.generated, true);
  assert.deepStrictEqual(gen.files.sort(), ['sub/a.re', 'sub/b.re']);
  assert.strictEqual(idx.files.has('contents/gen.re'), false);
  assert.strictEqual(idx.chapterOfFile('sub/a.re'), 'gen');
});

test('@<chap> は catalog.yml の章だけ', () => {
  const idx = index();
  assert.strictEqual(resolveRefDetailed(idx, refOf(idx, 'contents/preface.re', 'chap', 'first')).kind, 'hit');
  assert.strictEqual(resolveRefDetailed(idx, refOf(idx, 'contents/first.re', 'chap', 'nosuch')).kind, 'miss');
});

test('splitChapterPrefix は最初の | 1 個だけで切り、章 ID のときだけ章にする', () => {
  const idx = index();
  assert.deepStrictEqual(splitChapterPrefix(idx, 'gen|chap_B|補足'), { chapter: 'gen', rest: 'chap_B|補足' });
  assert.deepStrictEqual(splitChapterPrefix(idx, 'chap_B|補足'), { rest: 'chap_B|補足' });
  assert.deepStrictEqual(splitChapterPrefix(idx, 'chap_B'), { rest: 'chap_B' });
});

test('@<hd>: 道での完全一致', () => {
  const idx = index();
  const r = resolveRefDetailed(idx, refOf(idx, 'contents/first.re', 'hd', '導入|細かい話'));
  assert.strictEqual(r.kind, 'hit');
  assert.strictEqual(r.target.via, 'exact');
  assert.strictEqual(r.target.heading.plainTitle, '細かい話');
});

test('@<hd>: 道の途中の段でも引ける（Index#[] の部分一致）', () => {
  const idx = index();
  const r = resolveRefDetailed(idx, refOf(idx, 'contents/first.re', 'hd', 'chap_dup'));
  assert.strictEqual(r.kind, 'hit');
  assert.strictEqual(r.target.via, 'segment');
  assert.strictEqual(r.target.heading.plainTitle, '仕組み');
});

test('@<hd>: 章 ID を付けると別の章を引く', () => {
  const idx = index();
  const r = resolveRefDetailed(idx, refOf(idx, 'contents/first.re', 'hd', 'gen|chap_A'));
  assert.strictEqual(r.kind, 'hit');
  assert.strictEqual(r.target.file, 'sub/a.re');
  assert.strictEqual(r.target.chapter.id, 'gen');
});

test('@<hd>: 生成物の章では、元ファイルをまたいだ道も引ける', () => {
  const idx = index();
  const r = resolveRefDetailed(idx, refOf(idx, 'sub/b.re', 'hd', 'gen|chap_B|補足'));
  assert.strictEqual(r.kind, 'hit');
  assert.strictEqual(r.target.file, 'sub/b.re');
  const r2 = resolveRefDetailed(idx, refOf(idx, 'sub/a.re', 'hd', 'chap_A|補足'));
  assert.strictEqual(r2.kind, 'hit');
  assert.strictEqual(r2.target.file, 'sub/a.re');
});

test('@<hd>: 最後の段が同じものが 2 つ以上あれば曖昧', () => {
  const idx = index();
  const r = resolveRefDetailed(idx, refOf(idx, 'contents/first.re', 'hd', 'チャート'));
  assert.strictEqual(r.kind, 'ambiguous');
});

test('@<hd>: column の中の見出しは引けない', () => {
  const idx = index();
  const r = resolveRefDetailed(idx, refOf(idx, 'contents/first.re', 'hd', '中の見出し'));
  assert.strictEqual(r.kind, 'miss');
});

test('@<hd>: 無い見出しは miss', () => {
  const idx = index();
  assert.strictEqual(resolveRefDetailed(idx, refOf(idx, 'sub/b.re', 'hd', 'ない見出し')).kind, 'miss');
});

test('@<list> @<table> @<img> @<fn> はそれぞれの種類のブロックを引く', () => {
  const idx = index();
  for (const [op, arg, kind] of [
    ['list', 'code1', 'list'],
    ['table', 't1', 'table'],
    ['img', 'fig1', 'image'],
    ['fn', 'note1', 'footnote'],
  ]) {
    const r = resolveRefDetailed(idx, refOf(idx, 'contents/first.re', op, arg));
    assert.strictEqual(r.kind, 'hit', `@<${op}>{${arg}}`);
    assert.strictEqual(r.target.block.kind, kind);
  }
  assert.strictEqual(resolveRefDetailed(idx, refOf(idx, 'contents/first.re', 'list', 'nosuchlist')).kind, 'miss');
});

test('lookupIndex: 完全一致 → 曖昧 → 部分一致 の順', () => {
  const items = [
    { id: 'a|x', item: 1 },
    { id: 'b|x', item: 2 },
    { id: 'c|y', item: 3 },
  ];
  assert.deepStrictEqual(lookupIndex(items, 'a|x'), { kind: 'hit', item: 1, via: 'exact' });
  assert.deepStrictEqual(lookupIndex(items, 'x'), { kind: 'ambiguous' });
  assert.deepStrictEqual(lookupIndex(items, 'y'), { kind: 'hit', item: 3, via: 'segment' });
  assert.deepStrictEqual(lookupIndex(items, 'c'), { kind: 'hit', item: 3, via: 'segment' });
  assert.deepStrictEqual(lookupIndex(items, 'z'), { kind: 'miss' });
});

test('imagePreview は {chapter} と {id} を置き換える', () => {
  const idx = index();
  const block = idx.blocksOfChapter('first').find((b) => b.id === 'fig1');
  assert.strictEqual(imagePreviewPath(idx, block), 'images/png/first/fig1.png');
});

test('1 ファイルだけ読み直せる', () => {
  const idx = index();
  idx.updateFile('sub/b.re', '=={chap_B} B命令\n\n=== 新しい節\n');
  const headings = idx.headingsOfChapter('gen').map((h) => h.indexId);
  assert.ok(headings.includes('chap_B|新しい節'));
  assert.ok(!headings.includes('chap_B|補足'));
});
