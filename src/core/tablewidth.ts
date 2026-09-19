// 表が紙面幅に収まるかの見積もり。
//
// 根拠はすべて book_mruby3/CLAUDE.md「紙面幅の制約（表とコード）」:
//   * 本文幅は 49zw（9pt）。表のセルは自動では折り返されないので、折り返す列に `//tsize` で
//     `P{幅}` を指定する
//   * 「`P{}` の合計と `l` 列の見積もり幅の和の上限は、2 列で 0.93、3 列で 0.90、4 列で 0.87
//     （残りは列の余白と罫線）」
//   * 「`l` 列の幅は最長セルの半角換算文字数 × 0.011（全角は 2 文字）で見積もる（半角 1 文字
//     ≒ 0.5zw、本文幅 49zw なので 0.5/49 ≒ 0.0102 に余白分を足した値）」
//     — 2026-09-19 に本文が 10pt/44zw から 9pt/49zw になり、0.012 から 0.011 に変わった。
//     本文の大きさを変えたらここも直す（設定 `tableWidth.charWidth` で上書きできる）。
//
// 著者が値を与えているのは 2・3・4 列だけなので、それ以外の列数は 0.96 - 0.015 × 列数 で
// 外挿する（この式は 2 → 0.93、3 → 0.90、4 → 0.87 をちょうど再現する。列が 1 本増えるごとに
// 余白と罫線で 0.015 取られる、という読み方）。設定 `tableWidth.limits` で上書きできる。
import { stripInline } from './parser.js';
import type { Block } from './types.js';
import { displayWidth } from './width.js';

/** 著者が CLAUDE.md に書いた値。 */
export const AUTHOR_LIMITS: Record<number, number> = { 2: 0.93, 3: 0.9, 4: 0.87 };
/** 外挿の式の係数。AUTHOR_LIMITS の 3 点をちょうど通る。 */
const LIMIT_BASE = 0.96;
const LIMIT_PER_COLUMN = 0.015;
/** `l` 列: 半角 1 文字あたりの `\textwidth` 比（CLAUDE.md、9pt・本文幅 49zw のときの値）。 */
export const DEFAULT_CHAR_WIDTH = 0.011;

export function widthLimit(columns: number, overrides?: Record<string, number>): number {
  const override = overrides?.[String(columns)];
  if (typeof override === 'number') return override;
  if (AUTHOR_LIMITS[columns] !== undefined) return AUTHOR_LIMITS[columns];
  return LIMIT_BASE - LIMIT_PER_COLUMN * columns;
}

export type ColumnSpec = { kind: 'fixed'; width: number } | { kind: 'auto' };

/**
 * `//tsize[|latex||l|l|P{0.62\textwidth}|]` の引数から列の指定を取り出す。
 * `|latex|` の部分（ビルダ名の並び）を落としてから LaTeX の tabular の書式を読む。
 */
export function parseTsize(arg: string): ColumnSpec[] | undefined {
  if (!arg) return undefined;
  let spec = arg;
  const m = /^\|([^|]*)\|(.*)$/s.exec(arg);
  if (m) spec = m[2];
  const out: ColumnSpec[] = [];
  let i = 0;
  while (i < spec.length) {
    const c = spec[i];
    if (c === '|' || c === ' ') {
      i++;
      continue;
    }
    if (c === '@' || c === '>' || c === '<') {
      // `@{...}` `>{...}` `<{...}` は列ではない。中身を読み飛ばす。
      i++;
      i = skipBraces(spec, i);
      continue;
    }
    if (c === 'p' || c === 'P' || c === 'm' || c === 'b') {
      const start = i + 1;
      const end = skipBraces(spec, start);
      const inner = spec.slice(start + 1, end - 1);
      out.push({ kind: 'fixed', width: parseLatexWidth(inner) });
      i = end;
      continue;
    }
    if (c === 'l' || c === 'c' || c === 'r' || c === 'X') {
      out.push({ kind: 'auto' });
      i++;
      continue;
    }
    i++; // 知らない文字は無視
  }
  return out.length > 0 ? out : undefined;
}

function skipBraces(text: string, from: number): number {
  if (text[from] !== '{') return from;
  let depth = 0;
  let i = from;
  while (i < text.length) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return text.length;
}

/** `0.62\textwidth` → 0.62。`\textwidth` が無ければ 0（見積もれない）。 */
export function parseLatexWidth(text: string): number {
  const m = /([0-9]*\.?[0-9]+)\s*\\textwidth/.exec(text);
  if (m) return parseFloat(m[1]);
  return 0;
}

export interface TableEstimate {
  columns: number;
  /** 列ごとの見積もり幅（`\textwidth` 比）。 */
  widths: number[];
  total: number;
  limit: number;
  overflow: boolean;
  /** `//tsize` が付いているか。 */
  hasTsize: boolean;
  /** 最長セルを持つ列とその中身（報告用）。 */
  widestColumn: number;
  widestCell: string;
}

/** 表の行をセルに割る。Re:VIEW の `//table` はタブ区切り、`-` だけの行は見出しの区切り。 */
export function tableRows(block: Block): string[][] {
  const rows: string[][] = [];
  for (const line of block.body) {
    if (!line.trim()) continue;
    if (/^-+$/.test(line.trim())) continue;
    if (line.startsWith('#@')) continue;
    rows.push(line.split('\t').map((cell) => cell.replace(/^\./, '')));
  }
  return rows;
}

/**
 * セルの半角換算の幅。インライン命令は中身だけ数える。`@<br>{}` はそこで折り返るので、
 * 分けたうちの一番長いものを取る。
 */
export function cellWidth(cell: string): number {
  const segments = cell.split(/@<br>\{\}/);
  let max = 0;
  for (const seg of segments) max = Math.max(max, displayWidth(stripInline(seg)));
  return max;
}

export function estimateTable(
  block: Block,
  options: { limits?: Record<string, number>; charWidth?: number } = {}
): TableEstimate | undefined {
  const rows = tableRows(block);
  if (rows.length === 0) return undefined;
  const charWidth = options.charWidth ?? DEFAULT_CHAR_WIDTH;

  const bodyColumns = rows.reduce((n, r) => Math.max(n, r.length), 0);
  const spec = parseTsize(block.tsize ?? '');
  const columns = spec ? Math.max(spec.length, bodyColumns) : bodyColumns;

  // 列ごとの最長セル（半角換算）。
  const maxCells: number[] = new Array(columns).fill(0);
  const widestText: string[] = new Array(columns).fill('');
  for (const row of rows) {
    for (let c = 0; c < row.length && c < columns; c++) {
      const w = cellWidth(row[c]);
      if (w > maxCells[c]) {
        maxCells[c] = w;
        widestText[c] = stripInline(row[c]);
      }
    }
  }

  const widths: number[] = [];
  for (let c = 0; c < columns; c++) {
    const s = spec?.[c];
    if (s && s.kind === 'fixed') widths.push(s.width);
    else widths.push(maxCells[c] * charWidth);
  }

  const total = widths.reduce((a, b) => a + b, 0);
  const limit = widthLimit(columns, options.limits);
  let widestColumn = 0;
  for (let c = 1; c < columns; c++) if (widths[c] > widths[widestColumn]) widestColumn = c;

  return {
    columns,
    widths,
    total,
    limit,
    overflow: total > limit,
    hasTsize: spec !== undefined,
    widestColumn,
    widestCell: widestText[widestColumn] ?? '',
  };
}
