// 表の幅の見積もり。根拠は book_mruby3/CLAUDE.md「紙面幅の制約（表とコード）」。
const test = require('node:test');
const assert = require('node:assert');
const { parseTsize, parseLatexWidth, widthLimit, estimateTable, cellWidth, displayWidth, parseReview, AUTHOR_LIMITS, DEFAULT_CHAR_WIDTH } = require('../dist/core.js');

function tableOf(text) {
  const p = parseReview('t.re', text, 'ch');
  return p.blocks.find((b) => b.kind === 'table');
}

test('displayWidth: 全角は 2、半角は 1', () => {
  assert.strictEqual(displayWidth('abc'), 3);
  assert.strictEqual(displayWidth('あいう'), 6);
  assert.strictEqual(displayWidth('（rc）'), 6);
  assert.strictEqual(displayWidth('2026-09-04（rc）'), 16);
});

test('parseLatexWidth', () => {
  assert.strictEqual(parseLatexWidth('0.62\\textwidth'), 0.62);
  assert.strictEqual(parseLatexWidth('3cm'), 0);
});

test('parseTsize: |latex| を落として列を読む', () => {
  assert.deepStrictEqual(parseTsize('|latex||l|l|P{0.62\\textwidth}|'), [
    { kind: 'auto' },
    { kind: 'auto' },
    { kind: 'fixed', width: 0.62 },
  ]);
  assert.strictEqual(parseTsize(''), undefined);
});

test('parseTsize: @{} などの飾りは列として数えない', () => {
  assert.deepStrictEqual(parseTsize('|latex||@{}l|P{0.5\\textwidth}@{}|'), [
    { kind: 'auto' },
    { kind: 'fixed', width: 0.5 },
  ]);
});

test('widthLimit: 著者の値（2/3/4 列）と、それ以外の外挿', () => {
  assert.strictEqual(widthLimit(2), AUTHOR_LIMITS[2]);
  assert.strictEqual(widthLimit(3), AUTHOR_LIMITS[3]);
  assert.strictEqual(widthLimit(4), AUTHOR_LIMITS[4]);
  // 0.96 - 0.015 × 列数。2/3/4 の 3 点をちょうど通る式
  assert.ok(Math.abs(widthLimit(5) - 0.885) < 1e-9);
  assert.strictEqual(widthLimit(3, { 3: 0.8 }), 0.8);
});

test('cellWidth: インライン命令は中身だけ、@<br>{} で切って最長を取る', () => {
  assert.strictEqual(cellWidth('@<code>{uint8_t}'), 7);
  assert.strictEqual(cellWidth('長い方の段@<br>{}短い'), 10);
});

test('estimateTable: P{} と l 列の見積もりの和', () => {
  const block = tableOf(
    ['//tsize[|latex||l|P{0.60\\textwidth}|]', '//table[t][cap]{', '見出し\t説明', 'abcde\tほげ', '//}'].join('\n')
  );
  const est = estimateTable(block);
  assert.strictEqual(est.columns, 2);
  assert.strictEqual(est.hasTsize, true);
  // l 列の最長は「見出し」= 6 半角 → 6 × charWidth
  assert.ok(Math.abs(est.widths[0] - 6 * DEFAULT_CHAR_WIDTH) < 1e-9);
  assert.strictEqual(est.widths[1], 0.6);
  assert.strictEqual(est.overflow, false);
});

test('estimateTable: //tsize の無い表は全列 l として見積もる', () => {
  const long = 'あ'.repeat(45); // 半角換算 90 → 90 × 0.011 = 0.99
  const block = tableOf(['//table[t][cap]{', `a\t${long}`, '//}'].join('\n'));
  const est = estimateTable(block);
  assert.strictEqual(est.hasTsize, false);
  assert.strictEqual(est.columns, 2);
  assert.ok(est.total > est.limit, `total=${est.total} limit=${est.limit}`);
  assert.strictEqual(est.overflow, true);
  assert.strictEqual(est.widestColumn, 1);
});

test('estimateTable: 区切り線の行と空行は数えない', () => {
  const block = tableOf(['//table[t][cap]{', 'a\tb', '-----------', 'c\td', '', '//}'].join('\n'));
  const est = estimateTable(block);
  assert.strictEqual(est.columns, 2);
});

test('estimateTable: charWidth を設定で変えられる', () => {
  const block = tableOf(['//table[t][cap]{', 'abcdefghij\tx', '//}'].join('\n'));
  assert.ok(Math.abs(estimateTable(block, { charWidth: 0.012 }).widths[0] - 0.12) < 1e-9);
  assert.ok(Math.abs(estimateTable(block, { charWidth: 0.011 }).widths[0] - 0.11) < 1e-9);
});
