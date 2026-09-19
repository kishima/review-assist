# 読んでいる Re:VIEW の書式と、参照の解決の規則

参照の解決は**推測で決めていない**。Re:VIEW 2.5.0 の実装を読んで、それに合わせてある。

* `lib/review/builder.rb` の `inline_hd`
* `lib/review/book/index.rb` の `Index#[]`、`Index.parse`、`HeadlineIndex.parse`

（`https://raw.githubusercontent.com/kmuto/review/v2.5.0/lib/...` から取って読んだ。
`book_mruby3` が使っている Docker イメージは `kauplan/review2.5`。）

## 見出し

```
=={chap_SEND} SEND、SEND0、SENDB
===[nonum] 付録の節
==[column] コラム
==[/column]
```

`=` の数が深さ、`[...]` が修飾子、`{...}` がラベル、残りが題。

### headline index の鍵

`@<hd>` が引くのはこの鍵である（`HeadlineIndex.parse`）。

* `==` を 0 段目とする。**`=`（章の題）は索引に入らない**（`index = m[1].size - 2` が
  負のときに捨てている）
* 各段は「ラベルがあればラベル、無ければ題」（`m[3].present? ? m[3] : m[4]`）
* 鍵は 0 段目からその見出しまでを `|` でつないだもの（`headlines.join('|')`）
* `[column]` から `[/column]` までの中の見出しは索引に入らない
* 題が空の見出しは索引に入らない
* ブロック（`//xxx{` 〜 `//}`）の中の行は見出しとして見ない

例:

```
= mruby Operation Code Reference   → 索引に入らない
=={chap_LAMBDA} LAMBDA、BLOCK      → 鍵 "chap_LAMBDA"
=== 補足                            → 鍵 "chap_LAMBDA|補足"
==== 環境の捕捉                     → 鍵 "chap_LAMBDA|補足|環境の捕捉"
```

## `@<hd>{...}` の引き方

`inline_hd(id)`:

1. `/\A([^|]+)\|(.+)/` で**最初の `|` 1 個だけ**で切る。前半が章 ID（`catalog.yml` にある
   ファイル名から拡張子を取ったもの）なら、その章に残り全部を渡す
2. 章 ID でなければ、その参照が書かれている章に `id` をそのまま渡す

章の中での引き方は `Index#[]`:

1. 鍵と**完全一致**するものがあればそれ
2. 無いとき、どれかの鍵の**最後の段**が `id` と等しいものが 2 つ以上あれば `KeyError`
   （`key ... is ambiguous`）。Re:VIEW はここでビルドを止める
3. 鍵を `|` で割ったどれか 1 段が `id` と等しい最初のもの
4. 無ければ `KeyError`

3 があるので `@<hd>{chap_LAMBDA}`（道の途中の段）でも引ける。逆に `@<hd>{補足}` のように
どの記事にもある段を指すと 2 で落ちる。この拡張は 2 を `ambiguous-ref`（error）で報告する。

この規則は実際に効いた。`book_mruby3` の初版から引き継いだ
`@<hd>{chapter03|chap_LAMBDA|補足}` は、最初「解決できない」と出たが、本家の実装を読むと
**正しい参照**だった（鍵が `chap_LAMBDA|補足` になる）。逆に、同じ頃の
`@<hd>{chapter03|chap_ONERR|補足}` は本当に壊れていた（`chap_ONERR` が `chap_EXCEPT` に
改名されたときの取り残し）。

## ブロックと `@<...>{id}`

`Index.parse` は `%r{\A//#{item_type}}` で行を拾い、最初の `[...]` を id にする。
参照するインライン命令と探す先の対応（本家の `item_type` そのまま）:

| 命令 | 探すブロック |
|---|---|
| `@<list>` | `//list` `//listnum`（`//emlist` `//cmd` `//source` は索引に入らない） |
| `@<table>` | `//table` `//imgtable` |
| `@<img>` | `//image` `//graph` `//imgtable`、次に `//numberlessimage` `//indepimage` |
| `@<fn>` | `//footnote` |
| `@<chap>` | `catalog.yml` の章 |

章をまたぐときの `章ID|id` は `@<hd>` と同じ切り方。

## 生成物の章

`book_mruby3` の `contents/opcodes.re` は `insert.rb` が `opcodes_template.re` と
`sub-article/*.re` から作る。参照の先（`=={chap_SEND}`）は `sub-article/` にあるので、
設定 `chapters` で章 `opcodes` の中身を元ファイルに読み替える。読み替えたら生成物は索引から
外す（同じラベルが 2 つになるため）。

この読み替えがあるので、`sub-article/chap3-026-JMP.re` から `@<hd>{chap_EXCEPT}` と書いた
参照が、別のファイル `sub-article/chap3-030-EXCEPT.re` の見出しに解決する。生成後は 1 本の
ファイルなので、Re:VIEW から見た振る舞いと同じになる。

## 逃がし文字

* ブロックの引数では `\]` だけを逃がす。`P{0.62\textwidth}` の `\t` を潰してはいけない
* インライン命令の中では `\}` だけを逃がす（`@<code>{"#{b\}"}` が原稿にある）
* `@<op>$...$` と `@<op>|...|` の形は扱わない（`book_mruby3` に無い）
* 行をまたぐインライン命令は拾わない
