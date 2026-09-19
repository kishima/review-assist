# review-assist documents

組織の規則（[`sabiruby/.github` の `CONTRIBUTING.md`](https://github.com/sabiruby/.github/blob/main/CONTRIBUTING.md)）
のとおり、`design/` は現状の作り、`verification/` は確かめ方と測った値、`plans/` は決めたことと
順番、`worklog/` は日付付きの記録。

使い方と設定の全項目は、リポジトリの [`../README.md`](../README.md) にある。
版ごとの変更は [`../CHANGELOG.md`](../CHANGELOG.md)。

## design/ — どう作ってあるか

| ファイル | 中身 |
|---|---|
| [architecture.md](design/architecture.md) | 層の分け方（`src/core/` と VS Code 層）、索引の作り方、差分更新、ビルド |
| [review-syntax.md](design/review-syntax.md) | Re:VIEW 2.5 のうち読んでいる書式と、参照の解決の規則（本家の実装のどこに合わせたか） |
| [thresholds.md](design/thresholds.md) | 数の根拠。表の幅の上限・`l` 列の係数・コードの行長がどこから来たか |

## verification/ — どう確かめているか

| ファイル | 中身 |
|---|---|
| [stage1-2.md](verification/stage1-2.md) | 単体テストの一覧、`book_mruby3` 全体に掛けた結果、過去のコミットに対する回帰の確認 |

## plans/ — 何をどの順で

| ファイル | 中身 |
|---|---|
| [v0-plan.md](plans/v0-plan.md) | v0 の 4 段階（段階 1・2 は済み、3・4 は未着手） |

## worklog/ — 何がいつ

| ファイル | 中身 |
|---|---|
| [2026-09-19-v0-stage1-2.md](worklog/2026-09-19-v0-stage1-2.md) | 段階 1・2 の実装。Re:VIEW 本家の索引の規則を読みに行った経緯、表の幅の係数が途中で変わっていた話、捨てた案 |
