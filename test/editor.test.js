// 記法を畳む編集画面（0.3.0）の、VS Code にも webview にも依存しない部分:
// 畳む一覧（src/core/fold.ts）、入力の助け（editing.ts）、拡張から送るもの（editor-data.ts）、設定 editor。
// webview の中身そのもの（CodeMirror の表示）は tools/check-editor.mjs が Chromium で確かめる。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  planFolds,
  countRaw,
  countFolded,
  parseReview,
  wrapInline,
  parseInlineOps,
  BLOCK_TEMPLATES,
  refKey,
  refLabels,
  completionCandidates,
  imagePaths,
  markViews,
  applyTextChanges,
  captureMark,
  defaultMarksConfig,
  readEditorConfig,
  defaultEditorConfig,
  ReviewIndex,
} = require('../dist/core.js');

const ROOT = path.join(__dirname, 'fixtures', 'sample');
const OPT = { tableGap: 2 };

function items(text, t) {
  return planFolds(text, OPT).items.filter((i) => i.t === t);
}

test('parser: 箇条の行（Re:VIEW 2.5.0 の compile_block と同じ形）', () => {
  const p = parseReview('t.re', [' * 一', ' ** 二', ' 1. 番号', ' : 語', '\t説明', '* 行頭の星は地の文', '=見出しでない'].join('\n'), 'ch');
  assert.deepStrictEqual(
    p.listItems.map((l) => [l.line, l.kind, l.depth, l.markerStart, l.markerEnd]),
    [
      [0, 'ul', 1, 1, 3],
      [1, 'ul', 2, 1, 4],
      [2, 'ol', 1, 1, 4],
      [3, 'dl', 1, 1, 3],
    ]
  );
});

test('parser: ブロックの中の箇条の形は箇条にしない', () => {
  const p = parseReview('t.re', ['//list[a][b]{', ' * コードの中', '//}'].join('\n'), 'ch');
  assert.strictEqual(p.listItems.length, 0);
});

test('畳む: インライン命令の範囲と中身、逃がしの \\ の位置', () => {
  const text = '前@<code>{a\\}b}後@<b>{太}';
  const [code, b] = items(text, 'inline');
  assert.strictEqual(code.op, 'code');
  assert.strictEqual(text.slice(code.from, code.to), '@<code>{a\\}b}');
  assert.strictEqual(text.slice(code.argFrom, code.argTo), 'a\\}b');
  assert.strictEqual(code.arg, 'a}b');
  assert.deepStrictEqual(code.escapes.map((e) => text[e] + text[e + 1]), ['\\}']);
  assert.strictEqual(b.op, 'b');
  assert.strictEqual(text.slice(b.argFrom, b.argTo), '太');
});

test('畳む: @<href>{url,表示} の , の位置', () => {
  const text = '@<href>{https://example.com/,例}と@<href>{https://a.example}';
  const [h1, h2] = items(text, 'inline');
  assert.strictEqual(text.slice(h1.comma + 1, h1.argTo), '例');
  assert.strictEqual(h2.comma, undefined);
});

test('畳む: 見出しの印（= と修飾子とラベル）の終わり', () => {
  const text = ['= 章', '=={lbl} 節', '===[column] コラム'].join('\n');
  const hs = items(text, 'heading');
  assert.deepStrictEqual(
    hs.map((h) => [h.level, text.slice(h.from, h.markTo), h.label, h.modifier]),
    [
      [1, '= ', undefined, undefined],
      [2, '=={lbl} ', 'lbl', undefined],
      [3, '===[column] ', undefined, 'column'],
    ]
  );
});

test('畳む: ブロック（頭、本文、終わり）とキャプション', () => {
  const text = ['//list[id1][キャプ@<code>{x}]{', 'puts @<b>{1}', '//}', '', '//emlist{', 'a', '//}'].join('\n');
  const plan = planFolds(text, OPT);
  const dirs = plan.items.filter((i) => i.t === 'directive');
  assert.deepStrictEqual(
    dirs.map((d) => [d.name, d.look, d.id, d.caption, d.endLine]),
    [
      ['list', 'code', 'id1', 'キャプ@<code>{x}', 2],
      ['emlist', 'code', undefined, undefined, 6],
    ]
  );
  assert.deepStrictEqual(plan.items.filter((i) => i.t === 'body').map((b) => b.line), [1, 5]);
  assert.deepStrictEqual(plan.items.filter((i) => i.t === 'blockEnd').map((b) => b.line), [2, 6]);
  // コードの中の @<b> は畳まない（parser が参照として拾わない）。キャプションの @<code> は畳む
  assert.deepStrictEqual(plan.items.filter((i) => i.t === 'inline').map((i) => [i.line, i.op]), [[0, 'code']]);
});

test('畳む: 表の行、区切りの行、列をそろえる幅（半角換算、インライン命令は中身だけ）', () => {
  const text = ['//tsize[|latex||l|l|]', '//table[t][表]{', '名前\t説明', '------------', 'ab\t@<code>{x}', 'abcdef\t\tz', '//}'].join('\n');
  const plan = planFolds(text, OPT);
  const ts = plan.items.find((i) => i.t === 'directive' && i.name === 'tsize');
  assert.strictEqual(ts.args[0], '|latex||l|l|');
  const rows = plan.items.filter((i) => i.t === 'tableRow');
  assert.deepStrictEqual(rows.map((r) => [r.line, r.header, r.firstColumnHeader]), [
    [2, true, false],
    [4, false, false],
    [5, false, false],
  ]);
  // 1 列目の最も広いセルは「名前」（全角 2 字 = 4）と abcdef（6）の 6。差に間 2 を足す
  assert.deepStrictEqual(rows.map((r) => r.seps.map((s) => s.pad)), [[6 - 4 + 2], [6 - 2 + 2], [6 - 6 + 2]]);
  // タブが 2 つ並んでも 1 つの区切り（Re:VIEW の split(/\t+/)）
  assert.strictEqual(text.slice(rows[2].seps[0].from, rows[2].seps[0].to), '\t\t');
  assert.deepStrictEqual(plan.items.filter((i) => i.t === 'tableRule').map((r) => r.line), [3]);
});

test('畳む: 区切りの行が無い表は 1 列目が見出し（Re:VIEW 2.5.0 Builder#table）', () => {
  const rows = items(['//table[t][表]{', 'a\tb', '//}'].join('\n'), 'tableRow');
  assert.strictEqual(rows[0].header, false);
  assert.strictEqual(rows[0].firstColumnHeader, true);
});

test('畳む: 図・脚注・引用・改ページ・コメント・箇条', () => {
  const text = [
    '//image[fig][図の説明][scale=0.5]',
    '//footnote[fn1][脚注の文]',
    '//quote{',
    '引用',
    '//}',
    '//pagebreak',
    '#@# コメント',
    ' * 箇条',
    ' 2. 二番',
  ].join('\n');
  const plan = planFolds(text, OPT);
  assert.deepStrictEqual(
    plan.items.filter((i) => i.t === 'directive').map((d) => [d.name, d.look]),
    [
      ['image', 'image'],
      ['footnote', 'footnote'],
      ['quote', 'quote'],
      ['pagebreak', 'pagebreak'],
    ]
  );
  assert.deepStrictEqual(plan.items.filter((i) => i.t === 'body').map((b) => [b.line, b.look]), [[3, 'quote']]);
  assert.deepStrictEqual(plan.items.filter((i) => i.t === 'comment').map((c) => c.line), [6]);
  const lists = plan.items.filter((i) => i.t === 'list');
  assert.deepStrictEqual(lists.map((l) => [l.kind, l.number]), [
    ['ul', undefined],
    ['ol', '2'],
  ]);
});

test('畳む: 見せ方を決めていない記法は raw として残し、数えられる', () => {
  const text = ['//note[注]{', '中', '//}', '@<kw>{語}と@<code>{x}', '@<m>$x^2$'].join('\n');
  const plan = planFolds(text, OPT);
  assert.deepStrictEqual([...countRaw(plan)].sort(), [
    ['//note', 1],
    ['@<kw>', 1],
    ['@<m>$…$', 1],
  ]);
  assert.strictEqual(countFolded(plan).get('@<code>'), 1);
});

test('畳む: CRLF でも通しの位置は行の切れ目を 1 文字と数える（CodeMirror と同じ）', () => {
  const lf = planFolds('a\n@<code>{x}', OPT).items.find((i) => i.t === 'inline');
  const crlf = planFolds('a\r\n@<code>{x}', OPT).items.find((i) => i.t === 'inline');
  assert.strictEqual(crlf.from, lf.from);
  assert.strictEqual(crlf.from, 2);
});

test('畳む: 位置の並びは前から（装飾を作るときにそのまま使う）', () => {
  const plan = planFolds(['== @<code>{a}', ' * @<b>{b}', '//list[x][y]{', 'z', '//}'].join('\n'), OPT);
  for (let i = 1; i < plan.items.length; i++) assert.ok(plan.items[i - 1].from <= plan.items[i].from);
});

test('囲む: @<op>{} と、中の } と \\ の逃がし（parser で読み戻すと元の文字列）', () => {
  for (const s of ['plain', 'a}b', 'x\\y', '#{b}', '\\}', '']) {
    const w = wrapInline('code', s);
    const [op] = parseInlineOps(w);
    assert.strictEqual(op.arg, s, JSON.stringify(s));
    assert.strictEqual(op.end, w.length);
  }
  assert.strictEqual(wrapInline('b', 'a}b'), '@<b>{a\\}b}');
  assert.strictEqual(wrapInline('code', '1行目\n2行目'), undefined);
});

test('雛形: ブロックの雛形は parser がブロックとして読む', () => {
  for (const t of BLOCK_TEMPLATES) {
    const p = parseReview('t.re', t.text, 'ch');
    assert.ok(p.lineKinds[0] === 'directive', t.label);
    assert.ok(t.cursor >= 0 && t.cursor <= t.text.length, t.label);
    // 本文を持つものは //} で閉じている
    if (t.text.includes('{\n')) assert.ok(p.blocks.length === 1 && p.lines[p.blocks[0].span.end.line] === '//}', t.label);
  }
  const table = BLOCK_TEMPLATES.find((t) => t.text.startsWith('//table'));
  assert.ok(/^-{12}$/m.test(table.text), '区切りの行は 12 文字（Re:VIEW の /\\A[=-]{12}/）');
});

function index() {
  const idx = new ReviewIndex(ROOT);
  idx.build();
  return idx;
}

test('札: 参照先の題、見つからないもの、曖昧なもの', () => {
  const idx = index();
  const labels = refLabels(idx, idx.files.get('contents/first.re'));
  assert.deepStrictEqual(labels[refKey('list', 'code1')], { text: 'サンプル。R(n) はキャプションなので地の文', ok: true });
  assert.deepStrictEqual(labels[refKey('fn', 'note1')], { text: '脚注の本文。genも見よ', ok: true });
  assert.strictEqual(labels[refKey('chap', 'nosuch')].ok, false);
  assert.strictEqual(labels[refKey('list', 'nosuchlist')].ok, false);
  assert.deepStrictEqual(labels[refKey('hd', 'チャート')], { text: 'チャート', ok: false, ambiguous: true });
  assert.strictEqual(labels[refKey('hd', '導入|細かい話')].text, '細かい話');
});

test('候補: 同じ章は id だけ、ほかの章は 章ID|id、章は章 ID', () => {
  const idx = index();
  const c = completionCandidates(idx, 'contents/first.re');
  const ids = (op) => c.filter((x) => x.op === op).map((x) => x.id);
  assert.deepStrictEqual(ids('chap'), idx.chapterOrder);
  assert.ok(ids('list').includes('code1'));
  assert.ok(ids('table').includes('t1'));
  assert.ok(ids('img').includes('fig1'));
  assert.ok(ids('hd').some((id) => id.startsWith('gen|')));
  assert.ok(!ids('hd').some((id) => id.startsWith('first|')));
});

test('図: //image の id → 設定 imagePreview のパス', () => {
  const idx = index();
  const paths = imagePaths(idx, idx.files.get('contents/first.re'));
  assert.ok('fig1' in paths);
});

test('マーカー: 今の文字列で探し直した位置（行と桁）と AI の結果', () => {
  const cfg = defaultMarksConfig();
  const text = '一行目\n二行目の文。ここに印。\n三行目';
  const start = text.indexOf('ここに印');
  const m = captureMark({ text, file: 'a.re', start, end: start + 4, kind: 'ai-check', note: 'メモ', contextLength: 32, existingIds: [] });
  const data = { version: 1, marks: [m, { ...m, id: 'other', file: 'b.re' }] };
  const results = new Map([[m.id, { id: m.id, verdict: 'fix', comment: '直す', suggestion: '案', quote: '古い文' }]]);
  const edited = '足した行\n' + text;
  const [v, ...rest] = markViews(edited, 'a.re', data, results, cfg);
  assert.strictEqual(rest.length, 0);
  assert.deepStrictEqual([v.from, v.to], [
    { line: 2, col: 6 },
    { line: 2, col: 10 },
  ]);
  assert.strictEqual(v.kindLabel, 'AI チェック');
  assert.strictEqual(v.verdictLabel, '要修正');
  assert.strictEqual(v.hasSuggestion, true);
  assert.strictEqual(v.stale, true);
  // 見失ったものは出さない
  assert.deepStrictEqual(markViews('まったく別の文', 'a.re', data, results, cfg), []);
});

test('同期: webview の編集を文字列に当てる（複数の変更、CRLF、行末を越える桁）', () => {
  const text = 'abc\ndef\nghi';
  assert.strictEqual(
    applyTextChanges(text, [
      { from: { line: 0, col: 1 }, to: { line: 0, col: 2 }, insert: 'X' },
      { from: { line: 2, col: 0 }, to: { line: 2, col: 0 }, insert: 'Y\nZ' },
    ], '\n'),
    'aXc\ndef\nY\nZghi'
  );
  // 位置は当てる前の文字列のもの（前の変更でずれない）
  assert.strictEqual(applyTextChanges('ab', [{ from: { line: 0, col: 0 }, to: { line: 0, col: 0 }, insert: '12' }, { from: { line: 0, col: 1 }, to: { line: 0, col: 2 }, insert: '' }], '\n'), '12a');
  const crlf = 'abc\r\ndef';
  assert.strictEqual(applyTextChanges(crlf, [{ from: { line: 0, col: 3 }, to: { line: 1, col: 0 }, insert: '\n-\n' }], '\r\n'), 'abc\r\n-\r\ndef');
  // 行末を越える桁は行末に寄せる（\r の手前）
  assert.strictEqual(applyTextChanges(crlf, [{ from: { line: 0, col: 99 }, to: { line: 0, col: 99 }, insert: '!' }], '\r\n'), 'abc!\r\ndef');
});

test('設定 editor: 既定値と読み込み（型の違うものは既定のまま）', () => {
  assert.deepStrictEqual(defaultEditorConfig(), { hidx: 'hide', headingScale: [2, 1.5, 1.17, 1, 0.83], tableGap: 2 });
  assert.deepStrictEqual(readEditorConfig({ hidx: 'faint', headingScale: [1.5, 1.2], tableGap: 4 }), { hidx: 'faint', headingScale: [1.5, 1.2], tableGap: 4 });
  assert.deepStrictEqual(readEditorConfig({ hidx: 'x', headingScale: ['a'], tableGap: -1 }), defaultEditorConfig());
});
