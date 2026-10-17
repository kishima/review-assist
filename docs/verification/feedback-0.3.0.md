# 0.3.0 を著者が Windows で試した後の直し（参照の札、コードの書体、PDF の画面、Unicode の警告）の確かめ

2026-10-17。経緯は [worklog](../worklog/2026-10-17-v0.3.0-feedback.md)。著者は VS Code を Windows で開き、WSL のリモートの窓で
`book_mruby3` を編集している（webview は Windows の側で描かれる）。

## 参照の札が紙面に印刷される形か（`tools/check-printed-refs.mjs`）

```sh
node tools/check-printed-refs.mjs ../../book_mruby3
```

Re:VIEW がビルドの途中で書いた LaTeX（`book_mruby3-pdf/*.tex`、2026-09-28）と、PDF（同じ日）に当てた。

| 何 | 比べ方 | 結果 |
|---|---|---|
| 表・リスト・図 | `.tex` の `\reviewtableref{3.1}{table:vm:id}` などの番号と、札（`表3.1`） | 88 か所すべて同じ（表 82、図 6。`@<list>` は `.tex` では `\reviewlistref` で、これも含む） |
| 見出し | 札（`「9.19 EXCEPT、RESCUE、RAISEIF、MATCHERR」`）が、参照のある章の `.tex` にそのままあるか | 166 か所すべてある（`secnolevel: 4` を `config.yml` から読んだ） |
| 章 | 札（`第3章`、`付録A`）の数が、その章の `.tex` の中の同じ文字列の数以下か | 277 か所すべて |
| 脚注 | 札 `*k` の k 番目の `\footnote{…}` が、その脚注の文か | 3 か所すべて |
| PDF | 参照の直前の地の文（命令を含まない 6 字）と札をつないだ文字列が、PDF の文字にあるか（種類ごとに 5 か所まで） | 23 か所すべてある（章 5、見出し 5、表 5、リスト 5、脚注 3。図は直前に命令の無い参照が無く、`.tex` だけで確かめた） |

PDF で見つかった例: `contents/vm.re:103` の `（@<hd>{opcodes|chap_EXCEPT}）` → 札 `「9.19 EXCEPT、RESCUE、RAISEIF、MATCHERR」`、PDF p.37 に
「たためです（「9.19 EXCEPT、…」）」。`contents/vm.re:433` の `@<fn>{labeltable}` → 札 `*2`、PDF p.46 に「なっています*2」。

単体テスト（`test/editor.test.js`）: 札の形（`第2章`、`リスト1.1`、`表1.1`、`図1.1`、`*1`、`secnolevel` 2 で `「2.1 A命令」` と `「細かい話」`、
4 で `「1.1.1 細かい話」`）、章の番号（PREDEF と POSTDEF は無し、APPENDIX は `付録A`）、見出しの番号（column の中は数えない）、`secnolevel` の読み込み。
`npm test` 152 件が通る。

## コードの書体（`tools/check-fonts.mjs`）

Chromium の DevTools Protocol の `CSS.getPlatformFontsForNode` で、地の文の `@<code>` とコードの本文を実際に描いた書体を取った（`contents/vm.re`）。
Windows の書体はこの機械（WSL）に無いので、3 とおりで開いた: 既定、Windows 相当（コードの名前を Consolas・Cascadia Mono だけにし、VS Code の
エディタの書体を Windows の既定 `Consolas, 'Courier New', monospace` に。どれもこの機械に無い）、等幅が全部無い（存在しない名前だけ）。

| | 直す前（`49ce634`） | 直した後 |
|---|---|---|
| 既定 | `@<code>` DejaVu Sans Mono、コード DejaVu Sans Mono | 同じ |
| Windows 相当 | **`@<code>` Noto Serif CJK JP（本文の書体）**、コード Liberation Mono | `@<code>` Liberation Mono、コード Liberation Mono |
| 等幅が全部無い | **`@<code>` Noto Serif CJK JP、コード Liberation Serif** | `@<code>` DejaVu Sans Mono、コード DejaVu Sans Mono |

直す前の「Windows 相当」が著者の見たもの（`mrb_state`、`src/vm.c` が本文の明朝）と同じ。直した後は `monospace`（この機械では DejaVu Sans Mono か
Liberation Mono）まで落ちて、本文の書体には落ちない。Windows の実機では Consolas（VS Code のエディタの書体の既定）になるはず（著者に見てもらう）。

コードの本文が「等幅が全部無い」で Liberation Serif になっていたのは別の原因だった: 段階 2 の CSS の `.cm-ra-body-code, .cm-ra-dir-code ~ .cm-ra-body-code`
の 2 つ目の選択子がクラス 2 つ分強く、段階 3 の書体の指定（クラス 1 つ）に勝っていた。2 つ目の選択子を消し、段階 2 の指定にも `monospace` を足した。

## PDF の画面（`tools/check-pdfview.mjs`）

### 1 回目の形で通ったのに、著者の窓で落ちた理由

1 回目の形は、拡張が `workspace.fs.readFile` で読んだバイト列を `postMessage` で webview に送っていた。著者の窓（Windows の VS Code、WSL のリモート）では
「PDF を表示できません（Invalid PDF binary data…）」になった。1 回目の試験は、台（`tools/pdf-harness.html`）の中で `fetch` した `Uint8Array` を
`window.postMessage` で渡していた。同じページの中の `postMessage` は structured clone なので `Uint8Array` は `Uint8Array` のまま届く。
VS Code のリモートの窓で拡張（WSL）から webview（Windows）へ届くときの直列化を通っていないので、**型が変わる場合を試験が見られなかった**。

### 再現してから直した

試験に渡し方を足した（`--modes=url,bytes,json,nourl`）。`json` は `JSON.parse(JSON.stringify(Uint8Array))`、つまり `{"0":37,"1":80,…}` の普通のオブジェクトで渡す。
直す前のビルドで回すと、著者の窓と同じ文で落ちた:

```
渡し方 bytes:
  ok   p.37: {"type":"shown","page":37,"pages":365} …
渡し方 json:
  FAIL p.37: {"type":"error","message":"Invalid PDF binary data: either TypedArray, string, or array-like object is expected in the data property."}
渡し方 url:
  FAIL p.37: {"type":"error","message":"getDocument - no `url` parameter provided."}   （直す前は url を知らない）
```

直し方: PDF のバイト列は送らない。拡張は `webview.asWebviewUri(pdf)` の URL（PDF のフォルダを `localResourceRoots` に入れる）を渡し、webview が
`fetch` で全体を読む（VS Code の資源の読み込みを通るので、リモートの窓でも webview から読める）。読めなかったときだけ webview が `fetchFailed` を返し、
拡張がバイト列を送る。そのときは読んだ Buffer（プールの一部のことがある）を、ちょうどの長さの新しい `Uint8Array` に写して送り、webview は
`Uint8Array`・`ArrayBuffer`・配列・`{"0":…}` のオブジェクト・`{"type":"Buffer","data":[…]}` のどれでも受ける。直した後（`book_mruby3` の写しで）:

```
渡し方 url:    p.37・p.1・p.84 ok（最初のページまで 548 ms）
渡し方 bytes:  p.37・p.1・p.84 ok
渡し方 json:   p.37・p.1・p.84 ok（JSON の形を Uint8Array に直してから）
渡し方 nourl:  ok fetchFailed {"type":"fetchFailed","message":"404 Not Found"}
```

偽の `vscode` モジュール（`book_mruby3` の写しに対して）で、拡張の側:

* `load` に `url`（`asWebviewUri` の結果）が入り、バイト列は入らない。`workspace.fs.readFile` は呼ばれない。`localResourceRoots` は `dist` と PDF のフォルダ
* `fetchFailed` を受けると、バイト列を送る。偽の `readFile` はわざと「大きいプールの途中を指す `Uint8Array`」（前後に別の中身）を返すようにしたが、送られたものは
  `byteOffset` 0、`byteLength` = `buffer.byteLength` = 2,904,761、先頭が `%PDF-`
* 2 回目（同じ PDF）は `goto` だけ、パネルは 1 枚、外のビューアのコマンドは `openExternal`

**まだ見られないもの**: VS Code の資源の読み込みが、リモートの窓で webview の `fetch` に PDF を返すこと（Playwright の台は http で配っている）。著者の実機で
（README の確かめ方 27）。返らなくても、バイト列の道（JSON の形も受ける）に落ちる。

## Unicode の警告

`package.json` の `contributes.configurationDefaults` に `"[review]": { "editor.unicodeHighlight.nonBasicASCII": false, "editor.unicodeHighlight.ambiguousCharacters": false,
"editor.unicodeHighlight.invisibleCharacters": false }`。VS Code の実機でしか確かめられない（README の確かめ方 28）。

## 畳んだ記法の背景（設定 `editor.foldedBackground`）

`tools/shot-editor.mjs` で `contents/vm.re` の同じ所を、Light Modern と Dark Modern の色（VS Code の `extensions/theme-defaults/themes/*_modern.json` の値を
台に置いた）で撮った: [`images/tint-light.png`](images/tint-light.png)、[`images/tint-dark.png`](images/tint-dark.png)。`@<code>` の中身、`*1`・`図3.1` の札、
ブロックの頭の札に薄い背景が付き、明暗どちらでも文字が読める。PDF と並べた画像（[`images/vm-p37.png`](images/vm-p37.png)、[`images/gc-p84.png`](images/gc-p84.png)）も
背景付きで撮り直した。

## `.vsix`

`review-assist-0.3.0.vsix`: 13 ファイル、718 KB（直す前の 0.3.0 は 192 KB）。増えたのは PDF の画面の `dist/pdfview.js`（376 KB）と
`dist/pdf.worker.min.mjs`（1.4 MB）で、圧縮して 520 KB ほど。
