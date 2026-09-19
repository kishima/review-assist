# 変更の記録

## 0.1.1

アウトラインの見直し（著者の指摘「アウトラインの表示がフラットで項目が多すぎてよく分からない」）。

- **アウトラインは既定で見出しだけにした。** 表・リスト・図・脚注は設定 `outline.blocks` に
  入れた種類だけ見出しの下に出す（既定 `[]`）。`book_mruby3` の `contents/vm.re` は
  118 項目から 66 項目（見出しだけ）になる
- 見出しの range の終わりを、閉じる行の列 0 から**その行の末尾**に変えた。`//}` の直後に
  空行を挟まずに見出しが来ると、子（ブロック）の range が親からはみ出して
  VS Code が木を平らにすることがある。`test/helper.js` の `checkContainment` で
  「selectionRange ⊆ range」「子の range ⊆ 親の range」を不変条件として押さえた

## 0.1.0

最初の版（計画書 `docs/plans/v0-plan.md` の段階 1〜4）。Marketplace には出していない。
[Releases](https://github.com/kishima/review-assist/releases) の `.vsix` を
`code --install-extension` で入れる。

### 索引と参照

- `catalog.yml` と `.review-assist.json` を読んでワークスペースを索引する。設定 `chapters` で、
  生成物の章を元ファイル（`opcodes_template.re` と `sub-article/*.re` など）に読み替える
- 定義へ移動（F12）とホバー: `@<chap>` `@<hd>` `@<list>` `@<table>` `@<img>` `@<fn>`。
  解決の規則は Re:VIEW 2.5.0 の `inline_hd` / `Index#[]` / `HeadlineIndex.parse` に合わせてある
- アウトライン（見出しの階層と、その下の表・リスト・図・脚注）
- `@<img>` のホバーに、設定 `imagePreview` の PNG を出す

### 診断

- 参照切れ（error）、曖昧な参照（error）、参照されていない表（warning）、
  id とラベルの二重（warning）、設定 `rules` の正規表現、コードブロックの行長、表の幅の見積もり、
  `#@#` の中の TODO
- `node dist/cli.js <ワークスペース>` で VS Code 無しに同じ診断を一覧できる

### PDF との往復

- コマンド「Review Assist: この節を PDF で開く」。カーソルの直近の見出し（無ければ章の先頭）の
  ページを設定 `pageIndex` の索引 JSON から引き、設定 `pdf` の PDF を `#page=N` 付きで開く。
  鍵が索引に無ければ見出しの上の段、最後は章の先頭へ落とす
- 設定 `pdf` と `pageIndex` を追加。索引 JSON を作るのは本の側（実例は `book_mruby3` の
  `tools/pdf_pages.py`）。この拡張は PDF を解析しない

### 配布

- GitHub Actions で push と PR のたびにテストと `.vsix` の作成。タグ `v*` で Release に `.vsix`
