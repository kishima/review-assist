// 編集画面（0.3.0）が「記法を畳む」ための一覧。`.re` の文字列から、どの範囲がどの記法で、
// 畳んだときに何を隠し何を見せるかを作る。VS Code にもファイルシステムにも依存しない
// （webview の束にもそのまま入る）。読むのは `parser.ts`（3 つ目のパーサは作らない）。
//
// 位置は「行の頭からの桁」と、行の切れ目を 1 文字と数えた通しの位置（CodeMirror の数え方）の両方で持つ。
// CRLF の原稿でも通しの位置が CodeMirror と合うように、`\r\n` も 1 文字と数える。
import { parseReview } from './parser.js';
import type { Block, LineKind, ListItem, ParsedFile } from './types.js';

/** 畳んで見せ方を決めてあるインライン命令（計画書 段階 2 の並び）。これ以外は記法のまま見せる。 */
export const FOLDED_INLINE_OPS = ['code', 'b', 'hidx', 'chap', 'hd', 'table', 'list', 'img', 'fn', 'embed', 'br', 'href'] as const;
export type FoldedInlineOp = (typeof FOLDED_INLINE_OPS)[number];
/** 参照先の題を札で見せるもの。 */
export const REF_CHIP_OPS = new Set(['chap', 'hd', 'table', 'list', 'img', 'fn']);

/** 枠と見出しを付けて、中を等幅で見せるブロック（本文がコード）。 */
export const CODE_FRAME_BLOCKS = new Set(['list', 'listnum', 'emlist', 'emlistnum', 'cmd', 'source']);
/** 見せ方を決めてあるブロック命令。これ以外は記法のまま見せる。 */
export const FOLDED_BLOCKS = new Set([...CODE_FRAME_BLOCKS, 'table', 'tsize', 'image', 'footnote', 'quote', 'pagebreak']);

export interface InlineFold {
  t: 'inline';
  op: string;
  line: number;
  /** `@` の位置と `}` の次（通しの位置）。 */
  from: number;
  to: number;
  /** `{` の次と `}`。 */
  argFrom: number;
  argTo: number;
  /** 逃がしを解いた中身。 */
  arg: string;
  /** 中身の中の逃がしの `\`（畳んだときに隠す）。 */
  escapes: number[];
  /** `@<href>{url,表示}` の `,` の位置。無ければ undefined。 */
  comma?: number;
}

export interface HeadingFold {
  t: 'heading';
  line: number;
  level: number;
  from: number;
  to: number;
  /** `=` から題の前の空白までの終わり（ここまでを隠す）。 */
  markTo: number;
  label?: string;
  modifier?: string;
}

export interface LineFold {
  t: 'comment';
  line: number;
  from: number;
  to: number;
}

export interface ListFold {
  t: 'list';
  line: number;
  kind: ListItem['kind'];
  depth: number;
  from: number;
  /** 行の終わり。 */
  to: number;
  markerFrom: number;
  markerTo: number;
  /** 番号付きの番号（`1.` の `1`）。 */
  number?: string;
}

/** `//name[...]` の行（本文の頭の行、または本文を持たない 1 行の命令）。 */
export interface DirectiveFold {
  t: 'directive';
  line: number;
  from: number;
  to: number;
  name: string;
  args: string[];
  id?: string;
  caption?: string;
  /** 本文を持つなら `//}` の行（無ければ -1）。 */
  endLine: number;
  /** 見せ方: code（枠と等幅）、table、quote、image、footnote、pagebreak、tsize。 */
  look: 'code' | 'table' | 'quote' | 'image' | 'footnote' | 'pagebreak' | 'tsize';
}

export interface BlockEndFold {
  t: 'blockEnd';
  line: number;
  from: number;
  to: number;
  look: DirectiveFold['look'];
}

export interface BodyLineFold {
  t: 'body';
  line: number;
  from: number;
  to: number;
  look: 'code' | 'quote';
}

export interface TableRowFold {
  t: 'tableRow';
  line: number;
  from: number;
  to: number;
  /** 見出しの行（区切りの行より前。区切りが無ければ見出しは 1 列目）。Re:VIEW 2.5.0 `Builder#table`。 */
  header: boolean;
  /** 区切りの行が無い表（1 列目が見出し）。 */
  firstColumnHeader: boolean;
  /** その表の頭（`//table`）の行。同じ表の行をまとめて列の幅を決めるため。 */
  table: number;
  /** セルの範囲（タブを除く）。列をそろえる幅は webview が実際の書体で測って決める。 */
  cells: { from: number; to: number }[];
  /** タブの並び 1 つずつと、その前のセルの列の番号。 */
  seps: { from: number; to: number; col: number }[];
}

export interface TableRuleFold {
  t: 'tableRule';
  line: number;
  from: number;
  to: number;
}

/** 本の原稿にあるが、見せ方を決めていない記法（記法のまま見せる）。数えて verification に書く。 */
export interface RawFold {
  t: 'raw';
  line: number;
  from: number;
  to: number;
  what: string;
}

export type FoldItem =
  | InlineFold
  | HeadingFold
  | LineFold
  | ListFold
  | DirectiveFold
  | BlockEndFold
  | BodyLineFold
  | TableRowFold
  | TableRuleFold
  | RawFold;

export interface FoldPlan {
  /** 行ごとの通しの位置の始まり。 */
  lineStarts: number[];
  lineKinds: LineKind[];
  items: FoldItem[];
  /** 行 → その行の命令の行（ブロックの頭）・ブロックの終わり・本文の行など、行全体に掛かるもの。 */
  parsed: ParsedFile;
}

/** 本文の中で `@<op>{` から始まる逃がしの `\` の位置（`\}` `\{` `\\` の `\`）。parser.ts の逃がしと同じ規則。 */
function escapesIn(line: string, from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i < to; i++) {
    if (line[i] === '\\' && (line[i + 1] === '}' || line[i + 1] === '{' || line[i + 1] === '\\')) {
      out.push(i);
      i++;
    }
  }
  return out;
}

function tableRows(parsed: ParsedFile, block: Block, starts: number[], items: FoldItem[]): void {
  const lines = parsed.lines;
  const first = block.bodyStartLine;
  const n = block.body.length;
  // 区切りの行と、セルの切り方は Re:VIEW 2.5.0 `Builder#table`（`/\A[\=\-]{12}/`、`line.strip.split(/\t+/)`）
  const sepIndex = block.body.findIndex((l) => /^[=-]{12}/.test(l));
  for (let k = 0; k < n; k++) {
    const ln = first + k;
    const line = lines[ln];
    const from = starts[ln];
    const to = from + line.length;
    if (line.startsWith('#@')) continue;
    if (k === sepIndex) {
      items.push({ t: 'tableRule', line: ln, from, to });
      continue;
    }
    const seps: TableRowFold['seps'] = [];
    const cells: TableRowFold['cells'] = [];
    const re = /\t+/g;
    let m: RegExpExecArray | null;
    let col = 0;
    let cellStart = 0;
    while ((m = re.exec(line)) !== null) {
      cells.push({ from: from + cellStart, to: from + m.index });
      seps.push({ from: from + m.index, to: from + m.index + m[0].length, col });
      cellStart = m.index + m[0].length;
      col++;
    }
    cells.push({ from: from + cellStart, to });
    items.push({
      t: 'tableRow',
      line: ln,
      from,
      to,
      header: sepIndex >= 0 && k < sepIndex,
      firstColumnHeader: sepIndex < 0,
      table: block.span.start.line,
      cells,
      seps,
    });
  }
}

function lookOf(name: string): DirectiveFold['look'] | undefined {
  if (CODE_FRAME_BLOCKS.has(name)) return 'code';
  switch (name) {
    case 'table':
    case 'quote':
    case 'image':
    case 'footnote':
    case 'pagebreak':
    case 'tsize':
      return name;
    default:
      return undefined;
  }
}

/**
 * 原稿全体を読んで、畳む範囲の一覧を作る。`text` は CodeMirror の `doc.toString()`（行の切れ目は
 * `\n` か `\r\n`）。
 */
export function planFolds(text: string, file = '', chapter = ''): FoldPlan {
  const parsed = parseReview(file, text, chapter);
  const lines = parsed.lines;
  const starts: number[] = new Array(lines.length);
  let pos = 0;
  for (let i = 0; i < lines.length; i++) {
    starts[i] = pos;
    pos += lines[i].length + 1;
  }
  const items: FoldItem[] = [];

  // 行の命令（ブロック）。parser の blocks は `//tsize` を持たないので、directive の行を見直す。
  const blockAt = new Map<number, Block>();
  for (const b of parsed.blocks) blockAt.set(b.span.start.line, b);
  for (let ln = 0; ln < lines.length; ln++) {
    if (parsed.lineKinds[ln] !== 'directive') continue;
    const line = lines[ln];
    if (line === '//}') continue; // ブロックの終わりは頭の側で足す
    const m = /^\/\/([a-zA-Z0-9_]+)/.exec(line);
    const from = starts[ln];
    const to = from + line.length;
    if (!m) {
      items.push({ t: 'raw', line: ln, from, to, what: '//（命令の形でない行）' });
      continue;
    }
    const name = m[1];
    const look = lookOf(name);
    if (!look) {
      items.push({ t: 'raw', line: ln, from, to, what: `//${name}` });
      continue;
    }
    if (name === 'tsize') {
      const arg = /^\/\/tsize\[(.*)\]\s*$/.exec(line)?.[1] ?? '';
      items.push({ t: 'directive', line: ln, from, to, name, args: [arg], endLine: -1, look });
      continue;
    }
    const b = blockAt.get(ln);
    if (!b) continue;
    const endLine = b.bodyStartLine >= 0 ? b.span.end.line : -1;
    const d: DirectiveFold = { t: 'directive', line: ln, from, to, name, args: b.args, endLine, look };
    if (b.id !== undefined) d.id = b.id;
    if (b.caption !== undefined) d.caption = b.caption;
    items.push(d);
    if (b.bodyStartLine >= 0) {
      if (look === 'table') tableRows(parsed, b, starts, items);
      else if (look === 'code' || look === 'quote') {
        for (let k = 0; k < b.body.length; k++) {
          const bl = b.bodyStartLine + k;
          if (parsed.lineKinds[bl] === 'comment') continue;
          items.push({ t: 'body', line: bl, from: starts[bl], to: starts[bl] + lines[bl].length, look });
        }
      }
      if (lines[endLine] === '//}') {
        items.push({ t: 'blockEnd', line: endLine, from: starts[endLine], to: starts[endLine] + lines[endLine].length, look });
      }
    }
  }

  // 見出し
  for (const h of parsed.headings) {
    const ln = h.span.start.line;
    const from = starts[ln];
    const item: HeadingFold = {
      t: 'heading',
      line: ln,
      level: h.level,
      from,
      to: from + lines[ln].length,
      markTo: from + h.selectionSpan.start.column,
    };
    if (h.label !== undefined) item.label = h.label;
    if (h.modifier !== undefined) item.modifier = h.modifier;
    items.push(item);
  }

  // コメントの行
  for (let ln = 0; ln < lines.length; ln++) {
    if (parsed.lineKinds[ln] === 'comment') items.push({ t: 'comment', line: ln, from: starts[ln], to: starts[ln] + lines[ln].length });
  }

  // 箇条
  for (const li of parsed.listItems) {
    const from = starts[li.line];
    const item: ListFold = {
      t: 'list',
      line: li.line,
      kind: li.kind,
      depth: li.depth,
      from,
      to: from + lines[li.line].length,
      markerFrom: from + li.markerStart,
      markerTo: from + li.markerEnd,
    };
    if (li.kind === 'ol') item.number = /\d+/.exec(lines[li.line].slice(li.markerStart))?.[0];
    items.push(item);
  }

  // インライン命令（コードとコメントの中は parser が拾わない）
  const folded = new Set<string>(FOLDED_INLINE_OPS);
  for (const r of parsed.refs) {
    const ln = r.span.start.line;
    const base = starts[ln];
    const from = base + r.span.start.column;
    const to = base + r.span.end.column;
    if (!folded.has(r.op)) {
      items.push({ t: 'raw', line: ln, from, to, what: `@<${r.op}>` });
      continue;
    }
    const argFrom = base + r.argSpan.start.column;
    const argTo = base + r.argSpan.end.column;
    const line = lines[ln];
    const item: InlineFold = {
      t: 'inline',
      op: r.op,
      line: ln,
      from,
      to,
      argFrom,
      argTo,
      arg: r.arg,
      escapes: escapesIn(line, r.argSpan.start.column, r.argSpan.end.column).map((c) => base + c),
    };
    if (r.op === 'href') {
      const c = line.slice(r.argSpan.start.column, r.argSpan.end.column).indexOf(',');
      if (c >= 0) item.comma = argFrom + c;
    }
    items.push(item);
  }

  // `@<op>$…$` と `@<op>|…|` の形は parser が拾わないので、記法のまま残ったものとして数える
  // （book_mruby3 には 0 件）。
  for (let ln = 0; ln < lines.length; ln++) {
    const kind = parsed.lineKinds[ln];
    if (kind === 'comment' || kind === 'code') continue;
    const re = /@<([a-zA-Z0-9_]+)>([$|])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(lines[ln])) !== null) {
      const close = lines[ln].indexOf(m[2], m.index + m[0].length);
      if (close < 0) continue;
      items.push({ t: 'raw', line: ln, from: starts[ln] + m.index, to: starts[ln] + close + 1, what: `@<${m[1]}>${m[2]}…${m[2]}` });
    }
  }

  items.sort((a, b) => a.from - b.from || a.to - b.to);
  return { lineStarts: starts, lineKinds: parsed.lineKinds, items, parsed };
}

/** 記法のまま残ったものを種類ごとに数える（verification の表）。 */
export function countRaw(plan: FoldPlan): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of plan.items) if (it.t === 'raw') out.set(it.what, (out.get(it.what) ?? 0) + 1);
  return out;
}

/** 畳んだものを種類ごとに数える（verification の表）。 */
export function countFolded(plan: FoldPlan): Map<string, number> {
  const out = new Map<string, number>();
  const add = (k: string) => out.set(k, (out.get(k) ?? 0) + 1);
  for (const it of plan.items) {
    switch (it.t) {
      case 'inline':
        add(`@<${it.op}>`);
        break;
      case 'heading':
        add(`${'='.repeat(it.level)}`);
        break;
      case 'comment':
        add('#@');
        break;
      case 'list':
        add(it.kind === 'ul' ? ` ${'*'.repeat(it.depth)}` : it.kind === 'ol' ? ' 1.' : ' :');
        break;
      case 'directive':
        add(`//${it.name}`);
        break;
      default:
        break;
    }
  }
  return out;
}
