# マーカー（0.2.0、計画書 marks-and-editor-plan.md 段階 1）の確かめ

2026-10-17。経緯は [worklog](../worklog/2026-10-17-v0.2.0-marks.md)。

## 単体テスト（`test/marks.test.js`、25 件）

`npm test` で全 128 件（0.1.2 までの 103 件 + 25 件）が通る。

```
# pass 128
# fail 0
```

計画書の「確認」との対応:

| 計画書 | テスト |
|---|---|
| 位置の探し直し: 前後に文を足す | `anchorMark: 前後に文を足しても追いつく` |
| 　　選んだ文の中を直す | `anchorMark: 選んだ文の中を直すと fuzzy で直した後の文に当たる` |
| 　　段落を移す | `anchorMark: 段落を移しても exact で当たる` |
| 　　消す | `anchorMark: 選んだ文を消すと見失う（別の所に当てない）`、`文と前後をまとめて書き直すと見失う` |
| 同じ文が 2 か所 | `anchorMark: 同じ文が 2 か所にあると前後の文脈で正しい方を選ぶ`（行の目安をわざと逆にしても文脈が勝つ）、`文脈で決まらなければ行の目安に近い方` |
| 依頼ファイルの形 | `buildAiRequest: 依頼ファイルの形`（未済の ai-check だけ、章の順、手順の文書を指す、見出しの道筋、メモ、前後の段落、囲みの ` の数、見失ったもの、末尾の雛形が JSON として読めて `parseAiResults` に通る） |
| 結果の読み込み（壊れた JSON、知らない id） | `parseAiResults: 正しい項目、知らない id、壊れた項目、壊れた JSON` |

ほかに、サロゲートの片割れで文脈を切らないこと、ファイルの先頭・末尾のマーカー、
`refreshMark`、保存形式の往復と壊れた項目、id の重なり、設定の読み込み、ビューの並び、
「案を当てる」の範囲と「AI が見た後で文が変わっている」の判定。

## 実物の修正に当てて見失う割合を数える

`tools/measure-anchoring.js`（`npm run build` の後で `node tools/measure-anchoring.js <本>`）。
`book_mruby3`（`5484b88`）の git log のうち、`.re` を触った親 1 つのコミット 93 本について、
親の側の `.re` の地の文を「。」で文に切って 1 文ずつマーカーにし（前後の文脈は長さ L）、
子の側で探し直して、`git diff -U0` の hunk から決まる正解と比べた。生成物（`contents/opcodes.re`、
`contents/` に移す前の `chapter03.re`）は外した。変更のあったファイルの組 390、文 75,499 個。

分類:

* **行が不変**: 文のある行が hunk の外。正解は対応する新しい行の同じ桁（exact で当たること）
* **hunk 内・文が残る**: 行は直されたが、文はその hunk の新しい側にそのまま残っている
* **別の hunk に移った**: その hunk には無く、別の hunk の新しい側にそのまま出てくる（段落を移した）
* **文が直された**: どの hunk の新しい側にもそのままは無い。hunk の新しい側に当たれば「正しい」（fuzzy）、
  hunk の外に当たれば「取り違え」、当たらなければ「見失った」

| L | 分類 | 件数 | 正しい | 取り違え | 見失った |
|---|---|---|---|---|---|
| 0 | 行が不変 | 72316 | 72168 (99.80%) | 148 (0.20%) | 0 (0.00%) |
| 0 | 文が直された | 2395 | 0 (0.00%) | 9 (0.38%) | 2386 (99.62%) |
| 8 | 行が不変 | 72316 | 72277 (99.95%) | 39 (0.05%) | 0 (0.00%) |
| 8 | 文が直された | 2395 | 752 (31.40%) | 38 (1.59%) | 1605 (67.01%) |
| 16 | 行が不変 | 72316 | 72292 (99.97%) | 24 (0.03%) | 0 (0.00%) |
| 16 | 文が直された | 2395 | 643 (26.85%) | 16 (0.67%) | 1736 (72.48%) |
| **32** | 行が不変 | 72316 | 72309 (99.99%) | **7 (0.01%)** | 0 (0.00%) |
| **32** | 文が直された | 2395 | 574 (23.97%) | **9 (0.38%)** | 1812 (75.66%) |
| 64 | 行が不変 | 72316 | 72309 (99.99%) | 7 (0.01%) | 0 (0.00%) |
| 64 | 文が直された | 2395 | 522 (21.80%) | 9 (0.38%) | 1864 (77.83%) |
| 128 | 行が不変 | 72316 | 72309 (99.99%) | 7 (0.01%) | 0 (0.00%) |
| 128 | 文が直された | 2395 | 433 (18.08%) | 9 (0.38%) | 1953 (81.54%) |

「hunk 内・文が残る」（727 文）と「別の hunk に移った」（61 文）は、**どの L でも 100% 正しい**
（見失い・取り違えとも 0）ので表から省いた。全行は `node tools/measure-anchoring.js` の出力にある。

読み方:

* **見失うのは「選んだ文そのものが書き直された」ときだけ**で、L=32 で全 75,499 文のうち 1,812 文（2.4%）。
  そのうち 574 文（24%）は前後の文脈から直した後の文に追いつける。L を短くすると追いつける割合は上がる
  （L=8 で 31%）が、文脈が短いと別の所の同じ文脈に当たって取り違えが増える
* **取り違え（別の所に当てる）は L=32 で下げ止まる**（行が不変 7、文が直された 9。L=64・128 でも同じ）。
  `--show-wrong 32` で 16 件を全部見ると、14 件は sub-article の `** Opr: @<code>{B: a(B)}` のような
  同じ文字列の行（1 ファイルに同じ行が何度も出て、周りも似ている）、2 件は `porting.re` の短い断片
  （`@<code>{kernel}が対象です。`）が消され、同じ文字列が同じファイルの別の所にあったもの
* 取り違えが下げ止まる最小の L が 32 なので、**既定の `marks.contextLength` を 32 にした**
  （[thresholds.md](../design/thresholds.md)）

測った時間は 1 回 約 46〜50 秒（6 通りの L を合わせて約 45 万回の探し直し。git の呼び出しを含む）。

## 探し直しの速さ

`book_mruby3` でいちばん大きい `contents/vm.re`（75,179 文字）の文 679 個をマーカーにし、1 文足した
原稿で全部を探し直した（3 回）。

```
vm.re 75179 chars, 679 marks: 75.0 ms total, 0.111 ms/mark, lost 0
vm.re 75179 chars, 679 marks: 65.0 ms total, 0.096 ms/mark, lost 0
vm.re 75179 chars, 679 marks: 74.5 ms total, 0.110 ms/mark, lost 0
```

1 件 0.1 ms ほどなので、エディタで打つたびに（`onDidChangeTextDocument`）そのファイルのマーカーを
全部探し直しても、間引き（待ち時間の設定）は要らないと判断した。1 ファイルに数百件付けると
打つたびに数十 ms になるので、そうなったら間引きを足して待ち時間を測る。

## 依頼 → AI の結果 → 読み込みの 1 巡（実装担当が代わりに）

`book_mruby3` に core の API で 3 件のマーカーを付けた（スクリプトはスクラッチパッド。原稿は触っていない）。

| id | 種類 | 場所 | メモ |
|---|---|---|---|
| `mmvc86kg0` | ai-check | `contents/gc.re:181`「初期値は@<code>{MRB_GC_ARENA_SIZE}（100）」 | 4.1 でも 100？ |
| `mmvc86l7s` | ai-check | `sub-article/chap3-004-LOADI.re:16`「レジスタ(a)に整数bをセットする。bは符号付き16bit。」 | |
| `mmvc86lzk` | read-later | `contents/vm.re:101` | |

`node dist/cli.js marks ../../book_mruby3 --request` で `.review-assist/ai-check.md` に 2 件（read-later は
入らない）が書き出された。`book_mruby3/docs/notes/review-assist-ai-check.md` の手順のとおりに
`../ref/mruby`（4.1.0-rc2）を読んで `ai-results.json` を書いた:

* `mmvc86kg0`: `ok`。`include/mruby/gc.h:24-25` の既定 100、`src/gc.c:573-576` の `mrb_gc_init`
* `mmvc86l7s`: `question` と案。事実は合っている（`src/vm.c:3208-3209` の `(mrb_int)(int16_t)b`、
  `codegen.c:935,941`）が、同じ概要の LOADI8・LOADINEG は範囲を数で書いているので揃えるかを著者に聞く形
* 加えて `marks.json` に無い id `mremoved` を 1 件わざと入れた

CLI で読み直した結果:

```
/home/kishima/book/book_mruby3/.review-assist/ai-results.json: marks.json に無い id mremoved
marks:   /home/kishima/book/book_mruby3/.review-assist/marks.json（3 件）
results: /home/kishima/book/book_mruby3/.review-assist/ai-results.json（2 件）

mmvc86kg0  ai-check  open  contents/gc.re:181
    「初期値は@<code>{MRB_GC_ARENA_SIZE}（100）」 メモ: 4.1 でも 100？
    AI: ok 4.1.0-rc2 でも 100。include/mruby/gc.h:24-25 が ...
mmvc86l7s  ai-check  open  sub-article/chap3-004-LOADI.re:16
    「レジスタ(a)に整数bをセットする。bは符号付き16bit。」
    AI: question 事実は合っている。... 案:「レジスタ(a)に整数bをセットする。bは符号付き16bit（-32768〜32767）。」
mmvc86lzk  read-later  open  contents/vm.re:101
```

`planSuggestion` は `mmvc86l7s` に `{ ok: true, stale: false }` と、今の原稿の選んだ文の範囲を返した。
`groupMarks`（ビューの木）は「AI チェック → gc 1・opcodes 1」「後で読む → vm 1」。

この 1 巡で直したもの:

* sub-article には `=` の章の題が無いので、見出しの道筋が「` > LOADI8、… > 概要`」と空の段から
  始まっていた。空の段を詰めた（テストを足した）
* 依頼の並びで、章に属さないファイルが先頭に来ていた（`chapterOrder.indexOf` が -1）。最後に回した
* 手順の文書: `../ref/mruby` のパスを本の `CLAUDE.md` と同じ書き方にし、`question` でも案を書いてよいことにした

前後の段落は「空行で区切った行の並び」なので、表（`//table` は空行を含まない）の中に付けると
表 2 本と次の段落で 36 行になった。AI が判断に使う材料としてはそのままでよいと判断した（短くする規則を
足すと、その長さがまた数になる）。

終わった後で `book_mruby3/.review-assist/` を消した（`.gitignore` 済みだが、実物の作業の印を残さない）。
本体（Claude）の実地の 1 巡はこの後。

## VS Code の層（偽の `vscode` で起動だけ）

Extension Development Host が使えないので、何でも受け付ける偽の `vscode` モジュール（Proxy）を
`NODE_PATH` に置いて `dist/extension.js` の `activate` を呼んだ。例外なく通り、
`registerCommand` 13 回（`package.json` の `commands` 13 件と名前が一致することを別に確かめた）、
`registerTreeDataProvider` 1、`registerHoverProvider` 2（参照とマーカー）、`createFileSystemWatcher` 2
（設定と `.review-assist/*.json`）。`menus` の全項目が `commands` にあることも確かめた。

これは「起動して登録まで通る」ことしか言っていない。装飾、ホバー、ビュー、入力欄の動きは著者の実機で
（README の「確かめ方」）。

## `.vsix`

`npm run package` で `review-assist-0.2.0.vsix`（11 ファイル、81.78 KB。0.1.2 は 57 KB）。
増えたのは `dist/*.js` の中のマーカーの分と README。実行時依存は増えていない。
