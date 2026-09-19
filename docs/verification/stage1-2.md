# 段階 1・2 の確認（2026-09-19）

VS Code の Extension Development Host が使えない環境なので、**確かめたのは `src/core/`
（VS Code に依存しない層）だけ**である。`src/extension.ts` は型を写すだけにしてあるが、
実機での確認は済んでいない（下の「確かめていないこと」）。

## 単体テスト

```
$ npm test
# tests 67
# pass 67
# fail 0
# skipped 0
```

| ファイル | 何を確かめるか | 件数 |
|---|---|---|
| `test/parser.test.js` | 見出し（深さ・ラベル・修飾子・column）、索引の鍵、ブロック（id・キャプション・本文・`//tsize` の結び付き）、逃がし文字（`\]` と `\}` を逃がしつつ `\textwidth` を壊さない）、行の種別、キャプションの範囲 | 16 |
| `test/resolve.test.js` | `catalog.yml` の 4 節、`chapters` による読み替えと生成物の除外、`@<chap>`、`inline_hd` の切り方、`@<hd>` の完全一致・部分一致・曖昧・column・章指定・章をまたぐ道、`@<list>/@<table>/@<img>/@<fn>`、`Index#[]` そのもの、`imagePreview`、1 ファイルの読み直し | 15 |
| `test/tablewidth.test.js` | 半角換算、`//tsize` の読み取り（`@{}` などの飾りを除く）、上限（著者の 3 点と外挿）、セルの幅（インライン命令・`@<br>{}`）、`//tsize` 有り無しの見積もり、`charWidth` の上書き | 10 |
| `test/diagnostics.test.js` | 参照切れ・曖昧・無い章、診断の位置、参照されていない表とその on/off、`scope` の切り分け（prose / code / all）、`allowIn`、否定後読み、壊れた正規表現、行長と `codeLineWidth`、表の幅、TODO、id の二重 | 15 |
| `test/misc.test.js` | `catalog.yml`（part の入れ子・コメント）、glob、アウトラインの木と範囲、設定の読み込み（無い・壊れている・知らない項目） | 8 |
| `test/book_mruby3.test.js` | 実物の原稿（隣に無ければ飛ばす） | 3 |

試験用の原稿は `test/fixtures/sample/`。5 章・6 ファイルの小さな本で、わざと参照切れ 3 件、
曖昧な参照 1 件、無い章 1 件、はみ出す表 1 本、長いコード行、規則に当たる語を入れてある。

## `book_mruby3` 全体（2026-09-19 時点）

```
$ node dist/cli.js /home/kishima/book/book_mruby3
workspace: /home/kishima/book/book_mruby3
config:    /home/kishima/book/book_mruby3/.review-assist.json
index:     14 章 / 56 ファイル / 14248 行 / 見出し 576 / ブロック 471 / インライン命令 10301
time:      索引 26.1 ms、診断 19.9 ms

summary:
      7  code-line-length
      2  rule.forbidden-word
      4  rule.fullwidth-digit
      3  todo
     13  unreferenced-table
     29  合計（error 0）
```

* **参照切れ 0 件**（`@<chap>` 277、`@<hd>` 166、`@<table>` 68、`@<list>` 46、`@<img>` 6、
  `@<fn>` 3 = 566 件すべてが解決する）
* 索引は 24〜26 ms（5 回の best 24.0 ms）。計画書の「1 秒以内」に対して 40 分の 1
* `@<hd>` 166 件は全部ラベルでの一致だった。見出しの文字列での一致・道での一致は原稿で
  使われていないので、単体テストで確かめてある

残った warning / info の内訳:

| 種類 | 件数 | 中身 |
|---|---|---|
| `unreferenced-table` | 13 | 付録の opcode 一覧表 5 本と gem の一覧など。本文から指さない表は正当なので、著者が見て `warnUnreferencedTables: false` にするか、表ごとに参照を足すかを決める |
| `code-line-length` | 7 | 81〜83 文字。9pt では 92 文字ほどまで入るので `Overfull hbox` にはならないが、「1 行 80 文字以内」の約束は破っている |
| `rule.fullwidth-digit` | 4 | `opcodes_template.re:58` の「２つ」「１バイト」、`chap3-002-MOVE.re` の「２命令」「１命令」 |
| `rule.forbidden-word` | 2 → 0 | `contents/vm.re:747, 762` の「Rust」。`CLAUDE.md`「ただし本文に Rust / Bevy は書かない」に反していた。**作業中の 2026-09-19 に著者が言い換えて消えた**（`8da1795`「VM 章の Rust の例示 2 か所を言い換え」）。上の集計はその前に取ったもの。今は 27 件 |
| `todo` | 3 | `preface.re` 2 件、`afterword.re` 1 件 |

`table-width` は 0 件。本のリポジトリの `Overfull hbox` 0 という状態と一致する
（係数の話は `../design/thresholds.md`）。

### textlint との一致

本のリポジトリには同じ日に textlint（`prh.yml`）が入った。重なる 2 つの規則
（禁止語、全角数字）について、この拡張が拾った件数は `prh.yml` のコメントが書いている件数と
同じだった（全角数字 4 件、同じ 4 か所／Rust 2 件）。**地の文の切り出しが textlint の
`textlint-plugin-review` と同じ結果になっている**という確認になる。

## 過去のコミットに対する回帰の確認

「一度直した参照切れを戻すと検出されること」を、`git archive` で過去の木をスクラッチパッドに
取り出して確かめた（本のリポジトリには触っていない）。`.re` を触ったコミット 60 本を順に回し、
error が出るものを探した。

| コミット | 検出 | 実際 |
|---|---|---|
| `e374f9e`「JMP 系と例外系を執筆」 | `chapter02.re:552` の `@<hd>{chapter03|chap_ONERR|補足}` が broken-ref | **本当に壊れていた。** 同じコミットで `chap_ONERR` が `chap_EXCEPT` に改名され、参照が取り残された。次の `1305951` で書き換えられている |
| `9619ca4`「改訂版の作業基盤を整備」 | `chapter03.re:260` と `chap3-002-MOVE.re:129` の `@<chap>{chapter06}` が unknown-chapter | **本当に無い。** この時点の `catalog.yml` に `chapter06.re` が入っていない |
| それ以外の 58 本 | 0 件 | — |

最初の実装では `@<hd>{chapter03|chap_LAMBDA|補足}` も broken-ref にしていたが、
Re:VIEW 2.5.0 の `HeadlineIndex.parse` を読むと**これは正しい参照**だった（鍵が
`chap_LAMBDA|補足` になる）。解決の規則を本家に合わせて書き直し、誤検出を消した。
経緯は `../worklog/2026-09-19-v0-stage1-2.md`。

## `.vsix` が作れること

```
$ npm run package
 DONE  Packaged: review-assist-0.1.0.vsix (9 files, 45.54 KB)
```

中身は `dist/cli.js`、`dist/core.js`、`dist/extension.js`、`package.json`、`README.md`、
`CHANGELOG.md`、`LICENSE.txt` だけ（`.vscodeignore` で `src/`、`test/`、`docs/`、
`node_modules/`、ソースマップを外している）。実行時依存は無い。

## 確かめていないこと

* **VS Code の中での動き。** Extension Development Host が使えないので、定義へ移動・ホバー・
  アウトライン・診断の表示は実機で見ていない。`src/extension.ts` の各プロバイダが
  `src/core/` を正しく呼んでいるかは目視のみ
* `@<img>` のホバーの PNG プレビュー。`imagePreview` が指す `images/png/<章>/<id>.png` は
  本のリポジトリにまだ無い（計画書の段階 3 で `tools/drawio2pdf.sh` が出す予定）。
  今は「プレビューはまだありません」と出る経路だけが動く
* Windows と macOS。作ったのは WSL の Linux だけ。パスの扱いは `path.sep` を通しているが
  実機では試していない
* `[column]` の書式。`book_mruby3` に 1 件も無いので、単体テストでしか通していない
* 部（part）を持つ `catalog.yml`。同じく原稿に無いので単体テストだけ
