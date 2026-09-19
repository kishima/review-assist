// catalog.yml、glob、アウトライン、設定の読み込み。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseCatalog, chapterIdOf, globToRegExp, matchesAny, buildOutline, parseReview, loadConfig, defaultConfig } = require('../dist/core.js');

test('parseCatalog: 4 節と part の入れ子', () => {
  const text = [
    '# コメント',
    'PREDEF:',
    '  - preface.re',
    '',
    'CHAPS:',
    '  - contents/vm.re',
    '  - part1.re:',
    '    - contents/gc.re',
    '',
    'APPENDIX:',
    '  - contents/appx.re',
    'POSTDEF:',
    '  - after.re',
  ].join('\n');
  const entries = parseCatalog(text);
  assert.deepStrictEqual(
    entries.map((e) => [e.raw, e.section, e.isPart]),
    [
      ['preface.re', 'PREDEF', false],
      ['contents/vm.re', 'CHAPS', false],
      ['part1.re', 'CHAPS', true],
      ['contents/gc.re', 'CHAPS', false],
      ['contents/appx.re', 'APPENDIX', false],
      ['after.re', 'POSTDEF', false],
    ]
  );
});

test('chapterIdOf: ディレクトリと拡張子を落とす', () => {
  assert.strictEqual(chapterIdOf('contents/vm.re'), 'vm');
  assert.strictEqual(chapterIdOf('vm.re'), 'vm');
});

test('globToRegExp: * は / を跨がない、** は跨ぐ', () => {
  assert.ok(globToRegExp('sub/*.re').test('sub/a.re'));
  assert.ok(!globToRegExp('sub/*.re').test('sub/x/a.re'));
  assert.ok(globToRegExp('**/*.re').test('a/b/c.re'));
  assert.ok(globToRegExp('**/*.re').test('c.re'));
  assert.ok(matchesAny('contents/vm.re', ['sub/*.re', 'contents/*.re']));
  assert.ok(!matchesAny('contents/vm.re', ['sub/*.re']));
});

test('buildOutline: 見出しの木の下に id を持つブロックが並ぶ', () => {
  const text = [
    '= 章',
    '== 節',
    '//list[l1][リスト]{',
    'x',
    '//}',
    '//emlist{',
    'y',
    '//}',
    '=== 項',
    '//table[t1][表]{',
    'a\tb',
    '//}',
    '== 次の節',
  ].join('\n');
  const outline = buildOutline(parseReview('t.re', text, 'ch'));
  assert.strictEqual(outline.length, 1);
  const chapter = outline[0];
  assert.strictEqual(chapter.name, '章');
  assert.deepStrictEqual(chapter.children.map((c) => c.name), ['節', '次の節']);
  const sec = chapter.children[0];
  // id を持たない //emlist はアウトラインに出ない
  assert.deepStrictEqual(sec.children.map((c) => c.name), ['list l1', '項']);
  assert.deepStrictEqual(sec.children[1].children.map((c) => c.name), ['table t1']);
});

test('buildOutline: 見出しの範囲は次の同位以上の見出しの手前まで', () => {
  const outline = buildOutline(parseReview('t.re', ['== A', 'x', 'y', '== B', 'z'].join('\n'), 'ch'));
  assert.strictEqual(outline[0].span.start.line, 0);
  assert.strictEqual(outline[0].span.end.line, 2);
});

test('loadConfig: 設定ファイルが無ければ既定値', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-'));
  assert.deepStrictEqual(loadConfig(dir).config, defaultConfig());
  assert.strictEqual(loadConfig(dir).path, undefined);
});

test('loadConfig: 壊れた JSON は error を返し既定値で動く', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-'));
  fs.writeFileSync(path.join(dir, '.review-assist.json'), '{ 壊れている');
  const r = loadConfig(dir);
  assert.ok(r.error);
  assert.deepStrictEqual(r.config, defaultConfig());
});

test('loadConfig: 知っている項目だけを取り込む', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-'));
  fs.writeFileSync(
    path.join(dir, '.review-assist.json'),
    JSON.stringify({ maxCodeLineLength: 100, tableWidth: { charWidth: 0.02 }, 知らない項目: 1 })
  );
  const c = loadConfig(dir).config;
  assert.strictEqual(c.maxCodeLineLength, 100);
  assert.strictEqual(c.tableWidth.charWidth, 0.02);
  assert.strictEqual(c.tableWidth.enable, true); // 既定値が残る
});
