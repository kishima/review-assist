# 数の根拠

この拡張が持っている数と、その出どころ。どれも `.review-assist.json` で上書きできる。
表とコードの 4 つは `book_mruby3/CLAUDE.md`「紙面幅の制約（表とコード）」から来ていて、本文の大きさを
変えたら測り直すこと。マーカー（0.2.0）の数は「マーカー」の節、編集画面（0.3.0）の数は末尾の「編集画面」の節。

## 表の幅の上限（`tableWidth.limits`）

| 列数 | 上限 |
|---|---|
| 2 | 0.93 |
| 3 | 0.90 |
| 4 | 0.87 |

`CLAUDE.md`:「`P{}` の合計と `l` 列の見積もり幅の和の上限は、2 列で 0.93、3 列で 0.90、
4 列で 0.87（残りは列の余白と罫線）」。著者が与えているのはこの 3 点だけ。

**5 列以上と 1 列は外挿した。** `0.96 - 0.015 × 列数` は上の 3 点をちょうど通る
（列が 1 本増えるごとに余白と罫線で 0.015 取られる、という読み方）。測った値ではないので、
`book_mruby3` に 5 列の表が出てきたら実際にビルドして確かめ直すこと。現時点の `book_mruby3` の
表 82 本はすべて 2〜4 列で、外挿は使われていない。

## `l` 列の係数（`tableWidth.charWidth`）= 0.011

`CLAUDE.md`:「`l` 列の幅は最長セルの半角換算文字数 × 0.011（全角は 2 文字）で見積もる
（半角 1 文字 ≒ 0.5zw、本文幅 49zw なので 0.5/49 ≒ 0.0102 に余白分を足した値）」。

**2026-09-19 に 0.012 から 0.011 に変わった。** 同じ日に本文が 10pt・44zw から 9pt・49zw に
なったため（`book_mruby3` の `cfde212`「本文を 9pt に」）。この実装は最初 0.012 で書いてあり、
`book_mruby3` の表 3 本（`references.re` の `mruby_versions`、`vm.re` の `table_ci`、
`extension.re` の `gem_list3`）が上限を 0.004〜0.012 超えると出ていた。0.011 にすると 0 件になり、
**実際の PDF が `Overfull hbox` 0 でビルドできている事実と一致した**。

つまりこの係数は本文の大きさに直結する。`config.yml` の `texdocumentclass` と
`sty/mytextsize.sty` を触ったら、`.review-assist.json` の `tableWidth.charWidth` も直す。

## コードブロックの行長（`maxCodeLineLength`）= 80

`CLAUDE.md`:「**1 行 80 文字以内**にする」。はみ出す実寸は本文の大きさで変わり（10pt で 83 文字、
9pt で 92 文字ほど）、80 という上限は「ダンプの生成やデータセットと揃えるため」据え置かれている。
つまり 80 は紙面の限界ではなく原稿の約束なので、そのまま使う。

## 行長の数え方（`codeLineWidth`）= `"chars"`

既定は**文字数**（全角も 1）。`CLAUDE.md` が「1 行 83 文字」「1 行 92 文字ほど」と文字数で
書いているのに合わせた。

半角換算（全角を 2）で数える案も試したが、`book_mruby3` で 18 件の警告が出た。そのうち
`contents/vm.re:408` は 73 文字・半角換算 85 で、実際の PDF では `Overfull hbox` にならない。
`alltt` の和文は半角 2 個分では無いということなので、半角換算は採らなかった。
文字数で数えると 7 件になり、どれも 81〜83 文字で「80 以内」の約束を破っているだけ（実際には
はみ出していない）という、期待どおりの内容になる。半角換算が要る原稿のために
`codeLineWidth: "halfwidth"` は残してある。

## セルの幅の数え方

セルは半角換算（全角 2）で数える。こちらは `CLAUDE.md` が「全角は 2 文字」と明記している。
インライン命令は中身だけを数え（`@<code>{uint8_t}` は 7）、`@<br>{}` で切って一番長い段を採る
（そこで改行されるため）。

## マーカー（`marks`、0.2.0）

| 設定 | 既定 | 出どころ |
|---|---|---|
| `marks.contextLength` | 32 | 測った。下記 |
| `marks.contextParagraphs` | 1 | 計画書（`marks-and-editor-plan.md` 段階 1）の「選んだ文と前後の段落」= 前後 1 段落ずつ |
| `marks.kinds[].color` | `#40C8AE`（ai-check）、`#40A6FF`（read-later） | VS Code のマージの衝突の色を借りた。下記 |
| `marks.kinds[].background` | `#40C8AE33`、`#40A6FF33` | 同上（不透明度 0.2 = 0x33） |

### 前後の文脈の長さ（`marks.contextLength`）= 32

マーカーは選んだ文字列（`quote`）と、その前後 `contextLength` 文字（`prefix`・`suffix`）を保存し、
原稿が変わったら文字列で位置を探し直す。文脈は「同じ文が何か所もあるときにどれかを決める」ためと、
「選んだ文そのものが直されたときに、前後に挟まれた所を探す」ために使う。

* 短いと、別の所の同じ文脈に当たって**取り違える**（ほかの所に印が移る）
* 長いと、文脈まで直されることが増えて、直された文に**追いつけない**（見失う）

`book_mruby3` の git log の修正 93 コミット・文 75,499 個に当てて、L = 0, 8, 16, 32, 64, 128 で数えた
（`../verification/marks.md`、2026-10-17、`book_mruby3` `5484b88`、`tools/measure-anchoring.js`）。
取り違えは L=8 で 77 件、16 で 40 件、**32 で 16 件になって下げ止まり**（64・128 でも 16 件）、
直された文に追いつける割合は L が長いほど下がる（8 で 31%、32 で 24%、128 で 18%）。
取り違えが下げ止まる最小の長さとして 32 にした。取り違えの方を重く見たのは、見失ったものは
「位置を見失った」とビューに出て著者が気づけるのに対し、取り違えは黙って別の文に印が移るため。

単位は UTF-16 の文字数（JavaScript の文字列の長さ）。和文はほぼ 1 文字 1 単位。
原稿の書き方（1 段落 1 行か、文の長さ）が違う本では測り直すこと。

### 色

既定の 2 色は VS Code 本体のマージの衝突の色（`merge.currentContentBackground` と
`merge.incomingContentBackground`）を借りた。microsoft/vscode の
`src/vs/platform/theme/common/colors/editorColors.ts` で、基の色 `#40C8AE`（current）と `#40A6FF`（incoming）に
見出しの不透明度 0.5 と中身の 0.4 を掛けて 0.2 にしている。説明文に「下の装飾を隠さないよう不透明にしない」とあり、
明暗どちらのテーマでも文字が読めることを VS Code が確かめている色なので、同じ目的（範囲に印を付けて文字は読ませる）に
そのまま使った。ガターの印と概要ルーラーは不透明の基の色。どちらの色をどちらの種類に当てるかは好みで、
著者が変えてよい（`marks.kinds`）。

## 編集画面（`editor`、0.3.0）

紙面に近い見た目（段階 3）の数は、**`book_mruby3` の PDF を測った値**（`tools/measure-page.mjs`、2026-10-17、
`book_mruby3.pdf` 2026-09-28 作成、365 ページ、jsbook `uplatex,papersize,oneside,b5j,9pt`、Re:VIEW Starter）。
PDF の文字の位置・大きさ・書体を pdf.js で取り、本文のページ（最初の章から最後まで）の中でいちばん多い値（最頻値）を採った。
比はどれも**本文の和文の大きさ（1zw = 8.41pt）**に対するもの。編集画面は 1zw を VS Code のエディタの文字の大きさに当て、
ほかを比で決める（だから紙面の pt は要らない）。ほかの本では `node tools/measure-page.mjs <本>` で測り直して `.review-assist.json` に書く。

| 設定 | 既定 | 出どころ（PDF の値、件数は 最頻値の件数 / 全体） |
|---|---|---|
| `editor.page.textWidth` | `"auto"` | 本の `sty/*.sty` の `\setlength{\textwidth}{Nzw}` を読む（`book_mruby3` は `sty/mytextsize.sty:32` の 49zw）。読めなければ 49（PDF の両端をそろえた行の幅 412.13pt ÷ 8.41pt = 49.0、712 / 3622 行） |
| `editor.page.lineHeight` | `1.622` | 本文の行の送り 13.64pt ÷ 8.41pt（3264 / 3497） |
| `editor.page.paragraphIndent` | `1` | 段落の頭の字下げ 8.41pt ÷ 8.41pt（本文の行の左端 51.89pt より右で始まる行の、左端との差の最頻値。897 / 1527） |
| `editor.page.latinScale` | `1.082` | 本文の欧文 9.1pt（LMRoman10、6687 / 7236）÷ 和文 8.41pt（15565 / 16194）。見出しでも 13.1 ÷ 12.11、10.92 ÷ 10.09 で同じ比 |
| `editor.headingScale` | `[1.728, 1.44, 1.2, 1]` | 見出しの和文（Noto Sans CJK JP Bold）: 章の題 14.53pt（21 / 35）、`==` 12.11pt（89 / 89）、`===` 10.09pt（345 / 345）、`====` 8.41pt（68 / 68）を 8.41pt で割った。索引の見出し 580 のうち PDF で見つかった 477 から（`=====` は原稿に無い） |
| `editor.page.inlineCodeScale` | `0.974` | 地の文の中の `@<code>`（Bera Sans Mono）8.19pt ÷ 8.41pt（6707 / 6788） |
| `editor.page.captionScale` | `0.9` | キャプション（「▼表 3.1: …」の和文、Noto Sans CJK JP）7.57pt ÷ 8.41pt（467 / 603） |
| `editor.page.codeScale` | `0.876` | コードの等幅（Bera Sans Mono）7.37pt ÷ 8.41pt（18204 / 18351） |
| `editor.page.codeLineHeight` | `1.335` | コードの行の送り 9.84pt ÷ 7.37pt（3589 / 4646） |
| `editor.page.tableScale` | `0.9` | 表のセル 7.57pt ÷ 8.41pt（原稿の表のセルで本の中に 1 回しか出ない文字列 622 を PDF で探し、見つかった 271 のうち 217） |
| `editor.page.tableLineHeight` | `1.61` | 表の行の送り 12.19pt ÷ 7.57pt（148 / 209） |
| `editor.tableGap` | `3` | 表の列の間（前の列のいちばん広いセルの終わりから次の列の始まりまで）11.28pt（35 / 88）÷ 表の文字の半角（7.57pt ÷ 2）= 2.98 を丸めた。段階 2 の仮の値 2 を、これで置き換えた |
| `editor.page.fonts.*` | 下記 | PDF に埋め込まれた書体の名前（pypdf と pdf.js で読んだ） |
| `editor.hidx` | `"hide"` | 数ではない。計画書（段階 2）の「`@<hidx>` は印ごと隠す（紙面に出ないため。設定で薄く出す）」 |

段階 2 の `editor.headingScale` は HTML の h1〜h5 の既定の大きさ（`[2, 1.5, 1.17, 1, 0.83]`）を借りていた。段階 3 で、
紙面の見出しの大きさを測った上の値に替えた。

**書体**（`editor.page.fonts`）。PDF に埋め込まれていた書体と、PC に無いときに使う近いもの（前から順に、PC にあるものが使われる）:

| 用途 | PDF | 既定の並び（理由） |
|---|---|---|
| 本文の和文 | Noto Serif CJK JP Regular | Noto Serif CJK JP、Noto Serif JP（同じ字形の Web 用）、Yu Mincho / YuMincho（Windows の標準の明朝）、Hiragino Mincho ProN（macOS） |
| 本文の欧文 | Latin Modern Roman 10（LMRoman10-Regular） | LM Roman 10、CMU Serif（Computer Modern の Unicode 対応のもの）。どれも無ければ和文の書体の欧文 |
| 見出しの和文 | Noto Sans CJK JP Bold | Noto Sans CJK JP、Noto Sans JP、Yu Gothic / YuGothic、Hiragino Sans |
| 見出しの欧文 | Nimbus Sans L Bold | Nimbus Sans L、Helvetica、Arial、Liberation Sans（Nimbus Sans L は Helvetica の互換、Arial と Liberation Sans は Helvetica と字幅が同じ） |
| コード | Bera Sans Mono（＋和文は Noto Serif CJK JP） | Bera Sans Mono、Bitstream Vera Sans Mono、DejaVu Sans Mono（Bera は Vera を LaTeX 用にしたもの、DejaVu は Vera から派生した同じ字形）、Consolas・Cascadia Mono（Windows に入っている等幅）、Menlo（macOS）。その後に必ず VS Code のエディタの書体と `monospace`、最後に和文（本文と同じ明朝） |

コードの並びの終わりに必ず `monospace` を置くのは、PC に等幅の名前が 1 つも無いとき、欧文が後ろの和文の書体（本文の明朝）で描かれないため
（0.3.0 を Windows で試したとき、地の文の `@<code>` が本文の明朝で出た。`tools/check-fonts.mjs` で前後を確かめた。`../verification/feedback-0.3.0.md`）。

欧文の大きさを和文の 1.082 倍にするのは、欧文の書体を `@font-face` の `size-adjust` で包んで行う（`unicode-range` で欧文と記号だけ）。
`local()` で引くので、PC に無ければその面は使われず、次の書体（和文の書体の欧文）に落ちる。

**測ったが使わなかった値**: コードの中の和文 7.57pt（コードの等幅 7.37pt と 2.7% 違う）。CSS では 1 つの行の中の和文だけ
大きさを変えるのに、和文の書体も `@font-face` で `local()` の正式な名前（`Noto Serif CJK JP Regular` など、書体と PC で違う）を
並べて包む必要があり、2.7% のために名前の当て推量を増やすのはやめた。

**色と書体は数を持たない。** どれも VS Code のテーマの CSS 変数（`--vscode-editor-font-family`、
`--vscode-textLink-foreground`、`--vscode-errorForeground`、`--vscode-editorWarning-foreground` など）を使う
（`src/webview/style.ts`）。マーカーの色は `marks.kinds` のもの。

**設定にしていない数**（`src/webview/style.ts`）: 罫線の `1px`、札の内側の余白（`0.3em` など）、ホバーの窓の幅の上限
（`40em`）、引用の左の余白（`1em`）、キャプションの前の余白（`0.5em`）、見出しとページ番号の間（`1em` = 全角 1 字）。
どれも紙面にも原稿にも関わらない画面の飾り（紙面に無いもの）で、出どころは無い（見た目で置いた）。段階 3 で見直したが、
紙面に対応する物が無いので測りようがなく、そのままにした。

**打つたびの待ち時間（間引き）は持たない。** `contents/vm.re`（137 KB）で 1 文字打ってから CodeMirror が更新を終えるまで
中央値 4.4〜4.8 ms（段階 3 の紙面に近い見た目で 5.1〜5.7 ms）、最大 13.5〜20.2 ms で、ほぼ 1 フレーム（16.7 ms）に収まる。
いちばん大きい生成物の `contents/opcodes.re`（287 KB）でも中央値 8.2〜9.1 ms（`../verification/editor.md`、`page.md`）。間引きの待ち時間を作れば、その既定値を
また測ることになる。マーカー（0.2.0）と同じ判断。
