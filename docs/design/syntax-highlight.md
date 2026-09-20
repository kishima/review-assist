# 構文の色付け（TextMate 文法）

0.1.2 で足した。`syntaxes/review.tmLanguage.json`（scopeName `source.review`）と
`language-configuration.json` を `package.json` の `contributes.grammars` /
`contributes.languages[0].configuration` で登録している。

## なぜ自前で持つか

0.1.1 までは「色付けは [`atsushieno.language-review`](https://marketplace.visualstudio.com/items?itemName=atsushieno.language-review)
に任せる」としていた。そちらは `.re` と同じディレクトリの `catalog.yml` しか見ない

```js
// ~/.vscode-server/extensions/atsushieno.language-review-0.7.5/out/src/preview.js:143
const catalogYamlFileName = path.resolve(docDirName, "catalog.yml");
```

ので、`book_mruby3` が `.re` を `contents/` に移してから（`catalog.yml` は根のまま）、
他章への参照すべてに「参照先 chapter の overview が見つかりません。」という診断を出すようになった。
止める設定は無い。診断だけを切ることもできないので、**拡張ごと無効にするしかない**。
無効にすると色が消えるので、こちらで持つことにした。

文法は**自前で書いた**。language-review の文法は Apache-2.0 で、この拡張は MIT なので、
読んでも写していない。書式の根拠は Re:VIEW 2.5.0 の書式（`docs/design/review-syntax.md`）と、
`book_mruby3` の原稿を grep して数えた実際の使われ方（`docs/worklog/2026-09-20-v0.1.2-grammar.md`）。

なお、language-review も同じ言語 ID `review` に文法を寄付している（scopeName は `text.review`）。
同じ言語に 2 つの文法があるとき、VS Code はどちらか一方しか使わない。どちらが勝つかは決まって
いないので、**両方を入れたままにはしない**。README に無効化の手順を書いた。

## 色を付ける対象

原稿で実際に使われている書式に限った。使われていない書式のうち、Re:VIEW の書式として
自然に同じ規則で書けるもの（`[column]`、`//note`、`@<op>$...$`、`@<op>|...|` など）は
足してあるが、**推測で足した分にはテストで印を付けてある**（「book_mruby3 では使われていない」）。

## 選んだ scope 名

TextMate の慣例（[TextMate Manual の Naming Conventions](https://macromates.com/manual/en/language_grammars#naming_conventions)、
および VS Code 同梱の Markdown 文法）から選んだ。テーマは scope 名の**前方一致**で色を決めるので、
`markup.heading` や `keyword.control` のように広く使われている前置きを持たせ、末尾に `.review`
を付けて他言語と区別している。

| 対象 | scope | なぜ |
|---|---|---|
| 見出しの行全体 | `markup.heading.1.review` 〜 `markup.heading.6.review` | Markdown 文法が `markup.heading.N.markdown` を使う。深さで色を変えるテーマがある |
| 見出しの `=` | `punctuation.definition.heading.review` | 印そのもの。Markdown の `#` と同じ扱い |
| 見出しの修飾子 `[column]` `[nonum]` | `keyword.other.heading-option.review` | 決まった語の集合で、文章ではない |
| 見出しのラベル `{chap_SEND}` | `entity.name.label.review` | 参照される名前の**定義**側。`entity.name` は「定義された名前」の枠 |
| 見出しの題 | `entity.name.section.review` | 節の名前。TextMate の慣例どおり |
| `#@#` の行 | `comment.line.number-sign.review` | `#` で始まる行コメント |
| `#@warn` などの行 | `comment.line.preprocessor.review`（語は `keyword.other.preprocessor.review`） | 下記 |
| ブロックの開始 `//list` | `keyword.control.block.review` | 構造を作る語 |
| 単行の命令 `//pagebreak` `//image` | `keyword.control.directive.review` | 同上。ブロックと区別できるよう別名 |
| `//}` | `keyword.control.block.end.review` | 開始と同じ色でよいが、閉じだけ変えたい人のために分けた |
| ブロック開始の `{` | `punctuation.section.block.begin.review` | 括りの印 |
| ブロック引数の id | `entity.name.label.review` | 見出しのラベルと同じ「参照される名前の定義側」 |
| ブロック引数のキャプション等 | `string.unquoted.argument.review` | 引数の文字列。テーマの文字列色が付く |
| コード系ブロックの中身 | `markup.raw.block.review` | Markdown のコードブロックと同じ |
| `//table` の区切り行 | `meta.separator.table.review` | `meta.separator` は区切り行の慣例（ini や shell の文法が使う） |
| 箇条書きの `*` | `markup.list.unnumbered.review` | Markdown と同じ |
| 番号付きの `1.` | `markup.list.numbered.review` | 同上 |
| 定義リストの `:` | `markup.list.definition.review` | `markup.list` の下に足した |
| `\}` `\]` | `constant.character.escape.review` | 逃がし文字の慣例 |

インライン命令は、命令の名前（`@<hd>` の部分）と中身を分け、**中身は命令の種類ごとに別の scope**
にした。テーマで区別できるようにするためで、種類の分け方は「読む人にとって何であるか」で決めた。

| 種類 | 命令 | 名前の scope | 中身の scope |
|---|---|---|---|
| 参照 | `chap` `chapref` `hd` `img` `list` `table` `fn` `column` `secref` `title` | `entity.name.tag.inline.reference.review` | `string.other.link.review` |
| 太字 | `b` `strong` | `entity.name.tag.inline.bold.review` | `markup.bold.review` |
| 斜体 | `i` `em` | `entity.name.tag.inline.italic.review` | `markup.italic.review` |
| コード | `code` `tt` `tti` `ttb` | `entity.name.tag.inline.code.review` | `markup.raw.inline.review` |
| 索引 | `idx` `hidx` | `entity.name.tag.inline.index.review` | `markup.other.index.review` |
| その他 | 上以外すべて（`br` `href` `embed` `kw` `ruby` `m` `raw` `uchar` …） | `entity.name.tag.inline.other.review` | `markup.other.inline.review` |

* 名前をぜんぶ `entity.name.tag.…` にしたのは、テーマの「タグ」の色が付いてほしいから。
  前方一致なので、種類ごとに細かく分けても既定では同じ色になり、分けたい人だけ
  `editor.tokenColorCustomizations` で分けられる。
* 参照の中身を `string.other.link.review` にしたのは、それが原稿の別の場所を指す**リンク**だから。
  この拡張の「定義へ移動」が効くのも同じ一群で、色と機能が一致する。
* 索引を分けたのは、`@<hidx>{...}` が**本文に何も出さない**ため。地の文と同じ色だと、
  読むときに本文と混ざる。`markup.other.index` は既定のテーマが色を持たないので、
  そのままだと地の文と同じに見えるが、`editor.tokenColorCustomizations` で薄くできる。
* 「その他」に落とすのを最後の規則にしてあるので、**知らない命令でも必ず何かの scope が付く**。
  取りこぼしを機械で数えられるのはこのおかげ（下記）。
* `@<bib>` `@<eq>` は参照に入れていない。この拡張が参照として解決していない（README「やらないこと」）
  ので、色だけ参照に見せると嘘になる。解決を足すときに一緒に動かす。

### `#@` 系をまとめてコメントにした根拠

Re:VIEW の `#@` で始まる行は、`#@#`（コメント）も `#@warn` `#@require` `#@mapfile`
`#@maprange` `#@end` も、preprocessor が処理する行で**本文には 1 文字も出ない**。
「出力に出ない行」という一点で同じなので、同じ `comment.line.*` の下に置いた。
`#@#` と他を別名にしてあるので、分けたい人は分けられる。
`book_mruby3` に実在するのは `#@#` だけ（416 行、他の `#@` 系は 0 行）。

## コード系ブロックの中ではインライン命令を色付けしない

`//list` `//listnum` `//emlist` `//emlistnum` `//cmd` `//source` `//terminal` の中身は
`markup.raw.block.review` 一色にして、`@<...>` を解釈しない。

Re:VIEW 自身はこれらの中でも `@<...>` を解釈する（`//emlist` に `@<b>` を書けば太字になる）ので、
**これは忠実ではない**。それでも色付けしない方を選んだのは、

* コードブロックの中身はコードとして読みたい。C のコードに現れる `<` `>` `{` `}` が
  インライン命令の切れ目に見えると、かえって読みにくい
* `book_mruby3` のコード系ブロック 487 個の中に `@<` は **1 つも無い**（数えた）。
  忠実さを取っても、この原稿では何も変わらない

から。キャプション（`//list[id][caption]`）の中では色付けする。キャプションは地の文だからで、
これは拡張の他の部分（`rules` の `scope: "prose"` がキャプションを地の文として見る、
`docs/design/architecture.md`）とも揃っている。

この判断が変わるとしたら、原稿がコードブロックの中で `@<b>` を使い始めたとき。
そのときは `//list` の中身にも `#inline` を入れる（1 行の変更）。

## 括りの 3 種と逃がし

インライン命令は `@<op>{...}` `@<op>$...$` `@<op>|...|` の 3 種を受ける（Re:VIEW 2.5）。
中身の正規表現はそれぞれ `(?:[^}\\]|\\.)*` `(?:[^$\\]|\\.)*` `(?:[^|\\]|\\.)*` で、
`\}` のような逃がしを 1 つの塊として食べるので、逃がした閉じ括弧で命令が切れない。

```
@<code>{in {name: String\}}           → 中身は  in {name: String\}
@<embed>{|latex|\vspace*{-1.2cm\}}    → 中身は  |latex|\vspace*{-1.2cm\}
```

ブロックの引数も同じ形（`\]` だけを逃がす）にしてある。`//tsize[|latex||P{0.29\textwidth}|…]`
の `\t` を逃がしとして潰さないことを、テストで押さえてある。

`@<...>` の入れ子（`@<b>{…@<code>{x}…}`）は扱わない。中身は最初の閉じ括弧で切れる。
`book_mruby3` に入れ子は 0 件（数えた）。

## 取りこぼしの機械確認

Extension Development Host が無い環境なので、**目で見た確認はしていない**。代わりに、
VS Code 本体と同じエンジン（`vscode-textmate` + `vscode-oniguruma`）で原稿をトークン化し、

* 「この行のこの範囲はこの scope」を 17 件（`test/grammar.test.js`）
* **原稿の中の `@<` と `//` の出現のうち、根の scope（`source.review`）しか付いていないものが 0 件**

を確かめている。後者が取りこぼしの網で、`contents/vm.re`（`@<` 1461 個、`//` 120 個）を
テストに入れてある。手で回した範囲では、原稿 57 ファイル・20680 行の `@<` 13132 個と
`//` 1371 個について 0 件だった（`docs/verification/` ではなく worklog に数値がある）。

この網が仕事をしていることは、`#inline-other`（最後の受け皿）を外すと 77 件に増えることで
確かめた。

## やっていないこと

* `//graph[id][gnuplot][caption]{…}` の中身は gnuplot などのソースだが、本文と同じ規則で
  色付けしてしまう。原稿に無いので直していない
* `//embed{` `//raw{` の中身（そのまま出力に流れる LaTeX / HTML）も本文扱い。同上
* 埋め込みの言語（`//list[…][…][ruby]{` の中を Ruby として色付けする）はやらない。
  Re:VIEW の `//list` は言語を引数に取らないので、取りようがない
* `= ` で始まらない飾りの行（`==========` のような区切り）には色を付けない
