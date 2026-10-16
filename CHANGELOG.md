# 変更の記録

## Unreleased（0.3.0 に入る予定）

**記法を畳む編集画面**（計画書 `docs/plans/marks-and-editor-plan.md` の段階 2）。

- `.re` を、記法の印を隠して見た目で表す編集画面（CustomTextEditor、中身は CodeMirror 6）で開ける。既定のエディタは変えない。
  エディタの右上のボタン・コマンド「記法を畳む編集画面 ⇔ 普通のエディタ」で行き来する
- 原稿は `.re` の文字列のまま。保存されるものは普通のエディタで書いたのと 1 文字も違わない。保存・取り消し・未保存の印は VS Code のもの
- カーソルを入れた記法だけ元の書き方に戻る。`@<code>` は等幅、`@<b>` は太字、`@<hidx>` は隠す（設定 `editor.hidx`）、
  `@<chap>`／`@<hd>`／`@<table>`／`@<list>`／`@<img>`／`@<fn>` は参照先の題の札（先が無ければ赤）、`@<embed>`・`@<br>` は札、
  `@<href>` はリンクの色。見出しは大きさを変え（設定 `editor.headingScale`）、`#@` は薄く、箇条は「•」。
  `//list`・`//emlist`・`//cmd` は枠と見出し、`//table` は列をそろえた表（セルはそのまま打てる）、`//image` は PNG、
  `//footnote`・`//quote`・`//pagebreak`・`//tsize` も。`book_mruby3` の原稿にある記法で記法のまま残るものは 0
- 入力の助け: 選んだ所を `@<code>{}`・`@<b>{}` などで囲む（`}` と `\` は逃がす）、`@<chap>{` などで参照の候補、ブロックの雛形
- マーカー（0.2.0）と AI の結果、この拡張と textlint の診断を同じ画面に。右クリックでマーカーを付けられる
- `book_mruby3` の全章（57 本）を Chromium で開いて、pageerror 0、文字列が変わらないこと、カーソルを入れると記法が出ること
  （17,307 か所）を確かめた（`docs/verification/editor.md`、`tools/check-editor.mjs`）。`contents/vm.re` で 1 文字打つごとの処理は
  中央値 4.4 ms
- 実機の VS Code ではまだ見ていない（特に日本語 IME）。確かめてほしい操作は README の「確かめ方（0.3.0）」
- 実行時依存を持たない方針の例外として、CodeMirror 6 を webview の束（`dist/webview.js`）にだけ入れた。`.vsix` は 82 KB → 208 KB

## 0.2.0

**マーカー**と、**まとめて AI に確かめてもらう仕組み**（計画書 `docs/plans/marks-and-editor-plan.md` の段階 1）。

- 範囲を選んで「マーカーを付ける: AI チェック」「…: 後で読む」。メモを 1 行付けられる。種類と色は設定 `marks.kinds`
- 原稿には書かない。`.review-assist/marks.json` に選んだ文字列と前後 32 文字を保存し、原稿が直されたら文字列で
  位置を探し直す（W3C Web Annotation の TextQuoteSelector と同じ考え方）。見つからないものは「位置を見失った」として残す
- 範囲に背景色、行の横に印、スクロールバーに印。ホバーにメモと AI の結果と操作のリンク
- エクスプローラーに「マーカー」ビュー（種類 → 章 → 項目、未済／済み／全部で絞る）
- 「AI チェックの依頼を書き出す」: 未済の AI チェックを `.review-assist/ai-check.md` に（id、章、ファイルと行、見出しの道筋、
  メモ、選んだ文、前後の段落、結果の JSON の雛形）。先頭から本の側の手順の文書（設定 `marks.aiProcedure`）を指す
- AI が書いた `.review-assist/ai-results.json`（`ok`／`fix`／`question`、理由、置き換え案）を見張って表示する。
  「案を当てる」で置き換え案を原稿に入れる（自動で済みにはしない）
- CLI に `node dist/cli.js marks <本> [--request]`（一覧と依頼の書き出し）
- 前後の文脈の長さ 32 は、`book_mruby3` の過去の修正 93 コミット・文 75,499 個に当てて、取り違えが下げ止まる所で決めた
  （`docs/verification/marks.md`）
- 実機の VS Code ではまだ見ていない。確かめてほしい操作は README の「確かめ方」

## 0.1.2

**構文の色付け**を自前で持つようにした。これまでは
[`atsushieno.language-review`](https://marketplace.visualstudio.com/items?itemName=atsushieno.language-review)
に任せていたが、そちらは `.re` と同じディレクトリの `catalog.yml` しか見ないため、原稿を
`contents/` に置く構成だと他章への参照すべてに「参照先 chapter の overview が見つかりません。」
と出て、止める設定が無い。色付けのためだけに残しておけなくなったので、こちらで持つ。

- `syntaxes/review.tmLanguage.json`（scopeName `source.review`）と
  `language-configuration.json`（`#@#` の行コメント、`{}` `[]` の対）を追加。文法は自前で書いた
  （language-review の文法は Apache-2.0 なので読んでも写していない）
- 色を付けるのは、見出し（深さごと）・`#@` の行・ブロック命令とその引数（id とキャプションを
  分ける）・単行の命令・インライン命令・箇条書き・定義リスト・`//table` の区切り行・逃がし文字。
  インライン命令は**参照・太字・斜体・コード・索引・その他**の 6 種で scope を分ける
- コード系ブロック（`//list` `//listnum` `//emlist` `//emlistnum` `//cmd` `//source` `//terminal`）の
  中身ではインライン命令を色付けしない。`//note` `//quote` `//table` `//footnote` の中身は地の文と同じ
- インライン命令の 3 種の括り（`@<op>{...}` `@<op>$...$` `@<op>|...|`）と `\}` の逃がしに対応
- 文法のテストを追加（`test/grammar.test.js`、18 件）。VS Code 本体と同じ
  `vscode-textmate` + `vscode-oniguruma` でトークン化して scope を確かめる。
  `book_mruby3` の `contents/vm.re` 全体について、scope の付かない `@<` と `//` が 0 件であることも見る
- **`atsushieno.language-review` は無効にすること。** 同じ言語 ID に 2 つの文法があると
  どちらが使われるか決まらない。手順は README

選んだ scope 名とその理由は `docs/design/syntax-highlight.md`。

## 0.1.1

アウトラインの見直し（著者の指摘「アウトラインの表示がフラットで項目が多すぎてよく分からない」）。

- **アウトラインは既定で見出しだけにした。** 表・リスト・図・脚注は設定 `outline.blocks` に
  入れた種類だけ見出しの下に出す（既定 `[]`）。`book_mruby3` の `contents/vm.re` は
  118 項目から 66 項目（見出しだけ）になる
- 見出しの range の終わりを、閉じる行の列 0 から**その行の末尾**に変えた。`//}` の直後に
  空行を挟まずに見出しが来ると、子（ブロック）の range が親からはみ出して
  VS Code が木を平らにすることがある。`test/helper.js` の `checkContainment` で
  「selectionRange ⊆ range」「子の range ⊆ 親の range」を不変条件として押さえた

## 0.1.0

最初の版（計画書 `docs/plans/v0-plan.md` の段階 1〜4）。Marketplace には出していない。
[Releases](https://github.com/kishima/review-assist/releases) の `.vsix` を
`code --install-extension` で入れる。

### 索引と参照

- `catalog.yml` と `.review-assist.json` を読んでワークスペースを索引する。設定 `chapters` で、
  生成物の章を元ファイル（`opcodes_template.re` と `sub-article/*.re` など）に読み替える
- 定義へ移動（F12）とホバー: `@<chap>` `@<hd>` `@<list>` `@<table>` `@<img>` `@<fn>`。
  解決の規則は Re:VIEW 2.5.0 の `inline_hd` / `Index#[]` / `HeadlineIndex.parse` に合わせてある
- アウトライン（見出しの階層と、その下の表・リスト・図・脚注）
- `@<img>` のホバーに、設定 `imagePreview` の PNG を出す

### 診断

- 参照切れ（error）、曖昧な参照（error）、参照されていない表（warning）、
  id とラベルの二重（warning）、設定 `rules` の正規表現、コードブロックの行長、表の幅の見積もり、
  `#@#` の中の TODO
- `node dist/cli.js <ワークスペース>` で VS Code 無しに同じ診断を一覧できる

### PDF との往復

- コマンド「Review Assist: この節を PDF で開く」。カーソルの直近の見出し（無ければ章の先頭）の
  ページを設定 `pageIndex` の索引 JSON から引き、設定 `pdf` の PDF を `#page=N` 付きで開く。
  鍵が索引に無ければ見出しの上の段、最後は章の先頭へ落とす
- 設定 `pdf` と `pageIndex` を追加。索引 JSON を作るのは本の側（実例は `book_mruby3` の
  `tools/pdf_pages.py`）。この拡張は PDF を解析しない

### 配布

- GitHub Actions で push と PR のたびにテストと `.vsix` の作成。タグ `v*` で Release に `.vsix`
