# Review Assist

Re:VIEW の原稿を見直すための VS Code 拡張。原稿全体を索引して、**定義へ移動**・**ホバー**・
**アウトライン**・**参照切れと書き方の規則の診断**を出す。0.2.0 から、原稿に**マーカー**
（「AI にダブルチェックしてほしい」「後で読む」）を付けて、**まとめて AI に確かめてもらう**仕組みを持つ（下記）。
0.3.0 から、**記法を畳む編集画面**（カーソルの近くだけ Re:VIEW の記法を見せる、紙面に近い見た目の画面）を持つ（下記）。

本に固有のもの（禁止語、表記の規則、生成物の章の元ファイル、画像の置き場所）は、ワークスペース
直下の `.review-assist.json` に書く。設定が無ければ Re:VIEW 一般の既定値で動く。

0.1.2 から**構文の色付け**も持つ（下記。[`atsushieno.language-review`](https://marketplace.visualstudio.com/items?itemName=atsushieno.language-review)
とは同時に使えないので、そちらは無効にする）。日本語の文章の校正は持たない（textlint の役目）。

**Marketplace には出していない。** `.vsix` を作って手で入れる。

## 入れ方

[Releases](https://github.com/kishima/review-assist/releases) から `.vsix` を落として入れる。

```sh
code --install-extension review-assist-0.3.0.vsix
```

自分で作るなら:

```sh
git clone https://github.com/kishima/review-assist.git
cd review-assist
npm install
npm run package          # review-assist-0.3.0.vsix ができる
code --install-extension review-assist-0.3.0.vsix
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
| PDF で開く | コマンド「Review Assist: この節を PDF で開く（横に）」。カーソルの直近の見出し（無ければ章の先頭）のページを設定 `pageIndex` の索引から引き、設定 `pdf` の PDF を **VS Code の中の PDF の画面**（pdf.js）で原稿の横に開いてそのページへ飛ぶ（0.3.0 から。WSL・SSH のリモートの窓でも開ける。もう一度実行するとその節のページへ飛ぶだけ）。0.2.0 までの、`#page=N` 付きで既定のビューアに渡す動きは「この節を PDF で開く（外のビューアで）」（リモートの窓では開けないことがある） |
| マーカー | 範囲に印を付け、サイドバーの「マーカー」ビューで一覧。AI チェックの依頼を書き出し、結果をホバーとビューで読む。下記 |
| 記法を畳む編集画面（0.3.0） | `.re` を、記法の印を隠して見た目で表す画面で開く。カーソルを入れた所だけ記法が出る。保存されるのは手で書いたのと同じ `.re`。下記 |
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

#### 和文の文字の警告を出さない（0.3.0）

VS Code は、ASCII でない文字が多い文書に「This document contains many non-basic ASCII unicode characters」の帯を出し、
全角の記号など紛らわしい文字・見えない文字に枠を付ける。日本語の原稿ではほぼ全部の行が当たるので、`.re`（言語 `review`）では
既定で切ってある（`contributes.configurationDefaults` の `[review]` に `editor.unicodeHighlight.nonBasicASCII`・
`ambiguousCharacters`・`invisibleCharacters` を `false`）。戻すなら設定で `"[review]": { "editor.unicodeHighlight.ambiguousCharacters": true }` などと書く。

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

記法を畳む編集画面（0.3.0）の中で使うなら、`when` を `activeCustomEditorId == 'reviewAssist.editor'` にする
（編集画面が前にあるときは `editorLangId` も `editorHasSelection` も立たない）。

```json
[
  { "key": "ctrl+alt+m", "command": "reviewAssist.addMarkAiCheck", "when": "activeCustomEditorId == 'reviewAssist.editor'" },
  { "key": "ctrl+alt+c", "command": "reviewAssist.wrapCode", "when": "editorLangId == review || activeCustomEditorId == 'reviewAssist.editor'" },
  { "key": "ctrl+alt+b", "command": "reviewAssist.wrapBold", "when": "editorLangId == review || activeCustomEditorId == 'reviewAssist.editor'" },
  { "key": "ctrl+alt+i", "command": "reviewAssist.insertBlock", "when": "editorLangId == review || activeCustomEditorId == 'reviewAssist.editor'" },
  { "key": "ctrl+alt+e", "command": "reviewAssist.toggleEditor", "when": "resourceExtname == .re || activeCustomEditorId == 'reviewAssist.editor'" }
]
```

`{ "command": "reviewAssist.wrapInline", "args": { "op": "tt" } }` のように `args` で命令を決めておくこともできる。

#### VS Code 無しで

```sh
node dist/cli.js marks /path/to/book            # マーカーの一覧（今の位置、見失ったか、AI の結果）
node dist/cli.js marks /path/to/book --request  # AI チェックの依頼を書き出す
```

### 記法を畳む編集画面（0.3.0）

`@<code>{…}` や `//list[…]{` が混じった文を読み書きしやすくするための、もう 1 つの編集画面。
**原稿は `.re` の文字列のまま**で、記法を「見せ方」で畳むだけ（Markdown などへの変換はしない）。
保存されるものは普通のエディタで書いたのと 1 文字も違わない。紙面と同じ見た目は目指していない
（紙面の確かめは「この節を PDF で開く」）。

| 操作 | どうやるか |
|---|---|
| 開く | `.re` を開いた状態で、エディタの右上のボタン（またはコマンド「Review Assist: 記法を畳む編集画面 ⇔ 普通のエディタ」）。エクスプローラーの右クリック「ファイルを開くアプリケーションの選択…」→「Review Assist（記法を畳む）」でもよい。既定のエディタは変えない |
| 戻る | 同じボタンかコマンド。開いていた方のタブは閉じる |
| 保存・取り消し・やり直し | VS Code のもの（`Ctrl+S`、`Ctrl+Z`、`Ctrl+Y`）。未保存の印も普通のエディタと同じ。同じファイルを普通のエディタと並べて開いてもよい（どちらで打っても両方に出る） |
| 検索 | `Ctrl+F`（編集画面の中の検索） |
| 記法を見る・直す | カーソルをその記法に入れる（隣に置くだけでもよい）と、その記法だけ元の書き方に戻る。行の記法（見出し、箇条、ブロックの頭と `//}`）は、カーソルをその行に置くと出る |
| 囲む | 範囲を選んで、右クリック「選んだ所を @<code>{} で囲む」「… @<b>{} で囲む」、またはコマンド「選んだ所をインライン命令で囲む（命令を選ぶ）」。中の `}` と `\` は逃がす（`\}`、`\\`）。普通のエディタでも使える |
| 参照の候補 | `@<chap>{`、`@<hd>{`、`@<list>{`、`@<table>{`、`@<img>{` と打つと候補が出る（索引から。ほかの章は `章ID\|id`） |
| ブロックの雛形 | 右クリック「ブロックの雛形を入れる」→ `//list`、`//emlist`、`//cmd`、`//table`、`//image`、`//footnote`、`//quote`、`//pagebreak` |
| マーカー | 範囲を選んで右クリック「マーカーを付ける: AI チェック」「…: 後で読む」。背景色、ホバーにメモと AI の結果と「済みにする · メモ · 案を当てる · 外す」のボタン。マーカービューの項目をクリックすると、編集画面で開いていればそこで選ばれる |
| 診断 | この拡張の規則と textlint などの診断が波線で出る。ホバーで文が読める（一覧は「問題」パネル） |

畳み方:

| 記法 | 畳んだときの見え方 |
|---|---|
| `@<code>{…}` | 中身だけを等幅で |
| `@<b>{…}` | 中身だけを太字で |
| `@<hidx>{…}` | 印ごと隠す（紙面に出ないため）。設定 `editor.hidx` を `"faint"` にすると薄く出す |
| `@<chap>` `@<hd>` `@<table>` `@<list>` `@<img>` `@<fn>` | **紙面に印刷される形**の札: `第3章`（付録は `付録A`）、`「9.19 EXCEPT、…」`（番号は `config.yml` の `secnolevel` まで）、`表3.1`、`リスト3.1`、`図3.1`、脚注は `*2`。参照先の題・キャプション・脚注の文は札のホバーに。番号の付け方は Re:VIEW 2.5.0 に合わせた（`docs/design/architecture.md`）。参照先が無い・曖昧なものは赤（種類と id を出す） |
| `@<embed>{…}` | 「embed」の札（中身は札の説明に） |
| `@<br>{}` | 「↵」の札 |
| `@<href>{url,表示}` | 表示（無ければ url）をリンクの色で。url は札の説明に |
| `=`〜`=====` | 印を隠して大きさを変える（設定 `editor.headingScale`）。`{label}` と `[nonum]` などは札 |
| `#@#` | 行を薄く |
| ` * ` ` ** ` ` 1. ` ` : ` | 印を「•」（深さは全角の空白で字下げ）、「1.」に。` : ` の語は太字 |
| `//list` `//listnum` `//emlist` `//emlistnum` `//cmd` `//source` | 頭の行を「リスト id キャプション」の見出しに、中を等幅で枠に。`//}` は線 |
| `//table` | 頭の行を「表 id キャプション」に。列をそろえ（タブを、実際の書体で測った列の幅まで広げる。列の間は設定 `editor.tableGap`）、区切りの行より上を太字（区切りが無ければ 1 列目）。セルはそのまま打てる |
| `//tsize[…]` | 「tsize …」の札 |
| `//image` | 頭の行を「図 id キャプション」に、その下に PNG（設定 `imagePreview`。`scale=` を幅の比に） |
| `//footnote` | 「脚注 id 文」に |
| `//quote` | 左に線 |
| `//pagebreak` | 「改ページ」の破線 |

これ以外の記法（`//note`、`@<kw>`、`@<m>$…$` など）は記法のまま見せる（壊さない）。`book_mruby3` の原稿にある
記法は全部上の表に入っている（`docs/verification/editor.md`）。コードの中（`//list` などの本文）のインライン命令は
畳まない（コードとして読めることを優先した。構文の色付けと同じ判断）。

右クリックのメニューと `Ctrl+F` は VS Code の webview の仕組みで出ている。キーの割り当ての例は下の「キーバインドの例」。

### 紙面に近い見た目（0.3.0）

記法を畳む編集画面は、本文の幅・文字の大きさの比・行の送り・書体を、本の紙面（PDF）に近づけて出す。
**本文の和文 1 字（1zw）を VS Code のエディタの文字の大きさに当て**、ほかは 1zw に対する比で決める（紙面の pt は使わない）。

| 何 | どう決まるか |
|---|---|
| 本文の幅 | 本の `sty/*.sty` の `\setlength{\textwidth}{49zw}` を読み、全角 49 字の幅で折り返す（`book_mruby3` は `sty/mytextsize.sty`） |
| 段落の頭 | 1 字下げる |
| 行の送り、見出し・コード・表・キャプション・地の文の `@<code>` の大きさ、表の列の間 | `book_mruby3` の PDF を測った比（`docs/design/thresholds.md`）。設定 `editor.page` で変えられる |
| 書体 | PDF と同じもの（Noto Serif CJK JP、LM Roman、Noto Sans CJK JP、Nimbus Sans L、Bera Sans Mono）が PC にあればそれ、無ければ近いもの（Noto Serif JP、Yu Mincho、Yu Gothic、Arial、DejaVu Sans Mono など）。コードは等幅の書体が 1 つも無ければ Consolas・Cascadia Mono、VS Code のエディタの書体、`monospace` の順 |
| 表 | セルを実際の書体で測って列をそろえる。見出しの行（区切りの行より上、区切りが無ければ 1 列目）はゴシック |
| 見出しのページ | 見出しの横に PDF のページ（設定 `pageIndex`）。原稿が未保存か PDF より新しいと薄く出る |
| はみ出し | 表の幅とコードの行長は、既存の診断（`table-width`、`code-line-length`）が波線で出る |

紙面と同じにはならない（見出しの番号、表の罫線、改行の位置などは違う。紙面の正は PDF で、「この節を PDF で開く」で見る）。
`book_mruby3` で改行の位置を比べた結果は `docs/verification/page.md`（原稿の改行をそのまま出すので、段落の 2 行目から先はずれる）。
段階 2 の見た目（UI の書体、幅の制限なし）に戻すなら `{"editor": {"page": {"enable": false}}}`。

ほかの本では、PDF と `pageIndex` を `.review-assist.json` に書いてから測って、出た比を `editor.page` に写す
（このリポジトリを clone して `npm install`、`npm run build` の後で）:

```sh
node tools/measure-page.mjs /path/to/book    # 本文の 1zw に対する比を JSON で出す
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
| `editor.hidx` | `"hide"` | 編集画面（0.3.0）で `@<hidx>` を印ごと隠す（`"hide"`）か薄く出す（`"faint"`） |
| `editor.headingScale` | `[1.728, 1.44, 1.2, 1]` | 編集画面の見出しの文字の大きさ（本文の 1zw に対する比）。`=` から順に、足りない深さは最後の値 |
| `editor.tableGap` | `3` | 編集画面の表の列の間（表の文字の半角の個数） |
| `editor.page.enable` | `true` | 紙面に近い見た目。`false` で段階 2 の見た目 |
| `editor.page.textWidth` | `"auto"` | 本文の幅（全角の字数）。`"auto"` は本の `sty/*.sty` から読み、無ければ 49 |
| `editor.page.lineHeight` | `1.622` | 本文の行の送り（1zw に対する比） |
| `editor.page.paragraphIndent` | `1` | 段落の頭の字下げ（zw） |
| `editor.page.latinScale` | `1.082` | 欧文の大きさ（和文に対する比） |
| `editor.page.inlineCodeScale` | `0.974` | 地の文の `@<code>` の大きさ |
| `editor.page.captionScale` | `0.9` | キャプション（ブロックの頭の札）の大きさ |
| `editor.page.codeScale` / `codeLineHeight` | `0.876` / `1.335` | コードの大きさ（1zw に対する比）と行の送り（コードの大きさに対する比） |
| `editor.page.tableScale` / `tableLineHeight` | `0.9` / `1.61` | 表の文字の大きさと行の送り |
| `editor.page.pageNumbers` | `true` | 見出しの横に PDF のページを出す |
| `editor.page.fonts` | 上の表 | `body`、`bodyLatin`、`heading`、`headingLatin`、`code`、`codeCjk` の書体の並び（`bodyLatin` と `headingLatin` は `local()` の名前）。`code` の後ろには必ず VS Code のエディタの書体と `monospace` が足され、その後ろに `codeCjk` が来る（コードの欧文が本文の明朝に落ちない）。書体の理由は `docs/design/thresholds.md` |
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

## 確かめ方（著者の実機で）

作った環境では VS Code を動かせないので、次は**まだ誰も目で見ていない**（`src/core/` は単体テスト、編集画面の中身は Chromium で
`book_mruby3` の全章を確かめてある。`docs/verification/`）。`code --install-extension review-assist-0.3.0.vsix --force` で入れ直し、
`book_mruby3` を開いて順にやり、違ったら教えてください。

**マーカー（0.2.0）**

1. エクスプローラーに「マーカー」ビューが出る（中身は空）
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

**記法を畳む編集画面（0.3.0）**

12. `contents/vm.re` を開き、エディタの右上のボタン（「記法を畳む編集画面 ⇔ 普通のエディタ」）。同じタブの位置に編集画面が開き、
    普通のエディタのタブは閉じる。`@<code>` が等幅、参照が「第2章」「表3.1」の札、`//list` が枠、`//image` の下に図、になっている
13. 地の文の `@<code>{…}` の中をクリックする。その命令だけ `@<code>{…}` に戻る。外をクリックすると畳まれる。見出しの行、`//list` の頭の行、
    `//}` の行も、その行にカーソルを置くと元の書き方が出る
14. **日本語 IME**: 地の文で「にほんご」と打って変換し、確定する。変換の途中で文字が消えたり二重になったり、候補の窓が飛んだりしないか。
    `@<code>{` の中、表のセルの中、見出しの行、箇条の行でも同じことをする
15. 何か打ってから `Ctrl+Z` で戻る、`Ctrl+Y`（または `Ctrl+Shift+Z`）でやり直す。タブの未保存の印（●）が付いて消えるか
16. `Ctrl+S` で保存。`git diff` が打ったものだけになっている（ほかの所が 1 文字も変わっていない）
17. 同じファイルを普通のエディタでも開いて横に並べる（エクスプローラーで右クリック →「横に並べて開く」）。片方で打つともう片方に出る。
    普通のエディタの側で `Ctrl+Z` しても編集画面が合う
18. 編集画面で範囲を選んで右クリック。「マーカーを付ける: AI チェック」でメモを入れると背景色が付く。マーカーの上にマウスを置くとボタンが出て、
    「済みにする」で点線の下線になる。マーカービューの項目をクリックすると、編集画面のその所が選ばれる（普通のエディタは開かない）
19. 範囲を選んで右クリック「選んだ所を @<code>{} で囲む」。`}` を含む文字列を囲むと `\}` になっている
20. `@<chap>{` と打つと章の候補が出る。`Enter` で `@<chap>{id}` になる。`@<hd>{`、`@<list>{` も
21. 右クリック「ブロックの雛形を入れる」→ `//table` で表の雛形が入り、カーソルが id の所にある
22. 規則に当たる文（たとえば地の文に `OP_SEND` と書く）を打って保存すると、波線が出てホバーで文が読める。textlint の診断も同じく
23. `Ctrl+F` で編集画面の中の検索が出る（VS Code の検索の窓ではなく、編集画面の上に出る）
24. 大きい章（`contents/vm.re`、生成物の `contents/opcodes.re`）で、続けて打っても遅れを感じないか
25. ボタンでもう一度押すと普通のエディタに戻る。未保存のまま戻しても内容が残る（閉じるときに保存を聞かれない・聞かれるのどちらか、を教えてください）

**紙面に近い見た目（0.3.0）**

26. 本文が全角 49 字で折り返し、段落の頭が 1 字下がっている。見出しがゴシックで、横に `p.37` のようなページが出ている
27. 「この節を PDF で開く（横に）」で、原稿の横に PDF の画面が開き、その節のページが出る（WSL の窓でも）。別の節で実行するとそのページへ飛ぶ。PDF と見比べる。文字の大きさの比（見出し・コード・表）、行の間、書体が近いか。どの書体が使われているか
    （開発者ツール: コマンド「開発者: Webview 開発者ツールを開く」→ 文字を選んで「Computed」の「Rendered Fonts」）を教えてください
28. 表の列がそろっている。セルの中を打っても列がそろったまま。地の文の `@<code>` が等幅の書体（Consolas など）で出ている
    （本文の明朝ではない）。`.re` を開いても「non-basic ASCII」の帯や全角の記号の枠が出ない
29. 原稿を直して保存すると、見出しの横のページが薄くなる（PDF が原稿より古いため）。本をビルドし直すと濃くなる

**どちらも**

30. ダークテーマとライトテーマの両方で、マーカーの背景色の上の文字、札・枠・波線・ページ番号が読めるか

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
* **記法を畳む編集画面と紙面に近い見た目（0.3.0）は VS Code の実機で見ていない**（上の「確かめ方」）。webview の中身は Chromium（Playwright）で
  `book_mruby3` の全章を開いて確かめてある（`docs/verification/editor.md`）。取り消しの履歴は VS Code の側にしか持たないので、
  VS Code が webview の中の `Ctrl+Z` を TextDocument の取り消しに回さない場合は効かない（そのときは教えてください）
* 編集画面の行またぎの記法（行をまたぐインライン命令）は畳まない。インライン命令の入れ子（`@<b>{@<code>{x\}}`）も畳み方が崩れることがある
* 編集画面の表の列は、文字の幅（全角を 2）からそろえているので、書体によっては少しずれる

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
