// 設定 `editor`（記法を畳む編集画面、0.3.0）。webview の束にも入るので、ファイルシステムに触らない。
// 数の出どころは docs/design/thresholds.md の「編集画面」。紙面に近い見た目（`page`）の既定値は
// book_mruby3 の PDF（jsbook 9pt、B5、Re:VIEW Starter）を tools/measure-page.mjs で測った値で、
// 比はどれも本文の和文の大きさ（1zw）に対するもの。編集画面は 1zw を VS Code のエディタの文字の大きさに当てる。

/** 書体の候補（CSS の font-family の並び。前から順に、PC にあるものが使われる）。 */
export interface PageFonts {
  /** 本文の和文。 */
  body: string[];
  /** 本文の欧文（`local()` の名前。大きさを `latinScale` に合わせるため @font-face で包む）。 */
  bodyLatin: string[];
  /** 見出し・キャプションの和文。 */
  heading: string[];
  /** 見出しの欧文（`local()` の名前。太字）。 */
  headingLatin: string[];
  /** コードの等幅。総称（monospace など）は書いても外し、後ろに VS Code のエディタの書体と monospace を必ず足す。 */
  code: string[];
  /** コードの中の和文（monospace の後ろに並ぶ。欧文はここまで落ちない）。 */
  codeCjk: string[];
}

/** 紙面に近い見た目（段階 3）。 */
export interface PageConfig {
  /** false で段階 2 の見た目（VS Code の UI の書体、幅の制限なし）。 */
  enable: boolean;
  /**
   * 本文の幅（全角の文字数 = zw）。`"auto"` は本の `sty/*.sty` の `\setlength{\textwidth}{Nzw}` を読み、
   * 読めなければ `DEFAULT_TEXT_WIDTH_ZW`。
   */
  textWidth: number | 'auto';
  /** 本文の行の送り（1zw に対する比）。 */
  lineHeight: number;
  /** 段落の頭の字下げ（zw）。 */
  paragraphIndent: number;
  /** 本文と見出しの欧文の大きさ（和文に対する比）。 */
  latinScale: number;
  /** コードの等幅の大きさ（1zw に対する比）。 */
  codeScale: number;
  /** 地の文の中の `@<code>` の大きさ（1zw に対する比）。 */
  inlineCodeScale: number;
  /** キャプション（ブロックの頭の札）の大きさ（1zw に対する比）。 */
  captionScale: number;
  /** コードの行の送り（コードの等幅の大きさに対する比）。 */
  codeLineHeight: number;
  /** 表のセルの文字の大きさ（1zw に対する比）。 */
  tableScale: number;
  /** 表の行の送り（表の文字の大きさに対する比）。 */
  tableLineHeight: number;
  /** 見出しの横に PDF のページ番号を出す（設定 `pageIndex` があるとき）。 */
  pageNumbers: boolean;
  fonts: PageFonts;
}

/** 畳んだ記法（インライン命令の中身、参照の札）に敷く薄い背景（記法がどこにあるか分かるように）。 */
export interface FoldedBackground {
  enable: boolean;
  /** CSS の色。既定は VS Code のテーマの色（下）。 */
  color: string;
}

export interface EditorConfig {
  /** `@<hidx>` の見せ方。`hide`（印ごと隠す。紙面に出ないため）か `faint`（薄く出す）。 */
  hidx: 'hide' | 'faint';
  /** 見出しの文字の大きさ（本文の 1zw に対する比）。`=` から順に。足りない深さは最後の値。 */
  headingScale: number[];
  /** 表の列の間（表の文字の半角の個数 = 表の文字の大きさの半分を 1 とする）。 */
  tableGap: number;
  /** 畳んだ記法の背景。 */
  foldedBackground: FoldedBackground;
  page: PageConfig;
}

/** 本文の幅を本から読めなかったときの幅。book_mruby3 の PDF の両端をそろえた行の幅 412.13pt ÷ 8.41pt。 */
export const DEFAULT_TEXT_WIDTH_ZW = 49;

export function defaultPageFonts(): PageFonts {
  return {
    // PDF の本文は Noto Serif CJK JP。無ければ同じ字形の Web 用の Noto Serif JP、次に Windows と macOS の標準の明朝
    body: ['Noto Serif CJK JP', 'Noto Serif JP', 'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN', 'serif'],
    // PDF の欧文は Latin Modern Roman 10（Computer Modern の後継）。無ければ Computer Modern の Unicode 版
    bodyLatin: ['LM Roman 10 Regular', 'LMRoman10-Regular', 'Latin Modern Roman', 'CMU Serif Roman', 'CMU Serif'],
    // PDF の見出しは Noto Sans CJK JP Bold
    heading: ['Noto Sans CJK JP', 'Noto Sans JP', 'Yu Gothic', 'YuGothic', 'Hiragino Sans', 'sans-serif'],
    // PDF の見出しの欧文は Nimbus Sans L Bold（Helvetica の互換）。Arial と Liberation Sans は Helvetica と字幅が同じ
    headingLatin: [
      'NimbusSanL-Bold',
      'Nimbus Sans L Bold',
      'Nimbus Sans Bold',
      'Helvetica-Bold',
      'Helvetica Bold',
      'Arial-BoldMT',
      'Arial Bold',
      'LiberationSans-Bold',
      'Liberation Sans Bold',
    ],
    // PDF のコードは Bera Sans Mono（Bitstream Vera Sans Mono の LaTeX 用）。DejaVu Sans Mono は Vera から派生した同じ字形。
    // どれも TeX を入れていない PC には無いことが多いので、Windows の Consolas・Cascadia Mono と macOS の Menlo を続ける。
    // この後に必ず VS Code のエディタの書体（--vscode-editor-font-family）と総称の monospace が入る（editor.ts の themeFor）
    code: ['Bera Sans Mono', 'Bitstream Vera Sans Mono', 'DejaVu Sans Mono', 'Consolas', 'Cascadia Mono', 'Menlo'],
    // PDF のコードの中の和文は本文と同じ明朝。等幅の書体（monospace まで）に和字が無いときだけ使われる
    codeCjk: ['Noto Serif CJK JP', 'Noto Serif JP', 'Yu Mincho', 'YuMincho', 'Hiragino Mincho ProN'],
  };
}

export function defaultPageConfig(): PageConfig {
  return {
    enable: true,
    textWidth: 'auto',
    // 本文の行の送り 13.64pt ÷ 和文 8.41pt
    lineHeight: 1.622,
    // 段落の頭の字下げ 8.41pt ÷ 8.41pt（本文の行の左端 51.89pt から 1 字右で始まる行）
    paragraphIndent: 1,
    // 本文の欧文 9.1pt ÷ 和文 8.41pt（見出しも 13.1 ÷ 12.11、10.92 ÷ 10.09 で同じ比）
    latinScale: 1.082,
    // コードの等幅 7.37pt ÷ 8.41pt
    codeScale: 0.876,
    // 地の文の中の @<code> の等幅 8.19pt ÷ 8.41pt
    inlineCodeScale: 0.974,
    // キャプション（「▼表 3.1: …」）の和文 7.57pt ÷ 8.41pt
    captionScale: 0.9,
    // コードの行の送り 9.84pt ÷ 7.37pt
    codeLineHeight: 1.335,
    // 表のセル 7.57pt ÷ 8.41pt
    tableScale: 0.9,
    // 表の行の送り 12.19pt ÷ 7.57pt
    tableLineHeight: 1.61,
    pageNumbers: true,
    fonts: defaultPageFonts(),
  };
}

export function defaultEditorConfig(): EditorConfig {
  return {
    hidx: 'hide',
    // 見出しの和文: 章の題 14.53pt、== 12.11pt、=== 10.09pt、==== 8.41pt を本文 8.41pt で割った
    headingScale: [1.728, 1.44, 1.2, 1],
    // 表の列の間 11.28pt ÷ 表の文字の半角 3.785pt = 2.98 を丸めた
    tableGap: 3,
    // VS Code のテーマの「整形済みの文字の背景」（textPreformat.background。Markdown のプレビューやホバーで地の文の中の
    // `code` に敷く色）。明暗どちらのテーマでも地の文の上で読めるように作られている。古い VS Code に無ければ textCodeBlock.background
    foldedBackground: { enable: true, color: 'var(--vscode-textPreformat-background, var(--vscode-textCodeBlock-background))' },
    page: defaultPageConfig(),
  };
}

const isPositive = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s !== '');

function readPageConfig(raw: unknown): PageConfig {
  const config = defaultPageConfig();
  if (!raw || typeof raw !== 'object') return config;
  const r = raw as Record<string, unknown>;
  if (typeof r.enable === 'boolean') config.enable = r.enable;
  if (r.textWidth === 'auto' || isPositive(r.textWidth)) config.textWidth = r.textWidth;
  for (const k of ['lineHeight', 'paragraphIndent', 'latinScale', 'codeScale', 'inlineCodeScale', 'captionScale', 'codeLineHeight', 'tableScale', 'tableLineHeight'] as const) {
    if (isPositive(r[k])) config[k] = r[k] as number;
  }
  if (typeof r.pageNumbers === 'boolean') config.pageNumbers = r.pageNumbers;
  if (r.fonts && typeof r.fonts === 'object') {
    const f = r.fonts as Record<string, unknown>;
    for (const k of Object.keys(config.fonts) as (keyof PageFonts)[]) if (isStringList(f[k])) config.fonts[k] = f[k] as string[];
  }
  return config;
}

export function readEditorConfig(raw: unknown): EditorConfig {
  const config = defaultEditorConfig();
  if (!raw || typeof raw !== 'object') return config;
  const r = raw as Record<string, unknown>;
  if (r.hidx === 'hide' || r.hidx === 'faint') config.hidx = r.hidx;
  if (Array.isArray(r.headingScale) && r.headingScale.length > 0 && r.headingScale.every(isPositive)) {
    config.headingScale = r.headingScale as number[];
  }
  if (typeof r.tableGap === 'number' && r.tableGap >= 0) config.tableGap = r.tableGap;
  if (r.foldedBackground === false) config.foldedBackground.enable = false;
  else if (r.foldedBackground && typeof r.foldedBackground === 'object') {
    const f = r.foldedBackground as Record<string, unknown>;
    if (typeof f.enable === 'boolean') config.foldedBackground.enable = f.enable;
    if (typeof f.color === 'string' && f.color !== '') config.foldedBackground.color = f.color;
  }
  if (r.page !== undefined) config.page = readPageConfig(r.page);
  return config;
}
