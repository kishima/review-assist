// 構文色付け（syntaxes/review.tmLanguage.json）の確認。
// 材料は原則として book_mruby3 に実在する行で、出典を行ごとにコメントで書いてある
// （原稿が隣に無い CI でも回るように、文字列としてここに写してある）。
// 最後の 1 件だけは原稿そのものを読むので、無ければ飛ばす。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { tokenizeReview, textsWithScope, unscopedOccurrences } = require('./grammar-helper.js');

/** 1 行だけ流して、その行のトークンと本文を返す。 */
async function one(line) {
  const { lines, tokens } = await tokenizeReview(line);
  return { text: lines[0], tok: tokens[0] };
}

test('文法: 見出し 3 種（深さが scope に出る、ラベルと題が分かれる）', async () => {
  // contents/vm.re:1, :16, :18
  const src = ['= VMの仕組み', '== VMの起動とデータ構造', '=== 実行までの流れ'].join('\n');
  const { lines, tokens } = await tokenizeReview(src);

  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'markup.heading.1.review'), ['= VMの仕組み']);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'punctuation.definition.heading.review'), ['=']);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'entity.name.section.review'), ['VMの仕組み']);

  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'markup.heading.2.review'), ['== VMの起動とデータ構造']);
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'entity.name.section.review'), ['VMの起動とデータ構造']);

  assert.deepStrictEqual(textsWithScope(tokens[2], lines[2], 'markup.heading.3.review'), ['=== 実行までの流れ']);
  // 深さは取り違えない
  assert.deepStrictEqual(textsWithScope(tokens[2], lines[2], 'markup.heading.2.review'), []);
});

test('文法: 見出しのラベルと修飾子', async () => {
  // sub-article/chap3-037-SEND.re:1
  const a = await one('=={chap_SEND} SEND、SEND0、SENDB、SSEND、SSEND0、SSENDB');
  assert.deepStrictEqual(textsWithScope(a.tok, a.text, 'entity.name.label.review'), ['{chap_SEND}']);
  assert.deepStrictEqual(textsWithScope(a.tok, a.text, 'entity.name.section.review'), [
    'SEND、SEND0、SENDB、SSEND、SSEND0、SSENDB',
  ]);

  // book_mruby3 には無いが Re:VIEW にはある形（[column] [nonum]）。
  const b = await one('==[column] コラムの題');
  assert.deepStrictEqual(textsWithScope(b.tok, b.text, 'keyword.other.heading-option.review'), ['[column]']);
  assert.deepStrictEqual(textsWithScope(b.tok, b.text, 'entity.name.section.review'), ['コラムの題']);

  const c = await one('==[/column]');
  assert.deepStrictEqual(textsWithScope(c.tok, c.text, 'keyword.other.heading-option.review'), ['[/column]']);
});

test('文法: 見出しの題の中のインライン命令も色が付く', async () => {
  // contents/references.re 系の「=== 「…」@<br>{}　　…（著）」と同じ形
  const { text, tok } = await one('=== 「Rubyのしくみ」@<br>{}　　Pat Shaughnessy（著）');
  assert.deepStrictEqual(textsWithScope(tok, text, 'entity.name.tag.inline.other.review'), ['@<br>']);
  assert.deepStrictEqual(textsWithScope(tok, text, 'markup.heading.3.review').length, 1);
});

test('文法: #@# の行はコメント', async () => {
  // contents/afterword.re:3
  const { text, tok } = await one('#@# TODO(著者): 初版のあとがきのまま。改訂版の言葉に書き換える');
  assert.deepStrictEqual(textsWithScope(tok, text, 'comment.line.number-sign.review'), [text]);

  // #@# で隠した見出しが、見出しとして色付けされない（afterword.re:11 の形）
  const h = await one('#@# == おまけ：今後のこと');
  assert.deepStrictEqual(textsWithScope(h.tok, h.text, 'markup.heading.2.review'), []);
  assert.deepStrictEqual(textsWithScope(h.tok, h.text, 'comment.line.number-sign.review'), [h.text]);

  // #@warn などの preprocessor 行も出力に出ないので comment 扱い
  const w = await one('#@warn(この節は書きかけ)');
  assert.deepStrictEqual(textsWithScope(w.tok, w.text, 'comment.line.preprocessor.review'), [w.text]);
  assert.deepStrictEqual(textsWithScope(w.tok, w.text, 'keyword.other.preprocessor.review'), ['warn']);
});

test('文法: //list[id][caption]{ 〜 //}', async () => {
  // contents/vm.re:184 以降
  const src = [
    '//list[def_mrb_value][mrb_valueの定義(boxing_no.h)]{',
    'typedef struct mrb_value {',
    '  union { ... } value;',
    '} mrb_value;',
    '//}',
  ].join('\n');
  const { lines, tokens } = await tokenizeReview(src);

  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'keyword.control.block.review'), ['//list']);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'entity.name.label.review'), ['def_mrb_value']);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'string.unquoted.argument.review'), [
    'mrb_valueの定義(boxing_no.h)',
  ]);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'punctuation.section.block.begin.review'), ['{']);

  for (const i of [1, 2, 3]) {
    assert.deepStrictEqual(textsWithScope(tokens[i], lines[i], 'markup.raw.block.review'), [lines[i]], `${i} 行目`);
  }
  assert.deepStrictEqual(textsWithScope(tokens[4], lines[4], 'keyword.control.block.end.review'), ['//}']);
  // //} はコードの中身に含めない
  assert.deepStrictEqual(textsWithScope(tokens[4], lines[4], 'markup.raw.block.review'), []);
});

test('文法: コード系ブロックの中ではインライン命令を色付けしない（キャプションでは付ける）', async () => {
  // 判断の根拠は docs/design/syntax-highlight.md。book_mruby3 のコードブロックには
  // @< が 1 つも無い（数えた）ので、原稿に実害は無い。
  const src = ['//emlist[@<code>{mrb_value} の話]{', '@<code>{これはコードの中の文字列}', '//}'].join('\n');
  const { lines, tokens } = await tokenizeReview(src);

  // キャプションの中では付く
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'entity.name.tag.inline.code.review'), ['@<code>']);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'markup.raw.inline.review'), ['mrb_value']);
  // 中身では付かない
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'entity.name.tag.inline.code.review'), []);
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'markup.raw.inline.review'), []);
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'markup.raw.block.review'), [lines[1]]);
});

test('文法: //note のような本文のブロックの中ではインライン命令を色付けする', async () => {
  // book_mruby3 は //note を使っていないので、これは Re:VIEW の書式に対する確認。
  const src = ['//note[覚え書き]{', 'ここは@<code>{mrb_state}の話で、@<b>{強調}もある。', '//}'].join('\n');
  const { lines, tokens } = await tokenizeReview(src);

  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'keyword.control.block.review'), ['//note']);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'string.unquoted.argument.review'), ['覚え書き']);
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'markup.raw.inline.review'), ['mrb_state']);
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'markup.bold.review'), ['強調']);
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'markup.raw.block.review'), []);
});

test('文法: 参照系のインライン命令', async () => {
  // contents/vm.re:160
  const { text, tok } = await one(
    'つまり呼び出し元のR[a]が呼び出し先のR0であり、引数はそのままR1以降として見えます（@<hd>{opcodes|chap_SEND}）。'
  );
  assert.deepStrictEqual(textsWithScope(tok, text, 'entity.name.tag.inline.reference.review'), ['@<hd>']);
  assert.deepStrictEqual(textsWithScope(tok, text, 'string.other.link.review'), ['opcodes|chap_SEND']);

  // contents/vm.re:1140
  const t = await one(
    'このときティックの作り方は3通りあり（@<table>{tick_supply}）、@<b>{どれを選ぶかで sleep の意味が変わります}。'
  );
  assert.deepStrictEqual(textsWithScope(t.tok, t.text, 'entity.name.tag.inline.reference.review'), ['@<table>']);
  assert.deepStrictEqual(textsWithScope(t.tok, t.text, 'string.other.link.review'), ['tick_supply']);
  assert.deepStrictEqual(textsWithScope(t.tok, t.text, 'entity.name.tag.inline.bold.review'), ['@<b>']);
  assert.deepStrictEqual(textsWithScope(t.tok, t.text, 'markup.bold.review'), [
    'どれを選ぶかで sleep の意味が変わります',
  ]);
});

test('文法: @<code>{R[a] = R[b]}（] や = を含む中身）', async () => {
  // contents/opcode-table.re:11
  const { text, tok } = await one('@<code>{R[a] = R[b]}');
  assert.deepStrictEqual(textsWithScope(tok, text, 'entity.name.tag.inline.code.review'), ['@<code>']);
  assert.deepStrictEqual(textsWithScope(tok, text, 'markup.raw.inline.review'), ['R[a] = R[b]']);
});

test('文法: @<op>$...$ と @<op>|...|（Re:VIEW 2.5 の残り 2 種の括り）', async () => {
  // book_mruby3 では使われていない（grep して 0 件）。Re:VIEW の書式に対する確認。
  const d = await one('式は@<code>$a = b[c]$のようになる。');
  assert.deepStrictEqual(textsWithScope(d.tok, d.text, 'entity.name.tag.inline.code.review'), ['@<code>']);
  assert.deepStrictEqual(textsWithScope(d.tok, d.text, 'markup.raw.inline.review'), ['a = b[c]']);

  const p = await one('式は@<code>|a = b{c}|のようになる。');
  assert.deepStrictEqual(textsWithScope(p.tok, p.text, 'entity.name.tag.inline.code.review'), ['@<code>']);
  assert.deepStrictEqual(textsWithScope(p.tok, p.text, 'markup.raw.inline.review'), ['a = b{c}']);
});

test('文法: \\} の逃がしを含むインライン命令', async () => {
  // contents/codegen.re:1175
  const { text, tok } = await one(
    'ハッシュパターンの値にクラスや定数を書いた場合（@<code>{in {name: String\\}}）、'
  );
  assert.deepStrictEqual(textsWithScope(tok, text, 'markup.raw.inline.review'), ['in {name: String\\}']);
  assert.deepStrictEqual(textsWithScope(tok, text, 'constant.character.escape.review'), ['\\}']);
  // 逃がした } で命令が切れていないこと（その後ろに本文が残る）
  assert.deepStrictEqual(textsWithScope(tok, text, 'entity.name.tag.inline.code.review'), ['@<code>']);

  // contents/vm.re の @<embed>{|latex|\vspace*{-1.2cm\}}（中に { と \} の両方がある）
  const e = await one('@<embed>{|latex|\\vspace*{-1.2cm\\}}');
  assert.deepStrictEqual(textsWithScope(e.tok, e.text, 'entity.name.tag.inline.other.review'), ['@<embed>']);
  assert.deepStrictEqual(textsWithScope(e.tok, e.text, 'markup.other.inline.review'), ['|latex|\\vspace*{-1.2cm\\}']);
});

test('文法: 索引のインライン命令は本文と別の scope', async () => {
  // contents/vm.re:5 の形（@<hidx> が並ぶ）
  const { text, tok } = await one('Fiberはどうやって処理を切り替えるか、を追います。@<hidx>{Fiber}');
  assert.deepStrictEqual(textsWithScope(tok, text, 'entity.name.tag.inline.index.review'), ['@<hidx>']);
  assert.deepStrictEqual(textsWithScope(tok, text, 'markup.other.index.review'), ['Fiber']);
  // 装飾やコードと混ざらない
  assert.deepStrictEqual(textsWithScope(tok, text, 'markup.raw.inline.review'), []);
});

test('文法: 箇条書き・番号付き・定義リストの印', async () => {
  // contents/vm.re:173
  const b = await one(' * @<b>{Word Boxing}（@<code>{MRB_WORD_BOXING}）: ワード長1つに収める。');
  assert.deepStrictEqual(textsWithScope(b.tok, b.text, 'markup.list.unnumbered.review'), [' * ']);
  assert.deepStrictEqual(textsWithScope(b.tok, b.text, 'markup.bold.review'), ['Word Boxing']);
  assert.deepStrictEqual(textsWithScope(b.tok, b.text, 'markup.raw.inline.review'), ['MRB_WORD_BOXING']);

  const b2 = await one('  ** 入れ子の箇条書き');
  assert.deepStrictEqual(textsWithScope(b2.tok, b2.text, 'markup.list.unnumbered.review'), ['  ** ']);

  // contents/vm.re:529
  const n = await one(' 1. 引数の並びを整える。引数が15個以上なら配列に、');
  assert.deepStrictEqual(textsWithScope(n.tok, n.text, 'markup.list.numbered.review'), [' 1. ']);

  // contents/corelib.re:109
  const d = await one(' : @<code>{src/kernel.c}（C、42エントリ）');
  assert.deepStrictEqual(textsWithScope(d.tok, d.text, 'markup.list.definition.review'), [' : ']);
  assert.deepStrictEqual(textsWithScope(d.tok, d.text, 'markup.raw.inline.review'), ['src/kernel.c']);
});

test('文法: //table の区切り行と中身', async () => {
  // contents/vm.re:1141 以降
  const src = [
    '//table[tick_supply][タイマー割り込みが無いときのティックの作り方]{',
    '方法\t成り立つ条件\t得られるもの',
    '-----------------------------------------------------------',
    '命令数で数える\t特になし\t決定的。@<code>{mrb_state}を見る',
    '//}',
  ].join('\n');
  const { lines, tokens } = await tokenizeReview(src);

  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'keyword.control.block.review'), ['//table']);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'entity.name.label.review'), ['tick_supply']);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'string.unquoted.argument.review'), [
    'タイマー割り込みが無いときのティックの作り方',
  ]);
  assert.deepStrictEqual(textsWithScope(tokens[2], lines[2], 'meta.separator.table.review'), [lines[2]]);
  // 表の中身は本文と同じ規則
  assert.deepStrictEqual(textsWithScope(tokens[3], lines[3], 'markup.raw.inline.review'), ['mrb_state']);
  assert.deepStrictEqual(textsWithScope(tokens[4], lines[4], 'keyword.control.block.end.review'), ['//}']);
});

test('文法: 単行の命令（//footnote、//image、//tsize、//pagebreak）', async () => {
  // contents/vm.re:19
  const f = await one('//footnote[ritevm][mrubyのVMは、RiteVMとも呼ばれています]');
  assert.deepStrictEqual(textsWithScope(f.tok, f.text, 'keyword.control.directive.review'), ['//footnote']);
  assert.deepStrictEqual(textsWithScope(f.tok, f.text, 'entity.name.label.review'), ['ritevm']);
  assert.deepStrictEqual(textsWithScope(f.tok, f.text, 'string.unquoted.argument.review'), [
    'mrubyのVMは、RiteVMとも呼ばれています',
  ]);

  // contents/vm.re の //image 行
  const i = await one('//image[vm_flow][バイトコードが実行されるまでの流れ][scale=1.0]');
  assert.deepStrictEqual(textsWithScope(i.tok, i.text, 'keyword.control.directive.review'), ['//image']);
  assert.deepStrictEqual(textsWithScope(i.tok, i.text, 'entity.name.label.review'), ['vm_flow']);
  assert.deepStrictEqual(textsWithScope(i.tok, i.text, 'string.unquoted.argument.review'), [
    'バイトコードが実行されるまでの流れ',
    'scale=1.0',
  ]);

  // contents/vm.re:51。\t を逃がしとして潰してはいけない（P{0.29\textwidth}）
  const t = await one('//tsize[|latex||P{0.29\\textwidth}|l|P{0.42\\textwidth}|]');
  assert.deepStrictEqual(textsWithScope(t.tok, t.text, 'keyword.control.directive.review'), ['//tsize']);
  assert.deepStrictEqual(textsWithScope(t.tok, t.text, 'string.unquoted.argument.review'), [
    '|latex||P{0.29\\textwidth}|l|P{0.42\\textwidth}|',
  ]);
  assert.deepStrictEqual(textsWithScope(t.tok, t.text, 'constant.character.escape.review'), []);

  const p = await one('//pagebreak');
  assert.deepStrictEqual(textsWithScope(p.tok, p.text, 'keyword.control.directive.review'), ['//pagebreak']);

  const bl = await one('//blankline');
  assert.deepStrictEqual(textsWithScope(bl.tok, bl.text, 'keyword.control.directive.review'), ['//blankline']);
  const ni = await one('//noindent');
  assert.deepStrictEqual(textsWithScope(ni.tok, ni.text, 'keyword.control.directive.review'), ['//noindent']);
});

test('文法: ブロックの中では見出しを見ない', async () => {
  const src = ['//emlist{', '= これは見出しではない', '//}'].join('\n');
  const { lines, tokens } = await tokenizeReview(src);
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'markup.heading.1.review'), []);
  assert.deepStrictEqual(textsWithScope(tokens[1], lines[1], 'markup.raw.block.review'), [lines[1]]);
});

test('文法: 知らないインライン命令・知らないブロックも scope が付く', async () => {
  const u = await one('これは@<kw>{知らない命令}です。');
  assert.deepStrictEqual(textsWithScope(u.tok, u.text, 'entity.name.tag.inline.other.review'), ['@<kw>']);
  assert.deepStrictEqual(textsWithScope(u.tok, u.text, 'markup.other.inline.review'), ['知らない命令']);

  const src = ['//sideimage[x][2cm]{', '本文', '//}'].join('\n');
  const { lines, tokens } = await tokenizeReview(src);
  assert.deepStrictEqual(textsWithScope(tokens[0], lines[0], 'keyword.control.block.review'), ['//sideimage']);
  assert.deepStrictEqual(textsWithScope(tokens[2], lines[2], 'keyword.control.block.end.review'), ['//}']);
});

// 取りこぼしの機械確認。原稿そのものが無ければ飛ばす（CI では飛ぶ）。
const BOOK = process.env.REVIEW_ASSIST_BOOK || path.join(__dirname, '..', '..', '..', 'book_mruby3');
const VM_RE = path.join(BOOK, 'contents', 'vm.re');
const bookAvailable = fs.existsSync(VM_RE);

test('文法: contents/vm.re 全体で、scope の付かない @< と // が無い', { skip: bookAvailable ? false : `${VM_RE} が無い` }, async () => {
  const { lines, tokens } = await tokenizeReview(fs.readFileSync(VM_RE, 'utf8'));
  const bad = unscopedOccurrences(lines, tokens);
  assert.deepStrictEqual(
    bad.map((b) => `${b.line}:${b.column} ${b.needle} ${b.text}`),
    []
  );
});
