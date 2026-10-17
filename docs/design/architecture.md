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
  marks.ts       マーカー（0.2.0）。保存形式、位置の探し直し、AI への依頼の組み立て、結果の読み込み、ビューの並び
  fold.ts        編集画面（0.3.0）で畳む範囲の一覧（parser.ts を使う）。webview の束にも入る
  editing.ts     編集画面の入力の助け（インライン命令で囲む、ブロックの雛形、候補の型）。webview の束にも入る
  editor-config.ts 設定 `editor`（紙面に近い見た目の `page` を含む）。webview の束にも入る
  booklayout.ts  本の組版の設定（`sty/*.sty` の本文の幅）を読む
  editor-protocol.ts 拡張と webview の間のやりとりの型
  editor-data.ts 拡張から編集画面に送るもの（参照の札、候補、図のパス、マーカーの位置、編集の当て方）
  diagnostics.ts 診断
  all.ts         テストが読む口（dist/core.js になる）
src/extension.ts VS Code の型に写すだけの層
src/marks-ui.ts  マーカーの VS Code 側（装飾、ホバー、ビュー、コマンド）。これも写すだけ
src/editor-ui.ts 編集画面の VS Code 側（CustomTextEditorProvider、TextDocument との同期、コマンド）
src/webview/     編集画面の webview（CodeMirror 6。dist/webview.js になる）。editor.ts と style.ts
src/cli.ts       VS Code 無しで全体を診断する CLI（`marks` でマーカーの一覧と依頼の書き出し）
tools/           測る・確かめるためのスクリプト（.vsix には入らない）。measure-anchoring.js、
                 check-editor.mjs と check-editor-sync.mjs（編集画面を Chromium で開く）、editor-harness.html、
                 measure-page.mjs（本の PDF を測る）、compare-page.mjs（PDF と編集画面の改行を比べる）

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
理由は、原稿を書く人の環境に `npm install` を強いないため。`.vsix` に入る JavaScript は束ねた
`dist/extension.js`（拡張本体）、`dist/webview.js`（編集画面、0.3.0）、`dist/cli.js`（本の CI から呼ぶ CLI）だけ
（0.3.0 の `.vsix` は 192 KB。テスト用の `dist/core.js` は `.vscodeignore` で外す）。
0.1.0 のときは `dist/*.js` だけで 42 KB だったが、0.2.0 までは `dist/core.js` も入っていた（`.vscodeignore` が外していなかった）。

### 例外: 編集画面の CodeMirror 6（0.3.0）

記法を畳む編集画面（`src/webview/`）だけは CodeMirror 6（`@codemirror/state`、`view`、`commands`、
`search`、`autocomplete`。`autocomplete` が `language` を引く）を使う。計画書
（`../plans/marks-and-editor-plan.md` の「決めたこと」）で決めた唯一の例外で、理由は、日本語の IME、
範囲の装飾、検索、候補の窓を自前で書くのは割に合わないため。

* esbuild で `dist/webview.js` の 1 ファイル（minify して 345 KB）に束ね、`.vsix` に入れる。原稿を書く人に
  `npm install` を強いない点は変わらない。`package.json` では `devDependencies`（束ねるので実行時には要らない）
* **拡張本体（`dist/extension.js`）には入れない。** webview の束が読む `src/core/` のファイル（`fold.ts`、
  `editing.ts`、`editor-config.ts`、`parser.ts`、`width.ts`）はファイルシステムに触らないものだけにしてある。
  `src/webview/tsconfig.json` だけが DOM の型を持ち、拡張の側の `tsconfig.json` は `src/webview/` を外す
  （拡張の側で DOM を触る書き間違いを型で止める）。`npm run typecheck` は両方を回す
* 取り消しの履歴（`@codemirror/commands` の `history`）は入れない。取り消しは VS Code の TextDocument のもの（下記）

devDependencies の `vscode-textmate` と `vscode-oniguruma`（0.1.2 で追加、文法のテスト用）は
`.vscodeignore` が `test/**` と `node_modules/**` を外しているので `.vsix` には入らない。

ビルドは esbuild で 4 つの束にする。`dist/extension.js`（`vscode` は external）、
`dist/cli.js`、`dist/core.js`（テスト用）、`dist/webview.js`（編集画面。ブラウザ向け、`chrome114` = VS Code 1.85 の
Electron 25）。

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

## マーカー（0.2.0）

マーカーは原稿に書かず、ワークスペースの `.review-assist/marks.json` に置く（計画書
`../plans/marks-and-editor-plan.md` の「決めたこと」）。1 件は

```json
{ "id": "m…", "kind": "ai-check", "file": "contents/vm.re",
  "quote": "選んだ文字列", "prefix": "直前 32 文字", "suffix": "直後 32 文字",
  "line": 101, "note": "", "created": "2026-10-17T…Z", "status": "open" }
```

`line` は**1 起点**（人と AI が読むので。`src/core` の他の行番号は 0 起点）。id は `m` + 作った時刻の 36 進で、
消したマーカーの id が後で別のマーカーに使い回されない（古い AI の結果が別のマーカーに付かない）。

### 位置の探し直し（`anchorMark`）

offset や行番号は保存しない。原稿を開いたとき・打つたび・保存のたびに文字列で探す
（W3C Web Annotation の TextQuoteSelector と同じ考え方）。

1. `quote` が 1 か所にあれば、そこ
2. 何か所もあれば、前後の文脈がいちばん長く一致する所。同点なら `line` に近い所
3. 無ければ、`prefix` と `suffix` が両方そのまま残っていて、間が空でなく、段落の切れ目を `quote` より
   多く含まない所（選んだ文の中が直された）。候補が複数なら長さが `quote` に近い所、次に `line` に近い所
4. どれでもなければ「見失った」。**消さない**。ビューに警告の印で出し、依頼には付けたときの文で入れる

保存のとき（`onDidSaveTextDocument`）に、そのファイルのマーカーを今の位置で取り直す（`refreshMark`:
`quote`・`prefix`・`suffix`・`line` を更新）。こうすると少しずつ直していく分には毎回追いつける。
見失ったものは取り直さない。

文字列での探し方を選んだ理由と、文脈の長さを測った結果は `thresholds.md` と `../verification/marks.md`。
エディタの装飾の範囲（VS Code が編集に合わせて動かす）に頼らないのは、VS Code を閉じると消えるのと、
ファイルの外（git の pull、別のエディタ、AI）で直されたときに追えないため。

### AI との受け渡し

拡張は AI を呼ばない。ファイルを 2 つ置くだけ。

* `ai-check.md`（拡張が書く）: 未済の `aiKind`（既定 `ai-check`）を章の順に。1 件ごとに id、章、ファイルと行、
  見出しの道筋、メモ、選んだ文、選んだ所を含む段落と前後 `contextParagraphs` 段落。先頭で設定 `aiProcedure` の
  文書（本の側の手順）を指し、末尾に結果の JSON の雛形（id と `quote` を埋めたもの）を付ける。
  コードブロックの囲みは中身の ` の連続より 1 つ長くする（原稿に ``` が出てきても壊れない）
* `ai-results.json`（AI が書く）: `{"version":1,"results":[{"id","quote","verdict","comment","suggestion"?}]}`。
  拡張は `FileSystemWatcher` で見て、ホバーとビューに出す。壊れた JSON は結果 0 件で知らせ、
  壊れた項目と知らない id はその項目だけ落として出力に書く

`quote` を結果に写してもらうのは、AI が見た後で原稿が直されたかを見分けるため（ホバーに
「AI が見た後で文が変わっている」、「案を当てる」は確認してから当てる）。「案を当てる」は
選んだ範囲を `suggestion` で置き換え、マーカーを置き換えた後の文に取り直す。**済みにはしない**。

## 記法を畳む編集画面（0.3.0）

計画書の段階 2。経緯は `../worklog/2026-10-17-v0.3.0-editor.md`、確かめた結果は `../verification/editor.md`。

```
VS Code の TextDocument（正）
   ↑ WorkspaceEdit（webview の編集）       ↓ 外からの変更は全文（text）
src/editor-ui.ts  ReviewEditorProvider（CustomTextEditorProvider、viewType reviewAssist.editor、priority option）
   ↑ edit / selection / sync / command      ↓ init / text / ack / data / wrap / insert / reveal
dist/webview.js   CodeMirror 6 の EditorView。畳む装飾は src/core/fold.ts の一覧から
```

### 文字列は 1 文字も書き換えない

webview は `.re` の文字列そのものを CodeMirror の文書として持ち、記法は装飾（`Decoration.replace` と `mark`、
`line`、図だけ `widget`）で隠す・見た目を変えるだけ。文書の中身を変えるのは人の入力と、入力の助け
（囲む、雛形、候補）だけで、どれも普通の編集として TextDocument に当たる。

### どこを畳むか（`src/core/fold.ts`）

`planFolds(text)` が `parseReview`（`parser.ts`）の結果から、畳む項目の一覧を作る（インライン命令、見出し、
`#@` の行、箇条、ブロックの頭・本文・終わり、表の行と区切り、記法のまま残すもの）。位置は CodeMirror の
数え方（行の切れ目を 1 文字）。パーサは増やしていない。箇条（` * ` など）は 0.1 のパーサが見ていなかったので
`parser.ts` に足した（`ParsedFile.listItems`。Re:VIEW 2.5.0 の `Compiler#compile_block` と同じ正規表現）。
表のセルの切り方と区切りの行は Re:VIEW 2.5.0 の `Builder#table`（`split(/\t+/)`、`/\A[=-]{12}/`）に合わせた。

webview は文字が変わるたびに `planFolds` を回し直す（`vm.re` で 1.4 ms ほど）。カーソルが動くたびに、
一覧とカーソルの位置から装飾を作り直す。**記法が出る条件**: インライン命令はカーソル（選択のどれか）が
その範囲に触れているとき（端を含む。隣に置くだけで出る）、行の記法（見出し、箇条、ブロックの頭、`//}`、
表の区切り）はカーソルがその行にあるとき。表の行のタブは記法というより区切りなので、カーソルがあっても
列をそろえたままにする。

参照の札に出す題（`@<hd>` なら見出し）は索引を引かないと決まらないので、拡張の側で `refLabels`
（`editor-data.ts`、`resolve.ts` を使う）が作って送る。

### TextDocument との同期

* webview の編集は 1 トランザクションごとに番号（`seq`）を付けて `edit` で送る。位置は**行と桁**
  （CRLF の原稿では、VS Code は `\r\n` を 2 文字、CodeMirror は 1 文字と数えるので、通しの位置では合わない）。
  拡張は順に `WorkspaceEdit` で当て、`ack` を返す。拡張は「webview が持っているはずの文字列」（`mirror`、
  `applyTextChanges`）も追い、当てた結果と食い違えば全文を送り直す
* 自分の編集を当てている間の変更の通知は送り返さない。それ以外の変更（取り消し、普通のエディタ、
  ディスクからの読み直し、「案を当てる」）は全文を `text` で送る。webview は前後の共通部分を残して
  間だけ置き換える（カーソルが写る）
* webview にまだ `ack` の来ていない編集があるときに `text` が来たら、すぐには当てず、`ack` が揃ってから
  `sync` を頼んで全文をもらい直す（行き違いで食い違ったままにならない。正は TextDocument）
* マーカー・診断・札は、拡張が当て終えた番号（`seq`）と一緒に送る。webview はそれより後の自分の編集で
  位置を写す（打っている間に印がずれない）。前と同じ中身は送らない（webview は受けるたびに装飾を作り直すため）
* 保存・取り消し・未保存の印は TextDocument のもの。webview は取り消しの履歴を持たないので、`Ctrl+Z` は
  VS Code が webview から受けて取り消しを行い、その変更が `text` で戻ってくる

### マーカーとコマンド

マーカーの位置は拡張の側で `anchorMark` で探し直し（`markViews`）、行と桁で送る。編集画面が前にあるときは
`activeTextEditor` が無いので、`marks-ui.ts` は `EditorBridge`（`editor-ui.ts` が実装）から文書と選択を
もらう。ホバーのボタンは `command` で既存のコマンド（`reviewAssist.toggleMarkDone` など）を呼ぶ。
右クリックのメニューは `webview/context`（`webviewId == 'reviewAssist.editor'`）。

### 紙面に近い見た目（段階 3）

設定 `editor.page`。経緯は `../worklog/2026-10-17-v0.3.0-page.md`、測った値と出どころは `thresholds.md` の「編集画面」。

* **1zw = エディタの文字の大きさ。** 紙面の pt は使わず、本文の和文の大きさ（1zw）に対する比で全部を決める。
  本文の幅は `width: Nem`（N は本の `sty/*.sty` の `\textwidth` の zw。`booklayout.ts` が読み、拡張が `init` で送る）。
  CodeMirror の行の左右の余白は 0 にし、行の幅 = 本文の幅にする
* 行の送り、見出し・コード・表・キャプションの大きさと行の送り、書体の並びは、拡張が送る設定から CSS を作る（`themeFor`）。
  欧文だけ大きくする（`latinScale`）のは `@font-face` の `size-adjust` と `unicode-range`
* **表の列は実際の書体で測ってそろえる。** 段階 2 は半角換算（全角 2）と等幅の書体でそろえていたが、紙面の表は明朝なので、
  セルの見える文字列（畳んだインライン命令は畳んだときの書体と文字、参照の札は札の枠の幅も）を canvas の `measureText` で測り、
  タブを「列のいちばん広いセル − このセル + 列の間」の px に広げる。書体は隠した見本の行の `getComputedStyle` から取り、
  書体が読み込まれたら（`document.fonts.ready`）測り直す。`fold.ts` はセルの範囲だけを渡す
* **見出しの横に PDF のページ。** 拡張が `headingPages`（`editor-data.ts`、`pdfpages.ts` の `lookupPage`）で、索引にその見出しの鍵が
  そのままある見出しだけページを送る（上の段に落としたページは、その見出しのページではないので出さない）。原稿が未保存か、
  原稿のファイルが PDF より新しいときは薄く出す（`pagesStale`）
* 紙面からはみ出しそうな所（表の幅、コードの行長）は、既存の診断（`tableWidth`、`maxCodeLineLength`）がそのまま波線で出る
* `editor.page.enable: false` で段階 2 の見た目（UI の書体、幅の制限なし）に戻る

### VS Code 無しで確かめる

webview は `acquireVsCodeApi` が無ければ送るものを `window.__reviewAssistHost` に溜める。
`tools/editor-harness.html` で開き、`tools/check-editor.mjs`（全章の表示と文字列）と
`tools/check-editor-sync.mjs`（拡張の側を Node で真似て同期とコマンド）が Playwright で回す。
