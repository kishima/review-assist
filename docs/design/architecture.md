# 作り

## 層

```
src/core/        VS Code に依存しない層。判断はすべてここにある
  types.ts       索引と診断の型
  parser.ts      .re を 1 本読む（文字列 → 見出し・ブロック・インライン命令・行の種別）
  catalog.ts     catalog.yml
  config.ts      .review-assist.json
  glob.ts        設定で使う程度の glob（* ** ?）
  index.ts       ワークスペースの索引（章 → 元ファイル → 解析結果）。差分更新
  resolve.ts     @<...>{...} → 索引の中の場所
  tablewidth.ts  表の幅の見積もり
  width.ts       半角換算の文字幅
  outline.ts     アウトラインの木
  diagnostics.ts 診断
  all.ts         テストが読む口（dist/core.js になる）
src/extension.ts VS Code の型に写すだけの層
src/cli.ts       VS Code 無しで全体を診断する CLI
```

VS Code の Extension Development Host が使えない環境で作ったので、**確かめられるのは
`src/core/` だけ**である。だから境界をはっきり分けてある。`src/extension.ts` には
「`core` の結果を `vscode.Diagnostic` や `vscode.DocumentSymbol` に写す」以上のことを書かない。
新しい判断を足すときは `core` に足し、`node:test` で確かめる。

## 実行時依存を持たない

`vscode` の API と Node の標準ライブラリだけで書く。YAML のパーサも glob も持ち込まず、
`catalog.yml` は行ベースで読み、glob は `src/core/glob.ts` に 30 行で書いた。
理由は、原稿を書く人の環境に `npm install` を強いないため（`.vsix` に入るのは
`dist/*.js` だけで 42 KB）。

ビルドは esbuild で 3 つの束にする。`dist/extension.js`（`vscode` は external）、
`dist/cli.js`、`dist/core.js`（テスト用）。

## 索引

1. ワークスペースの根（`catalog.yml` のあるディレクトリ）を決める
2. `catalog.yml` の PREDEF / CHAPS / APPENDIX / POSTDEF から章 ID（拡張子を除いたファイル名）を
   作る。項目はファイル名でも `contents/vm.re` のようなパスでもよい（実在する方を採る）
3. 設定 `chapters` にある章は、書かれた glob を**元ファイル**として使い、`catalog.yml` が
   指している生成物（`contents/opcodes.re`）は索引から外す。外さないと id とラベルが二重になる
4. 章に属さない `.re` も読む（`catalog.yml` に入れ忘れたファイルでもアウトラインは出したい）。
   その章 ID は空文字で、参照の解決だけは全章を順に探す
5. 各ファイルを `parseReview` に掛ける

`updateFile(rel, text)` で 1 本だけ読み直せる。エディタでの編集（`onDidChangeTextDocument`）は
そのファイルだけ、保存（`onDidSaveTextDocument`）は索引全体の診断を出し直す。
「参照されていない表」と「id の二重」は他のファイルを見ないと決まらないので、後者でしか動かない。

`catalog.yml` と `.review-assist.json` は `FileSystemWatcher` で見ていて、変われば索引を作り直す。

## 行の種別

規則（`rules`）を地の文だけに当てるために、パーサが 1 行ごとに種別を付ける。

| 種別 | 何 |
|---|---|
| `prose` | 地の文と見出し |
| `comment` | `#@#` で始まる行 |
| `directive` | `//list[...]{` `//}` `//tsize[...]` などの行そのもの |
| `code` | `//list` `//emlist` `//cmd` `//source` の本文 |
| `blockBody` | それ以外のブロックの本文（`//table` `//quote` など） |

`scope: "prose"` のときは `prose` の行の全部と、`directive` の行のうち**キャプションの引数だけ**を
見る（id の引数と `scale=` は外す）。こうすると `//table[gem_list][全角数字が１つ]` の
キャプションは拾い、`//tsize[|latex||P{0.3\textwidth}|]` は拾わない。
