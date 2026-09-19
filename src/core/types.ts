// 索引・診断で使う型。VS Code には依存しない（テストと CLI から同じものを使う）。

/** 0 起点の行・桁。VS Code の Position と同じ数え方にしてある。 */
export interface Pos {
  line: number;
  column: number;
}

export interface Span {
  start: Pos;
  end: Pos;
}

export interface Located {
  /** ワークスペース直下からの相対パス（区切りは常に `/`）。 */
  file: string;
  span: Span;
}

/** `= 見出し` から `===== 見出し` まで。 */
export interface Heading extends Located {
  /** `=` の数。1 が章。 */
  level: number;
  /** `=={label} タイトル` の label。無ければ undefined。 */
  label?: string;
  /** `[nonum]` `[nodisp]` `[notoc]` `[column]` などの修飾子。 */
  modifier?: string;
  /** 見出しの文字列（インライン命令はそのまま残す）。 */
  title: string;
  /** インライン命令を落とした見出し。`@<hd>` の照合に使う。 */
  plainTitle: string;
  /** この見出しを含む章 ID。 */
  chapter: string;
  /** ルートからこの見出しまでの plainTitle の並び（自分を含む）。表示用。 */
  path: string[];
  /**
   * Re:VIEW の headline index での鍵（`@<hd>` が引くもの）。
   * `==` 以上の深さの見出しについて、各段を「ラベルがあればラベル、無ければ見出しの文字列」
   * にして `|` でつないだもの（Re:VIEW 2.5 `Book::HeadlineIndex.parse`）。
   * `=`（章の題）と column の中の見出し、題の無い見出しは索引に入らないので undefined。
   */
  indexId?: string;
  /** タイトル部分だけの範囲（定義へ移動したときにここが選択される）。 */
  selectionSpan: Span;
}

export type BlockKind =
  | 'list'
  | 'emlist'
  | 'cmd'
  | 'source'
  | 'table'
  | 'imgtable'
  | 'image'
  | 'indepimage'
  | 'footnote'
  | 'other';

export interface Block extends Located {
  kind: BlockKind;
  /** `//list[id][caption]` の id。id を取らないブロック（`//emlist` など）では undefined。 */
  id?: string;
  caption?: string;
  /** `[...]` の中身をそのまま並べたもの。 */
  args: string[];
  /** 本文（`{` …`//}`）の行。本文を持たないブロックでは空。 */
  body: string[];
  /** 本文の最初の行（0 起点）。本文が無ければ -1。 */
  bodyStartLine: number;
  chapter: string;
  /** 直前に置かれた `//tsize` の引数（`//table` のときだけ）。 */
  tsize?: string;
}

/** `@<op>{arg}` 1 個。 */
export interface InlineRef extends Located {
  op: string;
  arg: string;
  /** `{`…`}` の中だけの範囲。 */
  argSpan: Span;
  chapter: string;
}

/** 1 行が原稿のどの層にあるか。規則の scope の判定に使う。 */
export type LineKind =
  | 'prose' // 地の文（見出しも含む）
  | 'comment' // `#@#`
  | 'directive' // `//list[...]{` `//}` `//tsize[...]` などの行そのもの
  | 'code' // `//list` `//emlist` `//cmd` `//source` の本文
  | 'blockBody'; // それ以外のブロックの本文（`//table` `//quote` など）

export interface ParsedFile {
  file: string;
  lines: string[];
  headings: Heading[];
  blocks: Block[];
  refs: InlineRef[];
  lineKinds: LineKind[];
  /** directive 行のうち、地の文として規則を当ててよい範囲（キャプションなど）。 */
  directiveProseSpans: { line: number; start: number; end: number }[];
}

export type Severity = 'error' | 'warning' | 'info' | 'hint';

export interface Diagnostic extends Located {
  severity: Severity;
  /** `review-assist.broken-ref` のような機械可読な識別子。 */
  code: string;
  message: string;
}
