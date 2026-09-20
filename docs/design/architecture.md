# 作り

## 層

```
src/core/        VS Code に依存しない層。判断はすべてここにある
  types.ts       索引と診断の型
  parser.ts      .re を 1 本読む（文字列 → 見出し・ブロック・インライン命令・行の種別）
  catalog.ts     catalog.yml
  config.ts      .review-assist.json
  glob.ts        設定で使う程度の glob（* ** ?）
  index.ts       ワークスペースの索引（章 → 元ファイル → 解析結果）。差分更新
  resolve.ts     @<...>{...} → 索引の中の場所
  tablewidth.ts  表の幅の見積もり
  width.ts       半角換算の文字幅
  outline.ts     アウトラインの木（既定は見出しだけ。設定 outline.blocks で足す）
  pdfpages.ts    索引 JSON → カーソル位置のページ番号
  diagnostics.ts 診断
  all.ts         テストが読む口（dist/core.js になる）
src/extension.ts VS Code の型に写すだけの層
src/cli.ts       VS Code 無しで全体を診断する CLI

syntaxes/review.tmLanguage.json  構文の色付け（TextMate 文法、scopeName source.review）
language-configuration.json      行コメントと括弧の対
```

文法は TypeScript の層とは独立していて、VS Code が直接読む（`contributes.grammars`）。
`src/core/parser.ts` とは**別の実装**である。片方を直したらもう片方も見ること。
分けてあるのは、パーサは索引と診断のために「行の種別とブロックの構造」を知りたいのに対し、
文法は「画面に出ている 1 行を色に分ける」のが仕事で、要るものが違うため。
選んだ scope 名と、色を付ける対象は [syntax-highlight.md](syntax-highlight.md)。

VS Code の Extension Development Host が使えない環境で作ったので、**確かめられるのは
`src/core/` と文法だけ**である（文法は VS Code 本体と同じ `vscode-textmate` で回せる。
0.1.2 から）。だから境界をはっきり分けてある。`src/extension.ts` には
「`core` の結果を `vscode.Diagnostic` や `vscode.DocumentSymbol` に写す」以上のことを書かない。
新しい判断を足すときは `core` に足し、`node:test` で確かめる。

## 実行時依存を持たない

`vscode` の API と Node の標準ライブラリだけで書く。YAML のパーサも glob も持ち込まず、
`catalog.yml` は行ベースで読み、glob は `src/core/glob.ts` に 30 行で書いた。
理由は、原稿を書く人の環境に `npm install` を強いないため（`.vsix` に入るのは
`dist/*.js` だけで 42 KB）。

devDependencies の `vscode-textmate` と `vscode-oniguruma`（0.1.2 で追加、文法のテスト用）は
`.vscodeignore` が `test/**` と `node_modules/**` を外しているので `.vsix` には入らない。

ビルドは esbuild で 3 つの束にする。`dist/extension.js`（`vscode` は external）、
`dist/cli.js`、`dist/core.js`（テスト用）。

## アウトライン

`buildOutline(parsed, { blocks })` が `OutlineNode` の木を返し、`src/extension.ts` が
`vscode.DocumentSymbol` に写す。見出しを `=` の数で入れ子にし、`options.blocks` に入れた種類の
ブロックだけを直前の見出しの子に置く。

**既定は見出しだけ**（`outline.blocks` が `[]`）。0.1.0 は id を持つブロックを全部出していたが、
原稿では見出しよりブロックの方が多く（`book_mruby3` の `contents/vm.re` は見出し 66 に対して
id 付きのブロック 52、あわせて 118 項目）、木というより一覧に見えるという指摘があった（2026-09-20、著者）。
表や図を追いたい人は `.review-assist.json` に `{"outline": {"blocks": ["table", "image"]}}` と書く。

見出しの `detail` にはラベル（`{chap_SEND}`）を出す。ブロックの `name` は `table tbl_mrb_gc` の
ように種類を頭に付けた形で、これは `@<table>{tbl_mrb_gc}` と見比べるためにそのまま id を出している。

### range の入れ子

VS Code の `DocumentSymbol` は

* `selectionRange ⊆ range`
* 子の `range ⊆ 親の range`

を前提にしていて、破れると木を作らずに平らに並べることがある。見出しの `range` の終わりは
「次の同位以上の見出しの直前の行」だが、0.1.0 はその行の**列 0** で閉じていた。ブロックの
`range` は最後の行（`//}`）の**末尾**まであるので、

```
=== 節
//table[t1][…]{
…
//}
== 次の章  ← 空行を挟まずに来ると
```

この形で子が親から 1 行分はみ出す。0.1.1 で見出しの終わりを「その行の末尾」に変えた。
`book_mruby3` の原稿は `//}` の後に必ず空行があるので実害は出ていなかったが、
不変条件として `test/helper.js` の `checkContainment` で押さえ、`contents/vm.re`・`contents/gc.re`・
`contents/codegen.re`・`sub-article/chap3-037-SEND.re`・`opcodes_template.re` の 5 本について
`blocks` が空のときと全部のときの両方で確かめている（`test/book_mruby3.test.js`）。

## 索引

1. ワークスペースの根（`catalog.yml` のあるディレクトリ）を決める
2. `catalog.yml` の PREDEF / CHAPS / APPENDIX / POSTDEF から章 ID（拡張子を除いたファイル名）を
   作る。項目はファイル名でも `contents/vm.re` のようなパスでもよい（実在する方を採る）
3. 設定 `chapters` にある章は、書かれた glob を**元ファイル**として使い、`catalog.yml` が
   指している生成物（`contents/opcodes.re`）は索引から外す。外さないと id とラベルが二重になる
4. 章に属さない `.re` も読む（`catalog.yml` に入れ忘れたファイルでもアウトラインは出したい）。
   その章 ID は空文字で、参照の解決だけは全章を順に探す
5. 各ファイルを `parseReview` に掛ける

`updateFile(rel, text)` で 1 本だけ読み直せる。エディタでの編集（`onDidChangeTextDocument`）は
そのファイルだけ、保存（`onDidSaveTextDocument`）は索引全体の診断を出し直す。
「参照されていない表」と「id の二重」は他のファイルを見ないと決まらないので、後者でしか動かない。

`catalog.yml` と `.review-assist.json` は `FileSystemWatcher` で見ていて、変われば索引を作り直す。

## 行の種別

規則（`rules`）を地の文だけに当てるために、パーサが 1 行ごとに種別を付ける。

| 種別 | 何 |
|---|---|
| `prose` | 地の文と見出し |
| `comment` | `#@#` で始まる行 |
| `directive` | `//list[...]{` `//}` `//tsize[...]` などの行そのもの |
| `code` | `//list` `//emlist` `//cmd` `//source` の本文 |
| `blockBody` | それ以外のブロックの本文（`//table` `//quote` など） |

`scope: "prose"` のときは `prose` の行の全部と、`directive` の行のうち**キャプションの引数だけ**を
見る（id の引数と `scale=` は外す）。こうすると `//table[gem_list][全角数字が１つ]` の
キャプションは拾い、`//tsize[|latex||P{0.3\textwidth}|]` は拾わない。
