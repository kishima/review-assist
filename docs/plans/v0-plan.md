# review-assist v0: Re:VIEW の原稿を見直すための VS Code 拡張

2026-09-19。著者「今後全体を見直すときのために VS Code の拡張でアシストがあるとうれしい。作ってもいい。GitHub に格納して再利用できるとよい」。
最初の利用者は `book_mruby3`（Deep dive into mruby）。本に固有の規則は設定ファイルに追い出し、拡張自体は Re:VIEW 一般で使える形にする。

## 状況

未着手。

## 決めたこと

 * 置き場所はこのリポジトリ（`kishima/review-assist`、MIT）。Marketplace には出さず、`.vsix` を作って手で入れる。将来出せる形（`publisher`、`README`、`CHANGELOG`）にはしておく
 * リポジトリは `github.com/kishima/review-assist`（公開、MIT）。`package.json` の `repository` / `homepage` / `bugs` はこの URL（著者決定 2026-09-19）
 * 配布は `.vsix` を手で入れる形だけ。Marketplace は考えない。`publisher` は `vsce` が要求するので `kishima` にしてあるが、公開はしない（著者決定 2026-09-19）
 * TypeScript。実行時の依存を持たない（`vscode` の API と Node 標準だけ）。ビルドは esbuild で 1 ファイルに束ねる。PDF の解析はしない（本側のスクリプトが作る索引 JSON を読む）
 * 構文の色付けは既存の `atsushieno.language-review` に任せる。この拡張は言語 `review`（拡張子 `.re`）で起動し、色付けは提供しない
 * 本に固有のもの（禁止語、表記の規則、章の別名、画像の置き場所）は、ワークスペース直下の `.review-assist.json` に書く。無ければ一般的な既定値で動く
 * `docs/` は組織の規則（`README.md` 目次、`design/`、`verification/`、`plans/`、`worklog/`）

## 段階 1: 索引と参照（この段階で `.vsix` を作り、著者に入れてもらう）

### 到達点

 * ワークスペースの `catalog.yml`（PREDEF／CHAPS／APPENDIX／POSTDEF。項目はファイル名でも `contents/vm.re` のようなパスでもよい）を読み、章 ID（拡張子を除いたファイル名）を決める
 * 設定 `chapters`（例: `{"opcodes": ["opcodes_template.re", "sub-article/*.re"]}`）で、生成物の章の**元ファイル**を章に対応づける（`book_mruby3` では `contents/opcodes.re` が生成物で、参照の先は `sub-article/*.re` にある）
 * 全 `.re` を走査して索引を作る: 見出し（`=`〜`=====`、`{label}`、`[nonum]` など）、ブロック（`//list`、`//emlist`、`//cmd`、`//table`、`//image`、`//footnote`、`//imgtable` の id とキャプション）。ファイル変更で差分更新
 * **定義へ移動**（F12）と**ホバー**: `@<chap>{id}`、`@<hd>{見出し}`／`@<hd>{章|見出し}`／`@<hd>{ラベル}`、`@<table>{id}`／`@<table>{章|id}`、`@<img>{…}`、`@<list>{…}`、`@<fn>{…}`。ホバーにはキャプションと場所、`@<img>` は設定 `imagePreview`（例: `images/png/{chapter}/{id}.png`）の PNG があればそれを表示
 * **アウトライン**（DocumentSymbol）: 見出しの階層と、その下の表・リスト・図
 * **診断（参照切れ）**: 上の参照で先が無いものは error。`@<table>` で参照されていない表は warning（設定で切れる）

### 確認

 * `book_mruby3` を開いて、参照切れが 0 件（もし出たら本側を直すか、拡張の解決規則の漏れかを切り分ける）。1 巡目の通し読みで見つかった参照切れ（`vm` の「可視性」、`corelib` の「Floatの文字列化」など。直し済み）を `git stash` 等で一時的に戻すと検出されること
 * 索引の作成が `book_mruby3`（`.re` 約 60 本、2 万行）で 1 秒以内
 * 単体テスト（Node の `node:test`）: 見出し・ブロック・参照の構文解析、`@<hd>` の解決（ラベル優先、見出しテキスト、章指定）

## 段階 2: 規則の診断

### 到達点

 * `.review-assist.json` の `rules` に書いた正規表現の規則を、**地の文だけ**（`//list{…//}` などのブロック本体と `#@#` の行を除く）に適用して診断にする。各規則は `pattern`、`message`、`severity`、`scope`（`prose`／`code`／`all`）
 * 組込みの規則（設定で on/off）: コードブロックの行が `maxCodeLineLength`（既定 80）を超える、`#@# TODO` を info で出す、表の列幅の見積もり（`//tsize` の `P{x\textwidth}` と `l` 列の最長セルから、列数ごとの上限 2 列 0.93／3 列 0.90／4 列 0.87 を超えたら warning。`l` 列の幅は半角 1 文字 0.012、全角は 2 文字分。数の根拠は `book_mruby3/CLAUDE.md` の「紙面幅の制約」）、`//tsize` の無い表で最長セルが列数から見て入らないもの
 * `book_mruby3` 用の `.review-assist.json` を本のリポジトリに置く。規則: 旧表記（`R(`＋数字か英字＋`)`、`SEQ[`、地の文の `OP_` 接頭辞）、全角数字、章番号の直書き（`第N章`、`付録A`）、禁止語（`Rust`、`Bevy`、`実装都合`）、`〜ですます` と `である` の混在は textlint に任せる（この拡張ではやらない）

### 確認

 * `book_mruby3` で診断を出し、既知の箇所が拾えること。誤検出（例: `OP_` を C の識別子として説明している箇所は正当）は、規則側で除外できる書き方（否定先読み、`allowIn` の設定）にする

## 段階 3: PDF との往復

### 到達点

 * コマンド「Review Assist: この節を PDF で開く」。設定 `pdf`（PDF のパス）と `pageIndex`（JSON。`{"見出しテキスト or 章|ラベル": ページ番号}`）を読み、カーソル位置の直近の見出しのページを求めて `vscode.env.openExternal` で `file:///…/book.pdf#page=N` を開く
 * 索引 JSON を作るスクリプトは本側（`book_mruby3/tools/pdf_pages.py`、pypdf で見出しテキストを探す。`tools/build_pdf.sh` の最後に呼ぶ）
 * コマンド「Review Assist: 図の PNG を作り直す」は**持たない**。PNG は本側の `tools/drawio2pdf.sh` が PDF と一緒に `images/png/<章>/<id>.png` に出す（git 管理外）

## 段階 4: 配布

 * `npm run package` で `.vsix`。`README.md` にインストール手順（`code --install-extension review-assist-0.1.0.vsix`）、設定ファイルの全項目と例、既知の制限
 * GitHub Actions でテストとパッケージ作成。タグを打ったら Release に `.vsix` を付ける
 * リポジトリの公開は著者が行う（名前・公開範囲は著者判断）

## やらないこと

 * 構文の色付け、スニペット、Re:VIEW のビルド（既存の拡張と本側のスクリプトに任せる）
 * 日本語の文章の校正（textlint の役目）
 * PDF の直接の解析
