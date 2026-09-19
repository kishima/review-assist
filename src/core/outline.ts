// アウトライン（VS Code の DocumentSymbol の素）。既定は見出しだけ。
// 設定 outline.blocks に入れた種類の表・リスト・図・脚注だけを見出しの下に足す。
// VS Code に依存しない形で木を作り、拡張側で DocumentSymbol に写す。
import type { Block, Heading, ParsedFile, Span } from './types.js';

export type OutlineKind = 'heading' | 'list' | 'table' | 'image' | 'footnote' | 'other';

/** 設定 `outline.blocks` に書ける種類（見出しの下に出せるブロック）。 */
export type OutlineBlockKind = 'list' | 'table' | 'image' | 'footnote';

export const OUTLINE_BLOCK_KINDS: readonly OutlineBlockKind[] = ['list', 'table', 'image', 'footnote'];

export interface OutlineOptions {
  /** 見出しの下に出すブロックの種類。既定は空（見出しだけ）。 */
  blocks?: readonly OutlineBlockKind[];
}

export interface OutlineNode {
  name: string;
  detail: string;
  kind: OutlineKind;
  span: Span;
  selectionSpan: Span;
  children: OutlineNode[];
}

function blockNode(block: Block): OutlineNode | undefined {
  let kind: OutlineKind;
  switch (block.kind) {
    case 'list':
    case 'source':
      kind = 'list';
      break;
    case 'table':
    case 'imgtable':
      kind = 'table';
      break;
    case 'image':
    case 'indepimage':
      kind = 'image';
      break;
    case 'footnote':
      kind = 'footnote';
      break;
    default:
      return undefined; // `//emlist` `//cmd` は id を持たないのでアウトラインに出さない
  }
  if (!block.id) return undefined;
  return {
    name: `${kindMark(kind)} ${block.id}`,
    detail: block.caption ?? '',
    kind,
    span: block.span,
    selectionSpan: { start: block.span.start, end: { line: block.span.start.line, column: block.span.start.column + 1 } },
    children: [],
  };
}

function kindMark(kind: OutlineKind): string {
  switch (kind) {
    case 'list':
      return 'list';
    case 'table':
      return 'table';
    case 'image':
      return 'image';
    case 'footnote':
      return 'fn';
    default:
      return '';
  }
}

function headingNode(h: Heading): OutlineNode {
  return {
    name: h.plainTitle || '(無題)',
    detail: h.label ? `{${h.label}}` : '',
    kind: 'heading',
    span: h.span,
    selectionSpan: h.selectionSpan,
    children: [],
  };
}

/**
 * 1 ファイルのアウトライン。見出しを木にして、`options.blocks` に入れた種類のブロックだけを
 * 直前の見出しの下に置く（既定は見出しだけ）。
 * 見出しの span の終わりは「次の同位以上の見出しの直前の行の末尾」まで伸ばす。
 *
 * 行の末尾（列 0 ではなく)まで伸ばすのは、VS Code の DocumentSymbol が
 * 「子の range ⊆ 親の range」を要求するため。ブロックの span の終わりは最後の行（`//}`）の
 * 末尾なので、親を列 0 で閉じると、`//}` の次の行がすぐ見出しのときに子がはみ出し、
 * VS Code が木を崩してフラットに見せる。
 */
export function buildOutline(parsed: ParsedFile, options: OutlineOptions = {}): OutlineNode[] {
  const show = new Set<OutlineKind>(options.blocks ?? []);
  const roots: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];
  const lastLine = Math.max(0, parsed.lines.length - 1);
  const endOfLine = (line: number): Span['end'] => ({ line, column: parsed.lines[line]?.length ?? 0 });

  type Item = { line: number; heading?: Heading; block?: Block };
  const items: Item[] = [
    ...parsed.headings.map((h) => ({ line: h.span.start.line, heading: h })),
    ...parsed.blocks.map((b) => ({ line: b.span.start.line, block: b })),
  ].sort((a, b) => a.line - b.line);

  const closeTo = (level: number, endLine: number) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      const top = stack.pop()!;
      top.node.span = { start: top.node.span.start, end: endOfLine(Math.max(top.node.span.start.line, endLine)) };
    }
  };

  for (const item of items) {
    if (item.heading) {
      closeTo(item.heading.level, Math.max(0, item.line - 1));
      const node = headingNode(item.heading);
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].node.children.push(node);
      stack.push({ level: item.heading.level, node });
    } else if (item.block) {
      const node = blockNode(item.block);
      if (!node || !show.has(node.kind)) continue;
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].node.children.push(node);
    }
  }
  closeTo(0, lastLine);
  return roots;
}
