# Review Assist

Re:VIEW の原稿を見直すための VS Code 拡張。原稿全体を索引して、**定義へ移動**・**ホバー**・
**アウトライン**・**参照切れと書き方の規則の診断**を出す。0.2.0 から、原稿に**マーカー**
（「AI にダブルチェックしてほしい」「後で読む」）を付けて、**まとめて AI に確かめてもらう**仕組みを持つ（下記）。

本に固有のもの（禁止語、表記の規則、生成物の章の元ファイル、画像の置き場所）は、ワークスペース
直下の `.review-assist.json` に書く。設定が無ければ Re:VIEW 一般の既定値で動く。

0.1.2 から**構文の色付け**も持つ（下記。[`atsushieno.language-review`](https://marketplace.visualstudio.com/items?itemName=atsushieno.language-review)
とは同時に使えないので、そちらは無効にする）。日本語の文章の校正は持たない（textlint の役目）。

**Marketplace には出していない。** `.vsix` を作って手で入れる。

## 入れ方

[Releases](https://github.com/kishima/review-assist/releases) から `.vsix` を落として入れる。

```sh
code --install-extension review-assist-0.2.0.vsix
```

自分で作るなら:

```sh
git clone https://github.com/kishima/review-assist.git
cd review-assist
npm install
npm run package          # review-assist-0.2.0.vsix ができる
code --install-extension review-assist-0.2.0.vsix
```

入れ替えるときも同じコマンドでよい（同じ版を上書きするなら `--force` を足す）。外すのは
`code --uninstall-extension kishima.review-assist`。

拡張は `.re` を開いたとき、またはワークスペースに `catalog.yml` があるときに動きだす。
ワークスペースのフォルダ直下とその 1 段下から `catalog.yml` を探し、見つかったディレクトリを
原稿の根とする（本のリポジトリをサブフォルダとして開いていてもよい）。

## できること

| 機能 | 内容 |
|---|---|
| 構文の色付け | 見出し・`#@#` のコメント・ブロック命令とその引数・インライン命令（種類ごとに色を分ける）・箇条書き・`//table` の区切り行。下記 |
| 定義へ移動（F12） | `@<chap>` `@<hd>` `@<list>` `@<table>` `@<img>` `@<fn>` から、その見出し・ブロックへ飛ぶ |
| ホバー | 参照の先の見出しの階層、ブロックのキャプション、ファイルと行。`@<img>` は設定 `imagePreview` の PNG があれば表示する |
| アウトライン | 見出しの階層（既定）。設定 `outline.blocks` に入れた種類の `//list` `//table` `//image` `//footnote`（id を持つものだけ）を見出しの下に足せる |
| 診断 | 下の表 |
| PDF で開く | コマンド「Review Assist: この節を PDF で開く」。カーソルの直近の見出し（無ければ章の先頭）のページを設定 `pageIndex` の索引から引き、設定 `pdf` の PDF を `#page=N` 付きで既定のビューアに渡す |
| マーカー | 範囲に印を付け、サイドバーの「マーカー」ビューで一覧。AI チェックの依頼を書き出し、結果をホバーとビューで読む。下記 |
| コマンド | 「この節を PDF で開く」「ワークスペースを索引し直す」「索引の状態を表示する」とマーカーのコマンド（どれも先頭に `Review Assist:`） |

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

### 構文の色付け

`.re` を TextMate 文法（`syntaxes/review.tmLanguage.json`、scopeName `source.review`）で色付けする。
見出しは深さごと（`markup.heading.1.review` 〜 `.6.review`）、インライン命令は
**参照・太字・斜体・コード・索引・その他**の 6 種に分けてあるので、テーマや
`editor.tokenColorCustomizations` で区別できる。選んだ scope 名とその理由は
[`docs/design/syntax-highlight.md`](docs/design/syntax-highlight.md)。

コード系のブロック（`//list` `//emlist` `//emlistnum` `//listnum` `//cmd` `//source` `//terminal`）の
**中身ではインライン命令を色付けしない**（コードとして読めることを優先した）。`//note` `//quote`
`//table` `//footnote` の中身は地の文と同じ規則で色付けする。

#### `atsushieno.language-review` を無効にする

同じ言語 ID `review` に 2 つの拡張が文法を寄付すると、VS Code はどちらか一方しか使わない。
どちらが勝つかは決まっていないので、両方を入れたままにはしないこと。

加えて、`atsushieno.language-review` は `.re` と**同じディレクトリ**の `catalog.yml` しか見ない
（`out/src/preview.js:143` の `path.resolve(docDirName, "catalog.yml")`）。原稿を
`contents/*.re`、`catalog.yml` を根に置く構成だと `catalog.yml` が見つからず、他章への参照
すべてに「参照先 chapter の overview が見つかりません。」というエラーが出る。この診断だけを
止める設定は無い。

ワークスペースだけで無効にする手順:

1. 拡張ビュー（`Ctrl+Shift+X`）で `language-review` を探す
2. 歯車 → **「このワークスペースで無効にする」**（Disable (Workspace)）
3. 「再読み込み」を押す

本のリポジトリ側で勧めないようにしておくこともできる（`.vscode/extensions.json`）。

```json
{
  "recommendations": ["kishima.review-assist"],
  "unwantedRecommendations": ["atsushieno.language-review"]
}
```

`unwantedRecommendations` は**勧めるのをやめるだけ**で、すでに入っている拡張は無効にならない。
無効にするのは上の 1〜3 が要る。

### マーカー

原稿の範囲に印を付けておき、後でまとめて見る・AI に頼むための仕組み。**原稿（`.re`）には何も書かない。**
印はワークスペースの `.review-assist/marks.json` に、選んだ文字列と前後の文脈ごと保存し、原稿が直されたら
文字列で位置を探し直す（行がずれても、段落を移しても追いつく。選んだ文そのものが書き直されると
「位置を見失った」になるが、消えはしない）。`.review-assist/` は個人の作業の印なので、本のリポジトリの
`.gitignore` に入れておくのがよい。

種類は既定で 2 つ（設定 `marks.kinds` で変えられる）。

| 種類（`id`） | 表示名 | 使い方 |
|---|---|---|
| `ai-check` | AI チェック | AI にダブルチェックしてほしい所。依頼の書き出しに入る |
| `read-later` | 後で読む | 自分で後で読み直す所 |

| 操作 | どうやるか |
|---|---|
| 付ける | 範囲を選んで、右クリック「Review Assist: マーカーを付ける: AI チェック」「…: 後で読む」（コマンドパレットからも）。メモを 1 行聞かれる（空のまま Enter でよい。Esc でやめる） |
| 見る | 範囲に背景色、行の横に丸い印、スクロールバーに印。ホバーでメモと AI の結果。エクスプローラーの「マーカー」ビューに「種類 → 章 → 項目」。クリックで飛ぶ |
| 絞る | ビューの上の漏斗のボタン。未済だけ（既定）／済みだけ／全部 |
| 済みにする・メモ・外す | ビューの項目の右のボタンか右クリック、またはホバーのリンク。コマンドパレットから実行するとカーソルの上のマーカーが対象 |
| AI に頼む | ビューの上の書き出しボタン（コマンド「AI チェックの依頼を書き出す」）。未済の `ai-check` が `.review-assist/ai-check.md` に書かれる。Claude Code に「AI チェックして」と言う |
| AI の結果を読む | AI が `.review-assist/ai-results.json` を書くと、ホバーとビューに `OK`／`要修正`／`要確認` と理由が出る |
| 案を当てる | 結果に置き換え案があれば、ホバーの「案を当てる」かビューの電球のボタン。選んだ範囲が案に置き換わる。**自動で済みにはしない**ので、読み直してから済みにする。AI が見た後で原稿が直されていたら、当てる前に確かめる |

済みにしたマーカーは背景色を外し、点線の下線だけ残す（ホバーで結果を読み返せる）。

#### AI との受け渡し

拡張は AI を呼ばない（API キーやネットワークを持たない）。`ai-check.md` を書き出し、`ai-results.json` を
読むだけ。AI が何を確かめ、結果をどう書くかの手順は**本の側の文書**に書き、設定 `marks.aiProcedure` で
指す（依頼ファイルの先頭からそこを指す）。`book_mruby3` では `docs/notes/review-assist-ai-check.md`。

`ai-results.json` の形:

```json
{
  "version": 1,
  "results": [
    { "id": "mmvc86l7s", "quote": "依頼ファイルの選んだ文の写し", "verdict": "fix",
      "comment": "理由と根拠", "suggestion": "置き換え案（任意）" }
  ]
}
```

`verdict` は `ok`／`fix`／`question`。`quote` は依頼ファイルの雛形のまま写してもらう（今の原稿と違えば
「AI が見た後で文が変わっている」と出す）。壊れた JSON や知らない id は出力「Review Assist」に書かれる。

#### キーバインドの例

既定のキーは持たない。使うなら `keybindings.json`（コマンドパレット「基本設定: キーボード ショートカットを開く (JSON)」）に:

```json
[
  { "key": "ctrl+alt+m", "command": "reviewAssist.addMarkAiCheck", "when": "editorLangId == review && editorHasSelection" },
  { "key": "ctrl+alt+l", "command": "reviewAssist.addMarkReadLater", "when": "editorLangId == review && editorHasSelection" },
  { "key": "ctrl+alt+d", "command": "reviewAssist.toggleMarkDone", "when": "editorLangId == review" }
]
```

自分で足した種類は `{ "command": "reviewAssist.addMark", "args": { "kind": "<id>" } }` で付けられる
（`args` が無ければ種類を選ぶ一覧が出る）。

#### VS Code 無しで

```sh
node dist/cli.js marks /path/to/book            # マーカーの一覧（今の位置、見失ったか、AI の結果）
node dist/cli.js marks /path/to/book --request  # AI チェックの依頼を書き出す
```

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
| `marks.kinds` | `ai-check`（AI チェック）と `read-later`（後で読む） | マーカーの種類。1 件は `{"id", "label", "color", "background"}`。書くと既定と入れ替わる。色を省くと同じ id の既定の色（無ければ `ai-check` の色） |
| `marks.aiProcedure` | なし | AI が読む手順の文書（ワークスペース相対）。依頼ファイルの先頭から指す |
| `marks.aiKind` | `"ai-check"` | 依頼に書き出す種類 |
| `marks.contextLength` | `32` | マーカーと一緒に保存する前後の文脈の長さ（文字数）。`book_mruby3` の過去の修正に当てて測った値（`docs/design/thresholds.md`） |
| `marks.contextParagraphs` | `1` | 依頼に、選んだ所を含む段落の前後から何段落ずつ添えるか |
| `marks.dir` | `".review-assist"` | マーカーと受け渡しのファイルを置くディレクトリ |
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

## 確かめ方（0.2.0 のマーカー。著者の実機で）

作った環境では VS Code を動かせないので、次は**まだ誰も目で見ていない**。順にやって、違ったら教えてください。

1. `code --install-extension review-assist-0.2.0.vsix --force` で入れ直し、`book_mruby3` を開く。
   エクスプローラーに「マーカー」ビューが出る（中身は空）
2. `contents/vm.re` で 1 文を選び、右クリック →「Review Assist: マーカーを付ける: AI チェック」。メモを入れて Enter
   * 選んだ所が薄い緑の背景になり、行の横に緑の丸、スクロールバーの右に印が出る
   * `book_mruby3/.review-assist/marks.json` ができている
   * ビューに「AI チェック → vm → 選んだ文」が出る。クリックするとそこへ飛んで選ばれる
3. 別の所に「後で読む」を付ける。青になり、ビューに「後で読む」の組ができる
4. マーカーの上にマウスを置く。種類、未済、メモ、「済みにする · メモ · 外す」のリンクが出る。リンクが押せる
5. マーカーより**前**に行を足す・段落を足す。印が文についていく。保存して `marks.json` の `line` が変わる
6. マーカーを付けた文の**中**を少し直す。印が直した文についていく（前後が変わっていなければ）
7. マーカーを付けた文を前後ごと消して保存。ビューの項目に警告の印と「位置を見失った」が出る。消えない。
   クリックすると付けたときの行を開いて、見失った旨が出る。`Ctrl+Z` で戻すと印も戻る
8. ビューの上の書き出しボタン → `.review-assist/ai-check.md` が開き、未済の AI チェックだけが入っている
9. Claude Code に「AI チェックして」と頼む（または手で `ai-results.json` を書く）。書かれたらすぐ、
   ホバーに `AI: OK／要修正／要確認` と理由、ビューの項目に `AI …` が出る
10. 置き換え案のある結果で、ホバーの「案を当てる」かビューの電球。文が置き換わり、印は新しい文につく。済みにはならない
11. 済みにする → 背景が消えて点線の下線になる。ビューは既定で未済だけなので消える。漏斗のボタンで「全部」にすると戻る
12. ダークテーマとライトテーマの両方で、背景色の上の文字が読めるか

## 分かっていない・やらないこと

* **VS Code の実機での確認が限られている。** Extension Development Host が使えない環境で
  作ったので、確かめてあるのは `src/core/`（VS Code に依存しない層）だけである。定義へ移動・
  ホバー・アウトライン・診断の表示と、`file:///…#page=N` が実際にそのページで開くかは、
  実機で見ていない（`docs/verification/`）。`src/extension.ts` は `core` の結果を VS Code の
  型に写すだけにしてある
* 作ったのは WSL の Linux だけ。Windows と macOS では試していない
* **索引と参照**が見るインライン命令は `@<op>{...}` の形だけ。`@<op>$...$` と `@<op>|...|` は
  色は付くが、定義へ移動・ホバー・診断の対象にならない（`book_mruby3` に 0 件）
* 行をまたぐインライン命令は拾わない
* `//table` のセルの幅は文字数からの見積もりなので、実際に組んだ幅とは違う。最後は
  `Overfull hbox` の有無で確かめる
* `@<column>` `@<bib>` `@<icon>` `@<eq>` はまだ参照として扱っていない
* 構文の色付けは**実機で目で見ていない**。VS Code 本体と同じエンジン（`vscode-textmate`）で
  原稿をトークン化し、scope の付かない `@<` と `//` が 0 件であることまでは機械で確かめてある
  （`test/grammar.test.js`）
* スニペット、Re:VIEW のビルド、日本語の校正、PDF の解析は持たない
* **マーカーの表示とコマンドは実機で見ていない**（上の「確かめ方」）。位置の探し直し・依頼・結果の読み込みは
  `src/core/marks.ts` の単体テストと、`book_mruby3` の過去の修正 93 コミットに当てた測定で確かめてある
  （`docs/verification/marks.md`）
* マーカーの位置は文字列で探すので、**同じ文字列が何度も出る短い行**（sub-article の `** Opr: @<code>{B: a(B)}` など）に
  付けると、周りも似ていれば別の行に移ることがある（測定で 7 万文中 7 件）。長めに選ぶと起きにくい
* マーカーは CRLF と LF が混ざる環境（Windows で改行を変換する設定）では試していない

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
