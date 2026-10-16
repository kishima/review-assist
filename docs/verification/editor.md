# 記法を畳む編集画面（0.3.0、計画書 marks-and-editor-plan.md 段階 2）の確かめ

2026-10-17。経緯は [worklog](../worklog/2026-10-17-v0.3.0-editor.md)。対象の原稿は `book_mruby3`（`41d785e`）。

## 単体テスト（`test/editor.test.js`、20 件）

`npm test` で全 148 件（0.2.0 までの 128 件 + 20 件）が通る。

```
# tests 148
# pass 148
# fail 0
```

| 何を | テスト |
|---|---|
| パーサの箇条（Re:VIEW 2.5.0 の `compile_block` と同じ形、ブロックの中は箇条にしない） | `parser: 箇条の行…`、`parser: ブロックの中の箇条の形は箇条にしない` |
| 畳む一覧: インライン命令の範囲・中身・逃がしの `\`、`@<href>` の `,` | `畳む: インライン命令の…`、`畳む: @<href>{url,表示} の , の位置` |
| 見出しの印（`=`、`[column]`、`{label}`） | `畳む: 見出しの印…` |
| ブロックの頭・本文・終わり、コードの中のインライン命令は畳まない、キャプションのは畳む | `畳む: ブロック…` |
| 表の行・見出しの行・区切りの行、列をそろえる幅（半角換算、インライン命令は中身だけ、`\t+` は 1 つの区切り）、区切りが無い表は 1 列目が見出し | `畳む: 表の行…`、`畳む: 区切りの行が無い表は…` |
| 図・脚注・引用・改ページ・コメント・箇条 | `畳む: 図・脚注…` |
| 見せ方を決めていない記法は raw として数える | `畳む: 見せ方を決めていない記法は…` |
| CRLF でも位置は CodeMirror と同じ数え方 | `畳む: CRLF でも…` |
| 囲む: `}` と `\` の逃がしが parser で読み戻せる。行をまたぐ選択は囲まない | `囲む: …` |
| 雛形が parser でブロックとして読める。表の区切りは 12 文字 | `雛形: …` |
| 札: 参照先の題、無いもの、曖昧なもの | `札: …` |
| 候補: 同じ章は id、ほかの章は `章ID\|id` | `候補: …` |
| マーカーの位置（行と桁）と AI の結果、見失ったものは出さない | `マーカー: …` |
| webview の編集を文字列に当てる（複数の変更、CRLF、行末を越える桁） | `同期: …` |
| 設定 `editor` | `設定 editor: …` |

`npm run typecheck`（`tsc --noEmit` と `tsc --noEmit -p src/webview`）が通る。

## Chromium で全章を開く（`tools/check-editor.mjs`）

```sh
npm run build
node tools/check-editor.mjs ../../book_mruby3 --latency contents/vm.re --json /tmp/editor.json
```

`dist/webview.js` を `tools/editor-harness.html`（VS Code のテーマの CSS 変数を少しだけ置いた台）で開き、
Playwright（`playwright-core` 1.63、`~/.cache/ms-playwright` の chromium-1243、窓 1200×4000）で
`book_mruby3` の `.re` を 1 本ずつ流し込む。対象は索引に入る 56 本と、索引から外れる生成物の `contents/opcodes.re`
（287 KB、いちばん大きい）の 57 本。参照の札・候補・図は、拡張と同じ `refLabels`・`completionCandidates`・`imagePaths` で作って渡す。

確かめたこと:

1. **pageerror と console.error が 0**
2. **開いただけでは文字列が変わらない**: webview の文書（`sliceDoc()`）が元のファイルと同一で、拡張への編集の送信が 0
3. **カーソルを入れると記法が出る**: 畳んだ項目ごとに、カーソルを別の行に置いたときの行の DOM の文字（外）と、その項目の中に置いたときの文字（中）を見る

   | 項目 | 外 | 中 |
   |---|---|---|
   | インライン命令 | 行に `@<op>{…}` の元の文字列が無い | ある |
   | 見出し | 行が `== ` などで始まらない | 始まる |
   | 箇条 | 行が ` * ` などで始まらない | 始まる |
   | ブロックの頭・`//tsize` | 行に `//name` が無い | 行が `//name` で始まる |
   | `//}`・表の区切りの行 | 行が空 | 行が元の文字列 |

4. **全部の記法にカーソルを入れて回った後でも文字列が同一**、編集の送信が 0

結果（2026-10-17）:

```
ファイル 57、畳む一覧の項目 25729、カーソルで確かめた記法 17307、失敗 0、文字列が変わった・編集を送ったファイル 0、pageerror と console.error 0
```

1 回の走行は 70 秒ほど（`contents/opcodes.re` が 37 秒）。

最初の走行では 2 件（`extension.re` 761 行、`overview.re` 437 行の `//}`）が「外」で行の DOM が見つからなかった。
どちらも描く範囲（CodeMirror の viewport）のちょうど外側の行で、カーソルを動かしたときに CodeMirror が描く範囲を
詰めて、その行が「gap」（描かない部分）になっていた。表示の誤りではなく確かめ方の誤りなので、行が見つからなければ
その行を真ん中に寄せてから見直すようにした。

### 畳んだ記法と、記法のまま残したもの

索引に入る 56 本（生成物の `contents/opcodes.re` は元ファイルと中身が同じなので数えない）の、畳んだ記法の数:

| 記法 | 数 | 記法 | 数 |
|---|---|---|---|
| `@<code>` | 9091 | `//list` | 208 |
| `@<b>` | 496 | `//table` | 79 |
| `@<chap>` | 277 | `//tsize` | 72 |
| `@<hidx>` | 202 | `//emlist` | 72 |
| `@<hd>` | 166 | `//pagebreak` | 44 |
| `@<table>` | 82 | `//image` | 39 |
| `@<list>` | 47 | `//cmd` | 25 |
| `@<br>` | 18 | `//footnote` | 3 |
| `@<href>` | 13 | `//quote` | 1 |
| `@<img>` | 6 | ` * ` | 491 |
| `@<fn>` | 3 | ` ** ` | 504 |
| `=` | 14 | ` 1. ` | 139 |
| `==` | 128 | ` : ` | 107 |
| `===` | 349 | `#@`（薄く） | 247 |
| `====` | 89 | | |

**記法のまま残したもの: 0。** `book_mruby3` の原稿で使っている記法は、計画書の表し方の表に全部入っていた。

数に出ないもの:

* `@<embed>` は原稿に 2 つあるが、どちらも `#@#` の行の中（`opcodes_template.re` 290・340 行）。コメントの行は行ごと薄く出すだけで、中のインライン命令は畳まない
* コードの本文（`//list` などの中、4,396 行）にインライン命令は 0。あっても畳まない（構文の色付けと同じ判断）
* 定義の箇条（` : 語`）の後の説明の行（字下げした行）は、字下げのまま見せる（印が無いので畳むものが無い）

## 打つときの遅さ

`--latency <ファイル>`: 真ん中あたりの地の文の行末にカーソルを置き、Playwright の本物のキー入力（`keyboard.press`）で
英字を 100 文字、20 ms おきに打つ。1 文字ごとに `keydown` の `event.timeStamp` から

* **更新の終わり**: CodeMirror の updateListener が呼ばれた時（文書の更新、`planFolds` の回し直し、装飾の作り直し、DOM の更新が済んだ後）
* **次の rAF**: その後の最初の `requestAnimationFrame`（CodeMirror の測り直しの後、次の描画の直前）

までを取った。あわせて、`view.dispatch` 1 回（1 文字足す）と `planFolds` 1 回の時間を 20 回ずつ。
機械は `vmstat` の idle 92%、ほかに VS Code のサーバが動いている。ファイルを交互に 2〜3 巡（ms、中央値 / p95 / 最大）:

| ファイル | 巡 | キー → 更新の終わり | キー → 次の rAF | dispatch 1 回 | planFolds 1 回 |
|---|---|---|---|---|---|
| `contents/vm.re`（137 KB、1,710 行） | 1 | 4.8 / 8.2 / 14.6 | 6.7 / 17.9 / 18.3 | 5.0 / 7.2 | 1.5 / 3.1 |
| `contents/opcodes.re`（287 KB、生成物） | 1 | 8.2 / 14.8 / 22.4 | 9.6 / 17.6 / 24.2 | 7.3 / 11.9 | 2.6 / 7.7 |
| `contents/vm.re` | 2 | 4.4 / 6.2 / 13.7 | 5.8 / 17.5 / 18.5 | 4.1 / 6.3 | 1.4 / 3.7 |
| `contents/opcodes.re` | 2 | 8.5 / 12.8 / 22.6 | 10.1 / 18.1 / 24.3 | 7.8 / 11.9 | 2.6 / 6.4 |
| `contents/vm.re` | 3 | 4.4 / 6.1 / 13.5 | 5.8 / 17.5 / 18.1 | 3.7 / 6.2 | 2.3 / 10.3 |

`vm.re` は 1 文字ごとの処理が 1 フレーム（16.7 ms）に収まる。`opcodes.re`（索引から外れる生成物で、ふだん手で
開くものではない）は最大で 1 フレームを少し越える。「次の rAF」の p95 が 17〜18 ms なのは、更新が描画の直後に
終わると次の rAF まで 1 フレーム近く待つためで、処理の時間ではない。どちらも打っていて遅れを感じる長さ（数十 ms〜）より
短いので、間引き（待ち時間の設定）は作らなかった。

拡張の側の 1 文字ごとの仕事（Node で 20 回の中央値）: `vm.re` で `updateFile`（解析）1.3 ms、`refLabels` 0.45 ms、
`applyTextChanges` 0.11 ms。`opcodes.re` で 2.8 ms、3.0 ms、0.31 ms。

Chromium の headless で測ったもので、VS Code の webview（Electron）とは描画の仕組みが同じでも、窓の大きさ・書体・
拡張の側との往復（postMessage）が違う。実機の体感は README の「確かめ方」13 で著者に見てもらう。

## 拡張の側とのやりとり（`tools/check-editor-sync.mjs`）

```sh
node tools/check-editor-sync.mjs ../../book_mruby3 [contents/preface.re]
```

拡張の側（`editor-ui.ts`）を Node で真似して（webview の編集を `applyTextChanges` で当てて `ack` を返す。外からの変更は
全文を `text` で送る）、`contents/preface.re` で:

```
ok   1. キー入力の後、拡張の側の文字列と webview の文書が同一
ok   1. 打ったものが入っている
ok   2. 外からの変更に合う
ok   2. 外からの変更を送り返さない
ok   3. ack 前の外からの変更はすぐには当てない
ok   3. ack の後に sync を頼む
ok   3. sync の後で同一
ok   4. 古い番号で来たマーカーの位置が、後の編集（1 行足した）で写る
ok   4. マーカーと診断が装飾になる
ok   4. ホバーにメモ・AI の結果・診断・ボタン
ok   4. ボタンでコマンドを頼む
ok   5. 選んだ所を @<code>{} で囲む
ok   5. 雛形を入れ、カーソルを id の所に置く
ok   5. @<chap>{ で章の候補
ok   5. 候補を選ぶと @<chap>{id} が閉じる
ok   pageerror と console.error が 0
すべて通った
```

1 のキー入力は英字（`keyboard.type`）、日本語の確定文字列（`keyboard.insertText`。IME の確定と同じ `insertText` の入力）、
`Enter`、`BackSpace`。**IME の変換の途中（composition）は Playwright では再現できない**ので、著者の実機で見る。

## 拡張の側（偽の `vscode` で）

Extension Development Host が使えないので、0.2.0 と同じく偽の `vscode` モジュール（スクラッチの台。repo には入れていない）で
`dist/extension.js` の `activate` を回し、編集画面の provider を `contents/vm.re` の偽の TextDocument と偽の webview に繋いだ:

* `activate` が例外なく通り、カスタムエディタ `reviewAssist.editor` とコマンド 18 件が登録される
* HTML に CSP と nonce 付きの script がある
* `ready` → `init`（参照の札 37、図 16、候補 906、診断 1）。札に先の無いものは 0
* `edit` → `WorkspaceEdit` が当たり、`ack` が返る。外からの変更 → 全文の `text`
* 編集画面の選択で「マーカーを付ける: AI チェック」→ マーカーが付き、その位置（行と桁）が `data` で届く。ホバーのボタンの
  `command` → `reviewAssist.toggleMarkDone` が走り、済みになったマーカーが届く
* 「@<code>{} で囲む」「ブロックの雛形を入れる」が webview に `wrap`・`insert` を送る。「編集画面 ⇔ 普通のエディタ」が
  `vscode.openWith(uri, 'default')` を呼ぶ
* 同じ診断が 2 回来ても 2 回目は送らない

試しに付けたマーカーは外し、`book_mruby3/.review-assist/` は消した。

## `.vsix`

`npm run package`（版は 0.2.0 のまま。上げるのは段階 4）: 12 ファイル、**208 KB**（0.2.0 は 82 KB）。
増えたのは `dist/webview.js`（345 KB、圧縮前）。`dist/extension.js` に CodeMirror が入っていないこと
（`codemirror` も `EditorView` も 0 件）を grep で確かめた。

## 確かめていないこと

* VS Code の実機での表示と操作。特に **日本語 IME**、`Ctrl+Z`（VS Code が webview から受けて TextDocument を取り消すか）、
  保存、右クリックのメニュー（`webview/context`）、編集画面 ⇔ 普通のエディタの行き来（未保存のとき）、テーマの色。
  README の「確かめ方（0.3.0）」の 15 の手順
* CRLF の原稿（単体テストで位置の数え方だけ見た）
* `retainContextWhenHidden` を使っていないので、タブを裏に回すと webview は捨てられ、戻すと `ready` → `init` で作り直す
  （スクロールとカーソルの位置は `setState` で戻す）。実機で戻ったときに元の所に戻るかは見ていない
