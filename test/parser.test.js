// パーサ（VS Code に依存しない層）の単体テスト。
const test = require('node:test');
const assert = require('node:assert');
const { parseReview, parseInlineOps, parseBracketArgs, stripInline } = require('../dist/core.js');

function parse(text) {
  return parseReview('t.re', text, 'ch');
}

test('見出し: レベル・ラベル・修飾子・題', () => {
  const p = parse(['= 章の題', '== 節', '===={lbl} 項', '==[column] コラム', '==[/column]'].join('\n'));
  assert.strictEqual(p.headings.length, 5);
  assert.strictEqual(p.headings[0].level, 1);
  assert.strictEqual(p.headings[0].plainTitle, '章の題');
  assert.strictEqual(p.headings[2].level, 4);
  assert.strictEqual(p.headings[2].label, 'lbl');
  assert.strictEqual(p.headings[2].plainTitle, '項');
  assert.strictEqual(p.headings[3].modifier, 'column');
});

test('見出しの索引の鍵は Re:VIEW と同じ（== から、label があれば label）', () => {
  const p = parse(['= 章', '=={a} A', '=== 補足', '== B', '=== 補足', '==== 深い'].join('\n'));
  const ids = p.headings.map((h) => h.indexId);
  // `=` は索引に入らない
  assert.deepStrictEqual(ids, [undefined, 'a', 'a|補足', 'B', 'B|補足', 'B|補足|深い']);
});

test('column の中の見出しは索引に入らない', () => {
  const p = parse(['= 章', '==[column] コラム', '=== 中', '==[/column]', '== 外', '=== 外の子'].join('\n'));
  const byTitle = Object.fromEntries(p.headings.map((h) => [h.plainTitle, h.indexId]));
  assert.strictEqual(byTitle['中'], undefined);
  assert.strictEqual(byTitle['外の子'], '外|外の子');
});

test('見出しの題にインライン命令があっても素の文字列にする', () => {
  const p = parse('=== @<code>{mrb_state}構造体@<br>{}の話');
  assert.strictEqual(p.headings[0].plainTitle, 'mrb_state構造体の話');
});

test('ブロック: id・キャプション・本文・行の種別', () => {
  const p = parse(['//list[id1][キャプション]{', 'code line', '//}', '', '地の文'].join('\n'));
  assert.strictEqual(p.blocks.length, 1);
  assert.strictEqual(p.blocks[0].kind, 'list');
  assert.strictEqual(p.blocks[0].id, 'id1');
  assert.strictEqual(p.blocks[0].caption, 'キャプション');
  assert.deepStrictEqual(p.blocks[0].body, ['code line']);
  assert.deepStrictEqual(p.lineKinds, ['directive', 'code', 'directive', 'prose', 'prose']);
});

test('本文を持たないブロック（//image、//footnote）', () => {
  const p = parse(['//image[fig][図の説明][scale=1.0]', '//footnote[fn1][脚注の本文]'].join('\n'));
  assert.strictEqual(p.blocks[0].id, 'fig');
  assert.strictEqual(p.blocks[0].caption, '図の説明');
  assert.strictEqual(p.blocks[0].bodyStartLine, -1);
  assert.strictEqual(p.blocks[1].kind, 'footnote');
  assert.strictEqual(p.blocks[1].caption, '脚注の本文');
});

test('//tsize は直後の //table に付く', () => {
  const p = parse(['//tsize[|latex||l|P{0.6\\textwidth}|]', '//table[t][cap]{', 'a\tb', '//}'].join('\n'));
  assert.strictEqual(p.blocks.length, 1);
  assert.strictEqual(p.blocks[0].tsize, '|latex||l|P{0.6\\textwidth}|');
});

test('//tsize と //table の間に地の文があれば付かない', () => {
  const p = parse(['//tsize[|latex||l|l|]', '', '間の文', '//table[t][cap]{', 'a\tb', '//}'].join('\n'));
  assert.strictEqual(p.blocks[0].tsize, undefined);
});

test('parseBracketArgs: \\] は閉じ括弧ではないが \\textwidth の \\t は残る', () => {
  const r = parseBracketArgs('//tsize[|latex||P{0.62\\textwidth}|]', 7);
  assert.deepStrictEqual(r.args, ['|latex||P{0.62\\textwidth}|']);
  const r2 = parseBracketArgs('//image[a][キャプション\\]の中][scale=1]', 7);
  assert.deepStrictEqual(r2.args, ['a', 'キャプション]の中', 'scale=1']);
});

test('parseInlineOps: \\} は閉じ括弧ではない', () => {
  const ops = parseInlineOps('文中の@<code>{"#{b\\}"}と@<b>{強調}。');
  assert.deepStrictEqual(
    ops.map((o) => [o.op, o.arg]),
    [
      ['code', '"#{b}"'],
      ['b', '強調'],
    ]
  );
});

test('parseInlineOps: 閉じていない命令は拾わない', () => {
  assert.deepStrictEqual(parseInlineOps('@<code>{閉じない'), []);
});

test('stripInline: href は表示だけ、br と hidx は消える', () => {
  assert.strictEqual(stripInline('@<href>{http://x,リンク}と@<br>{}と@<hidx>{語}と@<code>{c}'), 'リンクとととc');
});

test('コードブロックの中の @<...> は参照として拾わない', () => {
  const p = parse(['//list[a][cap]{', '@<chap>{これはコード}', '//}', '@<chap>{vm}'].join('\n'));
  // 本文の 1 件だけ。コードの中の @<chap> は拾わない
  assert.deepStrictEqual(
    p.refs.map((r) => [r.op, r.arg]),
    [['chap', 'vm']]
  );
});

test('ブロックのキャプションの中の参照は拾う', () => {
  const p = parse('//footnote[fn][本文は@<chap>{vm}を見よ]');
  assert.deepStrictEqual(
    p.refs.map((r) => [r.op, r.arg]),
    [['chap', 'vm']]
  );
});

test('#@# の行はコメント', () => {
  const p = parse(['#@# TODO: あとで', '地の文'].join('\n'));
  assert.deepStrictEqual(p.lineKinds, ['comment', 'prose']);
  assert.strictEqual(p.refs.length, 0);
});

test('地の文として扱う directive の範囲は id 以外の引数', () => {
  const p = parse('//list[the_id][キャプション]{');
  const spans = p.directiveProseSpans.filter((s) => s.line === 0);
  assert.strictEqual(spans.length, 1);
  assert.strictEqual('//list[the_id][キャプション]{'.slice(spans[0].start, spans[0].end), 'キャプション');
});
