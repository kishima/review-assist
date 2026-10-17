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

```
読み込みと最初のページまで 266 ms
ok   p.37: shown {"type":"shown","page":37,"pages":365}、ページの上端 0px、canvas true、黒い画素 15456
ok   p.1: shown {"type":"shown","page":1,"pages":365}、ページの上端 0px、canvas true、黒い画素 2437
ok   p.84: shown {"type":"shown","page":84,"pages":365}、ページの上端 0px、canvas true、黒い画素 10228
```

`dist/pdfview.js` と worker を http で配り（`tools/pdf-harness.html`）、拡張と同じく PDF のバイト列（2.9 MB）を `load` で渡した。ページごとに、
`shown` のページ番号、そのページの要素が窓の上端にあること、canvas が描かれて白でない画素があることを見た。最初の `load` から p.37 が出るまで
266〜819 ms（1 回目は Chromium の起動直後）。撮った画面で p.84（4.1.2 オブジェクトの割り当て）が出ていることを目で見た。

偽の `vscode` モジュール（スクラッチの台。**`book_mruby3` の写しに対して**動かした。下の「起きたこと」）で、拡張の側:

* 「この節を PDF で開く（横に）」: パネル `reviewAssist.pdf` が `ViewColumn.Beside`・`preserveFocus`・`retainContextWhenHidden` で開き、CSP に `worker-src blob:`
* `ready` の後に `load`（p.37、2,904,761 バイト、`workspace.fs.readFile` で 1 回）。別の見出しで 2 回目は `goto` だけ（読み直さない）、パネルは 1 枚のまま前に出る
* 記法を畳む編集画面が前のとき（`activeTextEditor` が無い）も、編集画面の選択の行からページを引いて開く
* 「この節を PDF で開く（外のビューアで）」は 0.2.0 と同じく `openExternal` に `file:` の URI

リモートの窓（WSL）で本当に開けるかは著者の実機で（README の確かめ方 27）。PDF は拡張の側（WSL）の `workspace.fs` で読み、webview にはバイト列で
送るので、webview（Windows）から PDF のファイルが見える必要は無い。

## Unicode の警告

`package.json` の `contributes.configurationDefaults` に `"[review]": { "editor.unicodeHighlight.nonBasicASCII": false, "editor.unicodeHighlight.ambiguousCharacters": false,
"editor.unicodeHighlight.invisibleCharacters": false }`。VS Code の実機でしか確かめられない（README の確かめ方 28）。

## `.vsix`

`review-assist-0.3.0.vsix`: 13 ファイル、716 KB（直す前の 0.3.0 は 192 KB）。増えたのは PDF の画面の `dist/pdfview.js`（376 KB）と
`dist/pdf.worker.min.mjs`（1.4 MB）で、圧縮して 520 KB ほど。
