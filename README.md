# Review Assist

Re:VIEW の原稿を見直すための VS Code 拡張。原稿全体を索引して、**定義へ移動**・**ホバー**・
**アウトライン**・**参照切れと書き方の規則の診断**を出す。

本に固有のもの（禁止語、表記の規則、生成物の章の元ファイル、画像の置き場所）は、ワークスペース
直下の `.review-assist.json` に書く。設定が無ければ Re:VIEW 一般の既定値で動く。

構文の色付けは提供しない（既存の [`atsushieno.language-review`](https://marketplace.visualstudio.com/items?itemName=atsushieno.language-review)
に任せる。言語 ID `review` が同じなので共存する）。日本語の文章の校正も持たない（textlint の役目）。

**Marketplace には出していない。** `.vsix` を作って手で入れる。

## 入れ方

[Releases](https://github.com/kishima/review-assist/releases) から `.vsix` を落として入れる。

```sh
code --install-extension review-assist-0.1.0.vsix
```

自分で作るなら:

```sh
git clone https://github.com/kishima/review-assist.git
cd review-assist
npm install
npm run package          # review-assist-0.1.0.vsix ができる
code --install-extension review-assist-0.1.0.vsix
```

入れ替えるときも同じコマンドでよい（同じ版を上書きするなら `--force` を足す）。外すのは
`code --uninstall-extension kishima.review-assist`。

拡張は `.re` を開いたとき、またはワークスペースに `catalog.yml` があるときに動きだす。
ワークスペースのフォルダ直下とその 1 段下から `catalog.yml` を探し、見つかったディレクトリを
原稿の根とする（本のリポジトリをサブフォルダとして開いていてもよい）。

## できること

| 機能 | 内容 |
|---|---|
| 定義へ移動（F12） | `@<chap>` `@<hd>` `@<list>` `@<table>` `@<img>` `@<fn>` から、その見出し・ブロックへ飛ぶ |
| ホバー | 参照の先の見出しの階層、ブロックのキャプション、ファイルと行。`@<img>` は設定 `imagePreview` の PNG があれば表示する |
| アウトライン | 見出しの階層（既定）。設定 `outline.blocks` に入れた種類の `//list` `//table` `//image` `//footnote`（id を持つものだけ）を見出しの下に足せる |
| 診断 | 下の表 |
| PDF で開く | コマンド「Review Assist: この節を PDF で開く」。カーソルの直近の見出し（無ければ章の先頭）のページを設定 `pageIndex` の索引から引き、設定 `pdf` の PDF を `#page=N` 付きで既定のビューアに渡す |
| コマンド | 「この節を PDF で開く」「ワークスペースを索引し直す」「索引の状態を表示する」（どれも先頭に `Review Assist:`） |

### 診断

| code | 重さ | 何を見るか |
|---|---|---|
| `broken-ref` | error | 参照の先が無い |
| `unknown-chapter` | error | `@<chap>{id}` の章が `catalog.yml` に無い |
| `ambiguous-ref` | error | 同じ名前の見出しが章の中に複数あり、Re:VIEW が曖昧として止める形 |
| `unreferenced-table` | warning | どこからも `@<table>` で参照されていない `//table`（`warnUnreferencedTables`） |
| `duplicate-id` | warning | 章の中でブロックの id か見出しのラベルが二重 |
| `rule.<id>` | 設定 | `.review-assist.json` の `rules` の正規表現 |
| `code-line-length` | warning | コードブロックの行が `maxCodeLineLength` を超える |
| `table-width` | warning | 表の幅の見積もりが列数ごとの上限を超える |
| `todo` | info | `#@#` のコメントの中の `TODO`（`todoComments`） |

### VS Code 無しで全体を見る（CLI）

```sh
node dist/cli.js /path/to/book            # 一覧と集計
node dist/cli.js /path/to/book --quiet    # 集計だけ
node dist/cli.js /path/to/book --only broken-ref,table-width
node dist/cli.js /path/to/book --json
```

error が 1 件でもあれば終了コード 1。CI で原稿を見張るのに使える。

## 設定ファイル `.review-assist.json`

ワークスペース（`catalog.yml` のあるディレクトリ）の直下に置く。全項目に既定値があるので、
必要なものだけ書けばよい。

```json
{
  "contentDir": "contents",
  "chapters": { "opcodes": ["opcodes_template.re", "sub-article/*.re"] },
  "exclude": [],
  "imagePreview": "images/png/{chapter}/{id}.png",
  "pdf": "book.pdf",
  "pageIndex": "book-pages.json",
  "warnUnreferencedTables": true,
  "maxCodeLineLength": 80,
  "codeLineWidth": "chars",
  "todoComments": true,
  "tableWidth": { "enable": true, "limits": { "2": 0.93, "3": 0.90, "4": 0.87 }, "charWidth": 0.011 },
  "rules": [
    {
      "id": "fullwidth-digit",
      "pattern": "[０-９]",
      "message": "全角数字は使わない（半角にする）",
      "severity": "warning",
      "scope": "prose"
    }
  ]
}
```

| 項目 | 既定 | 意味 |
|---|---|---|
| `contentDir` | `"contents"` | `catalog.yml` の項目がファイル名だけのとき、前に付けるディレクトリ |
| `chapters` | `{}` | 章 ID → その章の中身がある**元ファイル**の glob。生成物の章を元ファイルに読み替える。読み替えた章の `catalog.yml` 上のファイルは索引から自動で外れる |
| `exclude` | `[]` | 索引から外す glob |
| `imagePreview` | なし | `@<img>` のホバーに出す PNG のパス。`{chapter}` と `{id}` を置き換える。無ければプレビューを出さない |
| `pdf` | なし | 「この節を PDF で開く」が開く PDF（ワークスペース相対）。無ければコマンドがその旨を言う |
| `pageIndex` | なし | 見出し → ページ番号の索引 JSON（ワークスペース相対）。下記 |
| `warnUnreferencedTables` | `true` | 参照されていない `//table` を warning にする |
| `maxCodeLineLength` | `80` | コードブロック 1 行の上限。0 以下で切れる |
| `codeLineWidth` | `"chars"` | 行長の数え方。`"chars"` は全角も 1 文字、`"halfwidth"` は全角を 2 とする |
| `todoComments` | `true` | `#@#` の中の `TODO` を info で出す |
| `tableWidth.enable` | `true` | 表の幅の見積もりを出す |
| `tableWidth.limits` | 2 列 0.93 / 3 列 0.90 / 4 列 0.87 | 列数ごとの、`P{}` と `l` 列の見積もり幅の和の上限（`\textwidth` 比）。書かれていない列数は `0.96 - 0.015 × 列数` で外挿する |
| `tableWidth.charWidth` | `0.011` | `l` 列の見積もり: 半角 1 文字あたりの `\textwidth` 比 |
| `outline.blocks` | `[]` | アウトラインで見出しの下に出すブロックの種類。`"table"` `"list"` `"image"` `"footnote"` から選ぶ。既定は空＝見出しだけ。下記 |
| `rules` | `[]` | 下記 |

### `outline.blocks`

既定のアウトラインは**見出しだけ**である。原稿は見出しよりブロックの方が多いことが普通で
（`book_mruby3` の `contents/vm.re` は見出し 66 に対して id 付きのブロック 52、あわせて 118 項目）、全部を出すと
木というより一覧に見えてしまう。表や図を追いたいときだけ種類を足す。

```json
{ "outline": { "blocks": ["table", "image"] } }
```

`"table"`（`//table` `//imgtable`）・`"list"`（`//list` `//source`）・`"image"`（`//image`
`//indepimage`）・`"footnote"`（`//footnote`）の 4 つ。知らない語は黙って落ちる。
id を持たないブロック（`//emlist` `//cmd`）は種類を足しても出ない。

### `rules` の 1 件

| 項目 | 既定 | 意味 |
|---|---|---|
| `pattern` | 必須 | JavaScript の正規表現（文字列）。`g` は自動で付く |
| `flags` | `""` | 正規表現のフラグ |
| `message` | 必須 | 診断に出す文 |
| `severity` | `"warning"` | `error` / `warning` / `info` / `hint` |
| `scope` | `"prose"` | `prose` = 地の文・見出し・ブロックのキャプション、`code` = `//list` `//emlist` `//cmd` の本文、`all` = `#@#` 以外の全部 |
| `allowIn` | なし | この glob に当たるファイルでは当てない |
| `id` | 連番 | 診断の code が `rule.<id>` になる |

誤検出は、否定先読み・後読みか `allowIn` で外す。たとえば地の文の `OP_` を拾いつつ
`@<code>{OP_SEND}` は見逃す書き方:

```json
{ "id": "op-prefix", "pattern": "(?<!@<code>\\{[^}]*)\\bOP_[A-Z]", "message": "地の文では OP_ を付けない" }
```

`tableWidth.limits` と `charWidth` の既定は、`book_mruby3` の `CLAUDE.md`「紙面幅の制約」から
取っている。本文の大きさ（`texdocumentclass` の pt と本文幅の zw）を変えたら `charWidth` を
測り直すこと。

### PDF のページの索引（`pageIndex`）

この拡張は **PDF を解析しない**。`pageIndex` が指す JSON を読むだけで、その JSON は本の側で作る。

```json
{
  "vm": 35,
  "vm|命令ループ": 45,
  "vm|命令ループ|ディスパッチ": 47,
  "opcodes|chap_JMP": 242
}
```

鍵は Re:VIEW の headline index と同じ作り方（`docs/design/review-syntax.md`）。

* 章そのもの（`=` の見出し）は **章 ID だけ**
* それ以外は `章ID|見出しの鍵`。見出しの鍵は `==` を 0 段目として「ラベルがあればラベル、
  無ければ見出しの文字列」を `|` でつないだもの

値は 1 起点のページ番号（PDF ビューアの `#page=` と同じ）。カーソルの直近の見出しの鍵が
索引に無ければ、**上の段、最後は章の先頭**へ落として開く。

作り方の実例は `book_mruby3` の `tools/pdf_pages.py`（pypdf で各ページのテキストを抜き、
原稿の見出しを本の順に探す。`tools/build_pdf.sh` が PDF を作ったあとに呼ぶ）。抽出テキストは
原稿の文字列とそのままでは一致しない（空白、部首で出る漢字、差し替わる記号、折り返し）ので、
何が要るかは [worklog](docs/worklog/2026-09-19-v0-stage3-4.md) に書いてある。

## 分かっていない・やらないこと

* **VS Code の実機での確認が限られている。** Extension Development Host が使えない環境で
  作ったので、確かめてあるのは `src/core/`（VS Code に依存しない層）だけである。定義へ移動・
  ホバー・アウトライン・診断の表示と、`file:///…#page=N` が実際にそのページで開くかは、
  実機で見ていない（`docs/verification/`）。`src/extension.ts` は `core` の結果を VS Code の
  型に写すだけにしてある
* 作ったのは WSL の Linux だけ。Windows と macOS では試していない
* インライン命令は `@<op>{...}` の形だけを見る。`@<op>$...$` と `@<op>|...|` は見ない
* 行をまたぐインライン命令は拾わない
* `//table` のセルの幅は文字数からの見積もりなので、実際に組んだ幅とは違う。最後は
  `Overfull hbox` の有無で確かめる
* `@<column>` `@<bib>` `@<icon>` `@<eq>` はまだ参照として扱っていない
* 構文の色付け、スニペット、Re:VIEW のビルド、日本語の校正、PDF の解析は持たない

## 開発

```sh
npm install
npm run typecheck   # tsc --noEmit
npm test            # esbuild してから node:test
npm run build       # dist/extension.js、dist/cli.js、dist/core.js
npm run watch
npm run package     # .vsix
```

push と PR で `npm ci` / `npm test` / `npm run build` / `npm run package` が
GitHub Actions で回る（`.github/workflows/ci.yml`）。`.vsix` は artifact に付く。
タグ `v*` を push すると Release ができて `.vsix` が付く。

判断はすべて `src/core/`（VS Code に依存しない層）にあり、`src/extension.ts` は VS Code の型に
写すだけにしてある。テストは `src/core/` に対して書く。設計は [`docs/`](docs/README.md)。

## ライセンス

MIT（[LICENSE](LICENSE)）。
