= 最初の章

== 導入
ここは地の文である。@<hd>{chap_dup}と@<hd>{gen|chap_A}を見よ。
@<hd>{導入|細かい話}も引ける。@<hd>{チャート}は曖昧になる。
@<hd>{中の見出し}はコラムの中なので引けない。@<chap>{nosuch}も無い。
旧表記の R(n) は地の文なので拾う。

=== 細かい話
@<list>{code1}と@<table>{t1}と@<img>{fig1}と@<fn>{note1}。
@<list>{nosuchlist}は無い。

//list[code1][サンプル。R(n) はキャプションなので地の文]{
def f(a)
  puts "#{a}"
end
この行はコードなので R(n) も	タブも拾わない
//}

//footnote[note1][脚注の本文。@<chap>{gen}も見よ]

//image[fig1][図のキャプション][scale=1.0]

//tsize[|latex||l|P{0.60\textwidth}|]
//table[t1][表のキャプション]{
列A	列B
short	ここは説明

//}

//table[t2][幅を見積もる表（tsize 無し）]{
見出しの列	とても長い説明の列で折り返しが無いと紙面から確実にはみ出してしまう長い文を入れてある
a	この列は日本語がとても長いので l 列のままでは入らない
//}

==={chap_dup} 仕組み

=== チャート

== 別の節

=== チャート

==[column] コラム

=== 中の見出し

==[/column]
