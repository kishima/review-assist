# 変更の記録

## 0.1.0（未リリース）

段階 1 と段階 2（計画書 `docs/plans/v0-plan.md`）。

- `catalog.yml` と `.review-assist.json` を読んでワークスペースを索引する。設定 `chapters` で、
  生成物の章を元ファイル（`opcodes_template.re` と `sub-article/*.re` など）に読み替える
- 定義へ移動（F12）とホバー: `@<chap>` `@<hd>` `@<list>` `@<table>` `@<img>` `@<fn>`。
  解決の規則は Re:VIEW 2.5.0 の `inline_hd` / `Index#[]` / `HeadlineIndex.parse` に合わせてある
- アウトライン（見出しの階層と、その下の表・リスト・図・脚注）
- 診断: 参照切れ（error）、曖昧な参照（error）、参照されていない表（warning）、
  id とラベルの二重（warning）、設定 `rules` の正規表現、コードブロックの行長、表の幅の見積もり、
  `#@#` の中の TODO
- `node dist/cli.js <ワークスペース>` で VS Code 無しに同じ診断を一覧できる
