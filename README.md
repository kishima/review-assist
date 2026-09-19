# Review Assist

Re:VIEW の原稿を見直すための VS Code 拡張。原稿全体を索引して、**定義へ移動**・**ホバー**・
**アウトライン**・**参照切れと書き方の規則の診断**を出す。

本に固有のもの（禁止語、表記の規則、生成物の章の元ファイル、画像の置き場所）は、ワークスペース
直下の `.review-assist.json` に書く。設定が無ければ Re:VIEW 一般の既定値で動く。

構文の色付けは提供しない（既存の [`atsushieno.language-review`](https://marketplace.visualstudio.com/items?itemName=atsushieno.language-review)
に任せる。言語 ID `review` が同じなので共存する）。日本語の文章の校正も持たない（textlint の役目）。

**Marketplace には出していない。** `.vsix` を作って手で入れる。

## 入れ方

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
| アウトライン | 見出しの階層と、その下の `//list` `//table` `//image` `//footnote`（id を持つものだけ） |
| 診断 | 下の表 |
| コマンド | 「Review Assist: ワークスペースを索引し直す」「Review Assist: 索引の状態を表示する」 |

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
| `warnUnreferencedTables` | `true` | 参照されていない `//table` を warning にする |
| `maxCodeLineLength` | `80` | コードブロック 1 行の上限。0 以下で切れる |
| `codeLineWidth` | `"chars"` | 行長の数え方。`"chars"` は全角も 1 文字、`"halfwidth"` は全角を 2 とする |
| `todoComments` | `true` | `#@#` の中の `TODO` を info で出す |
| `tableWidth.enable` | `true` | 表の幅の見積もりを出す |
| `tableWidth.limits` | 2 列 0.93 / 3 列 0.90 / 4 列 0.87 | 列数ごとの、`P{}` と `l` 列の見積もり幅の和の上限（`\textwidth` 比）。書かれていない列数は `0.96 - 0.015 × 列数` で外挿する |
| `tableWidth.charWidth` | `0.011` | `l` 列の見積もり: 半角 1 文字あたりの `\textwidth` 比 |
| `rules` | `[]` | 下記 |

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

## 分かっていない・やらないこと

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
npm run compile     # dist/extension.js、dist/cli.js、dist/core.js
npm run watch
```

判断はすべて `src/core/`（VS Code に依存しない層）にあり、`src/extension.ts` は VS Code の型に
写すだけにしてある。テストは `src/core/` に対して書く。設計は [`docs/`](docs/README.md)。

## ライセンス

MIT（[LICENSE](LICENSE)）。
