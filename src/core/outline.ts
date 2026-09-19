// アウトライン（VS Code の DocumentSymbol の素）。見出しの階層と、その下の表・リスト・図。
// VS Code に依存しない形で木を作り、拡張側で DocumentSymbol に写す。
import type { Block, Heading, ParsedFile, Span } from './types.js';

export type OutlineKind = 'heading' | 'list' | 'table' | 'image' | 'footnote' | 'other';

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
 * 1 ファイルのアウトライン。見出しを木にして、各ブロックを直前の見出しの下に置く。
 * 見出しの span の終わりは「次の同位以上の見出しの直前」まで伸ばす。
 */
export function buildOutline(parsed: ParsedFile): OutlineNode[] {
  const roots: OutlineNode[] = [];
  const stack: { level: number; node: OutlineNode }[] = [];
  const lastLine = Math.max(0, parsed.lines.length - 1);

  type Item = { line: number; heading?: Heading; block?: Block };
  const items: Item[] = [
    ...parsed.headings.map((h) => ({ line: h.span.start.line, heading: h })),
    ...parsed.blocks.map((b) => ({ line: b.span.start.line, block: b })),
  ].sort((a, b) => a.line - b.line);

  const closeTo = (level: number, endLine: number) => {
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      const top = stack.pop()!;
      top.node.span = { start: top.node.span.start, end: { line: Math.max(top.node.span.start.line, endLine), column: 0 } };
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
      if (!node) continue;
      if (stack.length === 0) roots.push(node);
      else stack[stack.length - 1].node.children.push(node);
    }
  }
  closeTo(0, lastLine);
  return roots;
}
