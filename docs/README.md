# review-assist documents

組織の規則（[`sabiruby/.github` の `CONTRIBUTING.md`](https://github.com/sabiruby/.github/blob/main/CONTRIBUTING.md)）
のとおり、`design/` は現状の作り、`verification/` は確かめ方と測った値、`plans/` は決めたことと
順番、`worklog/` は日付付きの記録。

使い方と設定の全項目は、リポジトリの [`../README.md`](../README.md) にある。
版ごとの変更は [`../CHANGELOG.md`](../CHANGELOG.md)。

## design/ — どう作ってあるか

| ファイル | 中身 |
|---|---|
| [architecture.md](design/architecture.md) | 層の分け方（`src/core/` と VS Code 層）、索引の作り方、差分更新、ビルド、マーカーの保存形式と位置の探し直しと AI との受け渡し、記法を畳む編集画面（CodeMirror 6 を webview にだけ入れる例外、畳む範囲の決め方、TextDocument との同期） |
| [review-syntax.md](design/review-syntax.md) | Re:VIEW 2.5 のうち読んでいる書式と、参照の解決の規則（本家の実装のどこに合わせたか） |
| [syntax-highlight.md](design/syntax-highlight.md) | 構文の色付け（TextMate 文法）。自前で持つ理由、選んだ scope 名とその根拠、コード系ブロックでインライン命令を色付けしない判断、取りこぼしの機械確認 |
| [thresholds.md](design/thresholds.md) | 数の根拠。表の幅の上限・`l` 列の係数・コードの行長、マーカーの前後の文脈の長さ（測った）と色（VS Code から借りた）、編集画面の紙面に近い見た目の数（`book_mruby3` の PDF を測った比）と書体がどこから来たか |

## verification/ — どう確かめているか

| ファイル | 中身 |
|---|---|
| [stage1-2.md](verification/stage1-2.md) | 単体テストの一覧、`book_mruby3` 全体に掛けた結果、過去のコミットに対する回帰の確認 |
| [marks.md](verification/marks.md) | 0.2.0 のマーカー。単体テストと計画書の確認の対応、`book_mruby3` の過去の修正 93 コミットに当てて見失う・取り違える割合を前後の文脈の長さごとに数えた表、探し直しの速さ、依頼 → AI の結果 → 読み込みの 1 巡 |
| [editor.md](verification/editor.md) | 0.3.0 の記法を畳む編集画面。単体テスト、`book_mruby3` の全 57 本を Chromium で開いて文字列が変わらないこととカーソルで記法が出ること（17,307 か所）、畳んだ記法の数と記法のまま残ったもの（0）、打つときの遅さ、拡張の側とのやりとり、`.vsix` |
| [feedback-0.3.0.md](verification/feedback-0.3.0.md) | 0.3.0 を著者が Windows で試した後の直し。参照の札を Re:VIEW のビルドの .tex（表・リスト・図 88、見出し 166、章 277、脚注 3）と PDF に当てた結果、コードの書体を Chromium で取った前後、PDF の画面がそのページを出すこと、`.vsix` |
| [page.md](verification/page.md) | 0.3.0 の紙面に近い見た目。`book_mruby3` の PDF を測った値（本文・見出し・コード・表の大きさと行の送り、本文の幅、書体）、PDF と編集画面の改行の位置を本全体で比べた数、並べた画像（`images/`） |
| [stage3-4.md](verification/stage3-4.md) | 見出し 576 件が PDF のどのページに当たったか、PDF のしおりとの突き合わせ、図の PNG、`.vsix`、CI で確かめていないこと |

## plans/ — 何をどの順で

| ファイル | 中身 |
|---|---|
| [v0-plan.md](plans/v0-plan.md) | v0 の 4 段階（段階 1〜4 すべて済み） |
| [marks-and-editor-plan.md](plans/marks-and-editor-plan.md) | 0.2・0.3。マーカーとまとめて AI に頼む仕組み（段階 1、0.2.0 で実装）、記法を畳む編集画面（段階 2）、紙面に近い見た目（段階 3）、配布（段階 4）。2026-10-17 作成 |

## worklog/ — 何がいつ

| ファイル | 中身 |
|---|---|
| [2026-09-19-v0-stage1-2.md](worklog/2026-09-19-v0-stage1-2.md) | 段階 1・2 の実装。Re:VIEW 本家の索引の規則を読みに行った経緯、表の幅の係数が途中で変わっていた話、捨てた案 |
| [2026-09-19-v0-stage3-4.md](worklog/2026-09-19-v0-stage3-4.md) | 段階 3・4 の実装。PDF の抽出テキストと原稿が一致しない 4 つの理由とつぶし方、目次に吸い込まれた話、図の PNG を drawio と gs で測って決めた話、CI と配布 |
| [2026-09-20-v0.1.1-outline.md](worklog/2026-09-20-v0.1.1-outline.md) | 0.1.1。アウトラインがフラットに見える件。項目数を数え直した話、既定を見出しだけにした判断、`//}` の直後が見出しだと子の range が親からはみ出していたバグと直し方 |
| [2026-09-20-v0.1.2-grammar.md](worklog/2026-09-20-v0.1.2-grammar.md) | 0.1.2。構文の色付けを自前で持つまで。`language-review` が壊れる理由、原稿の書式を grep して数えた表、捨てたテストの案、取りこぼしの網を壊して確かめた話 |
| [2026-10-17-v0.3.0-feedback.md](worklog/2026-10-17-v0.3.0-feedback.md) | 0.3.0 を著者が Windows で試した後の直し。参照の札を紙面の形に（Re:VIEW の数え方を読んだ話）、コードの書体が本文の明朝に落ちた理由、PDF を VS Code の中で開く、試験で著者のマーカーのファイルを消してしまったこと |
| [2026-10-17-v0.3.0-release.md](worklog/2026-10-17-v0.3.0-release.md) | 段階 4（0.3.0）。バージョン、`.vsix` から `dist/core.js` を外す、README の確かめ方をまとめる |
| [2026-10-17-v0.3.0-page.md](worklog/2026-10-17-v0.3.0-page.md) | 段階 3（0.3.0）。紙面に近い見た目。1zw をエディタの文字の大きさに当てる決め方、PDF を pdf.js で測った話（柱やインラインのコードが混ざった測り方の誤り）、表の列の間を測り直した、表を実際の書体で測ってそろえる、改行の位置の比べ方と段落の字下げ |
| [2026-10-17-v0.3.0-editor.md](worklog/2026-10-17-v0.3.0-editor.md) | 段階 2（0.3.0）。記法を畳む編集画面。どこまでを webview で決めるか、パーサを増やさずに箇条を足した話、同期の番号と行き違い、表をタブの幅でそろえる案、確かめ方の誤り（描く範囲の端の行）、遅さ |
| [2026-10-17-v0.2.0-marks.md](worklog/2026-10-17-v0.2.0-marks.md) | 0.2.0。マーカーの位置を文字列で探し直す 3 段の決め方（数を使わずに「同じ段落の中」を言う）、前後の文脈の長さを git log の修正に当てて測った話（段落を移したのを取り違えと数えていた測り方の誤り）、色を VS Code から借りた理由、1 巡やって直したこと |
