# 段階 3・4 の確認（2026-09-19）

段階 1・2 と同じく、**確かめたのは `src/core/`（VS Code に依存しない層）と、本側のスクリプトの
出力だけ**である。VS Code の中での動きは実機で見ていない（下の「確かめていないこと」）。

## 単体テスト

```
$ npm test
# tests 78
# pass 78
# fail 0
# skipped 0
```

段階 1・2 の 67 件に 11 件足した。

| ファイル | 何を確かめるか | 件数 |
|---|---|---|
| `test/pdfpages.test.js` | 設定 `pdf` / `pageIndex` の読み込み、索引 JSON の読み込み（無い・壊れている・数でない値）、直近の見出し、鍵の組み立て（章の題は章 ID だけ、ラベルがあればラベル、読み替えた章）、上の段と章の先頭への落とし方、章に属さないファイル | 9 |
| `test/book_mruby3.test.js`（追加分） | 実物の原稿で、図の PNG が全部解決すること、見出しが全部ページを引けること | 2 |

試験用の索引は `test/fixtures/sample/pages.json`。わざと `first|導入|チャート` と
`after` を**入れていない**ので、上の段へ落ちる経路と「索引に無い」経路が通る。

## 見出し → ページ（`book_mruby3` の実物）

```
$ python3 tools/pdf_pages.py --report
pdf_pages: book_mruby3-pages.json に 576 件（見出し 576 のうち 行 566、折り返し 10、見つからず 0）
```

**見出し 576 のうち 576 件**でページが取れた。所要 5.6 秒（361 ページ、2.9 MB の PDF）。
うち 566 件は「正規化した行が見出しで終わる」で、10 件は「ページ内の行をつないだ文字列に含まれる」
で当たった。後者は組版で 2 行に折り返された見出しで、内訳は参考文献の `@<br>{}` 入りの書名 9 件と、
第 9 章の題「mruby Operation Code Reference」。

### 取れなかった件数の推移

つぶした順（詳しくは `../worklog/2026-09-19-v0-stage3-4.md`）。

| 対処 | 取れた件数 |
|---|---|
| 空白を落として、行が見出しで終わるものを探す | 549 / 576 |
| CJK 部首補助 U+2ED1（⻑）と U+2ED8（⻘）を漢字に直す | 573 / 576 |
| `@<chap>` を `.+?`、記号を任意の 1 字にする。折り返しはページ内の行をつないで探す | **576 / 576** |

1 段目で残った 27 件の内訳は次のとおり（数えたもの）。

| 何が起きていたか | 件数 |
|---|---|
| 付録 A の「レジスタとフレーム（@<chap>{vm}）」型。`@<chap>` は "第3 章" に組版される | 9 |
| `／` が `∕`（U+2215）、`〜` が別の記号で出る（付録 A に 5、`codegen` に 1） | 6 |
| 参考文献の `@<br>{}` 入りの長い見出し。組版で 2 行に分かれる（うち 3 件は `・`→`‧` と `⻘` も絡む） | 9 |
| `⻑`（U+2ED1）が直らない（「長い配列リテラル」「長いハッシュリテラル」） | 2 |
| 第 9 章の題が 2 行に分かれる | 1 |

しおりの 141 件（章 14 + `==` 127）に対して、原稿の見出しは 576 件（`=` 14 / `==` 127 /
`===` 347 / `====` 88）。**435 件が `===` 以深**で、しおりには入らない。

### 正しさの裏取り: PDF のしおりと突き合わせ

「見つかった」と「正しいページ」は別なので、PDF 自身が持っているしおり（`pypdf` の
`reader.outline`、141 件）と突き合わせた。しおりは章と `==` の節まで（`===` 以下は
`tocdepth` の外）で、`get_destination_page_number` が飛び先のページを持っている。

本の順に並べて対応を取った結果は **132 件が一致、食い違い 0 件**。
残り 9 件は、しおりの文字列が組版後（"A.2 レジスタとフレーム（第3 章）"）で、この突き合わせ方では
対応が取れなかったもの。索引としてはページが取れている。

しおりをそのまま索引に使う案は採らなかった。**141 件しか無く、`===` 以下の見出しが入らない**
（上の表のとおり 435 件が入らない）。

### 鍵が両側で食い違っていないこと

`tools/pdf_pages.py`（Python）と `src/core/parser.ts`（TypeScript）が、同じ規則で同じ鍵を
作れていなければ索引は引けない。`test/book_mruby3.test.js` で、**原稿の見出し 576 件すべてに
ついて、その行から `lookupPage` を呼んで**確かめている。

* ページが取れなかった見出し: 0 件
* 上の段や章の先頭に落ちた見出し: 0 件（全部が見出しそのもので当たった）

後者が 0 であることが、両側の鍵の作り方が一致している証拠になる。

## 図の PNG

```
$ tools/drawio2pdf.sh
png: 57 枚を images/png/ に描いた   （14.8 秒）
```

`images/*/*.pdf` の 57 枚すべてを `images/png/<章>/<図名>.png` にした。
`test/book_mruby3.test.js` で、原稿の `//image` / `//indepimage` / `//imgtable` のうち id を
持つ **39 件すべてについて、`imagePreview`（`images/png/{chapter}/{id}.png`）が実在する**ことを
確かめている（段階 1・2 では「プレビューはまだありません」の経路しか動いていなかった）。

drawio の PNG 書き出しと比べた数字は worklog にある（gs: 57 枚 14.8 秒 / drawio: 1 枚 2.3 秒で
39 枚まで）。

## PDF のビルドを通す

```
$ tools/build_pdf.sh
OK: 2895957 bytes written
Overfull hbox: 0
pdf_pages: book_mruby3-pages.json に 576 件（見出し 576 のうち 行 566、折り返し 10、見つからず 0）
```

約 4 分。`.re` に差分は出ていない（`tools/pdf_pages.py` は読むだけ）。

## `book_mruby3` 全体（2026-09-19 段階 3 のあと）

```
$ node dist/cli.js /home/kishima/book/book_mruby3 --quiet
index:     14 章 / 56 ファイル / 14264 行 / 見出し 576 / ブロック 471 / インライン命令 10329
time:      索引 25.8 ms、診断 20.4 ms

summary:
      7  code-line-length
      3  todo
      8  unreferenced-table
     18  合計（error 0）
```

**error 0 のまま。** 段階 1・2 の 29 件から 18 件に減っているのは、著者がこの日に
参照されていなかった表 5 本に `@<table>` を足し、全角数字と禁止語の規則を textlint（`prh.yml`）に
寄せたため。拡張側の判断は変えていない。

## `.vsix` が作れること

```
$ npm run package
 DONE  Packaged: review-assist-0.1.0.vsix (9 files, 49.19 KB)
```

中身は段階 1・2 と同じ 9 つ（`dist/*.js` 3 本、`package.json`、`README.md`、`CHANGELOG.md`、
`LICENSE.txt` とマニフェスト 2 つ）。段階 4 で足した `.github/` は `.vscodeignore` で外した
（外す前は 10 ファイルになっていた）。実行時依存は無い。

## GitHub Actions

`main` に push して実際に回した（run 35413433025、所要 1 分弱）。

```
Set up job: success
Run actions/checkout@v4: success
Run actions/setup-node@v4: success
Run npm ci: success
Run npm test: success                      # tests 78 / pass 73 / fail 0 / skipped 5
Run npm run build: success
Run npm run package: success               # Packaged: review-assist-0.1.0.vsix (9 files, 49.19 KB)
Run actions/upload-artifact@v4: success
Release に .vsix を付ける: skipped          # タグではないので飛ぶ
```

`skipped 5` は実物の原稿に対するテスト（`test/book_mruby3.test.js`）で、runner には
原稿が無いので飛ぶ。狙いどおり。

`npm ci` が `@azure/*`（`vsce` の依存の依存）について `EBADENGINE`（node >= 22 を要求）を
warn で出すが、失敗はしない。runner を 22 に上げれば消えるが、VS Code 1.85 が Node 18 なので
今は 20 のままにしてある。

Release の段（`gh release create`）は**タグを push しないと通らないので未確認**。
`if: startsWith(github.ref, 'refs/tags/v')` が効いて飛んだことだけ確かめた。

## 確かめていないこと

* **VS Code の中での動き。** 段階 1・2 から変わらず、Extension Development Host が使えない。
  コマンド「この節を PDF で開く」が実際にビューアを開くかは見ていない
* **`#page=N` でそのページが開くか。** `vscode.env.openExternal` は URI を OS の既定のアプリに
  渡すだけで、`#page=` を読むかどうかはビューア側の約束である（Adobe の open parameters。
  Chrome / Edge / Firefox / Preview は読む。Linux の evince は読まないという報告がある）。
  実機で駄目なら「ビューアのコマンドを設定で指定する」形に変える余地がある
* **CI の実走。** 上のとおり
* Windows と macOS。作ったのは WSL の Linux だけ
* 入稿用 PDF（`--print`）に対する索引。白ページが入ってページがずれるので作っていない
