// Re:VIEW の `.re` を 1 ファイル分だけ読む。ファイルシステムには触らない（文字列を受け取る）。
// Re:VIEW 2.5 の書式のうち、索引と診断に要るものだけを見る。
import type { Block, BlockKind, Heading, InlineRef, LineKind, ParsedFile, Span } from './types.js';

/** 本文（`{` … `//}`）が「コード」であるブロック。規則の scope `code` はここを指す。 */
const CODE_BLOCKS = new Set(['list', 'emlist', 'cmd', 'source', 'listnum', 'emlistnum']);

/**
 * id を第 1 引数に取り、`@<...>{id}` で参照できるブロック。
 * Re:VIEW 2.5 の `ListIndex`（list|listnum）、`TableIndex`（table|imgtable）、
 * `ImageIndex`（image|graph|imgtable）と `NumberlessImageIndex` / `IndepImageIndex`、
 * `FootnoteIndex` の item_type に合わせてある。`//source` と `//emlist` は索引に入らない。
 */
const ID_BLOCKS = new Set([
  'list',
  'listnum',
  'table',
  'imgtable',
  'image',
  'graph',
  'indepimage',
  'numberlessimage',
  'footnote',
]);

function span(line: number, start: number, endLine: number, end: number): Span {
  return { start: { line, column: start }, end: { line: endLine, column: end } };
}

function blockKind(name: string): BlockKind {
  switch (name) {
    case 'list':
    case 'listnum':
      return 'list';
    case 'emlist':
    case 'emlistnum':
      return 'emlist';
    case 'cmd':
      return 'cmd';
    case 'source':
      return 'source';
    case 'table':
      return 'table';
    case 'imgtable':
      return 'imgtable';
    case 'image':
      return 'image';
    case 'indepimage':
    case 'numberlessimage':
      return 'indepimage';
    case 'footnote':
      return 'footnote';
    default:
      return 'other';
  }
}

/**
 * `//name[a][b][c]{` の `[...]` を読む。`\]` は閉じ括弧ではない。`[` の入れ子も数える
 * （`//image[id][図の[注]付きキャプション]` のような書き方があるため）。
 * 戻り値は引数の中身と、その範囲（行内の桁）、および `[` の並びが終わった位置。
 */
export function parseBracketArgs(
  text: string,
  from: number
): { args: string[]; spans: { start: number; end: number }[]; end: number } {
  const args: string[] = [];
  const spans: { start: number; end: number }[] = [];
  let i = from;
  while (i < text.length && text[i] === '[') {
    let depth = 1;
    let j = i + 1;
    let buf = '';
    while (j < text.length && depth > 0) {
      const c = text[j];
      // `\]` だけを逃がす。`P{0.62\textwidth}` の `\t` を潰さないため、
      // 他の文字の前の `\` はそのまま残す。
      if (c === '\\' && (text[j + 1] === ']' || text[j + 1] === '[' || text[j + 1] === '\\')) {
        buf += text[j + 1];
        j += 2;
        continue;
      }
      if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) break;
      }
      buf += c;
      j++;
    }
    if (depth !== 0) break; // 閉じていない。壊れた行として諦める
    args.push(buf);
    spans.push({ start: i + 1, end: j });
    i = j + 1;
  }
  return { args, spans, end: i };
}

/**
 * 1 行から `@<op>{arg}` を全部拾う。`\}` は閉じ括弧ではない（`@<code>{"#{b\}"}` のような
 * 書き方が原稿にある）。`@<op>$...$` と `@<op>|...|` の形は book_mruby3 に無いので見ない。
 */
export function parseInlineOps(
  line: string
): { op: string; arg: string; start: number; end: number; argStart: number; argEnd: number }[] {
  const out: { op: string; arg: string; start: number; end: number; argStart: number; argEnd: number }[] = [];
  const re = /@<([a-zA-Z0-9_]+)>\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const argStart = m.index + m[0].length;
    let i = argStart;
    let buf = '';
    let closed = -1;
    while (i < line.length) {
      const c = line[i];
      // `\}` だけを逃がす（`@<code>{"#{b\}"}` が原稿にある）。他の `\` は残す。
      if (c === '\\' && (line[i + 1] === '}' || line[i + 1] === '{' || line[i + 1] === '\\')) {
        buf += line[i + 1];
        i += 2;
        continue;
      }
      if (c === '}') {
        closed = i;
        break;
      }
      buf += c;
      i++;
    }
    if (closed < 0) continue; // 行をまたぐインライン命令は扱わない
    out.push({ op: m[1], arg: buf, start: m.index, end: closed + 1, argStart, argEnd: closed });
    re.lastIndex = closed + 1;
  }
  return out;
}

/** 見出しやキャプションからインライン命令を落として、照合に使う素の文字列にする。 */
export function stripInline(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const m = /^@<([a-zA-Z0-9_]+)>\{/.exec(text.slice(i));
    if (!m) {
      out += text[i];
      i++;
      continue;
    }
    let j = i + m[0].length;
    let buf = '';
    let closed = false;
    while (j < text.length) {
      const c = text[j];
      if (c === '\\' && (text[j + 1] === '}' || text[j + 1] === '{' || text[j + 1] === '\\')) {
        buf += text[j + 1];
        j += 2;
        continue;
      }
      if (c === '}') {
        closed = true;
        break;
      }
      buf += c;
      j++;
    }
    if (!closed) {
      out += text[i];
      i++;
      continue;
    }
    // `@<href>{url,表示}` は表示だけ、`@<br>{}` は消える、それ以外は中身をそのまま。
    if (m[1] === 'href') {
      const comma = buf.indexOf(',');
      out += comma >= 0 ? buf.slice(comma + 1) : buf;
    } else if (m[1] !== 'br' && m[1] !== 'embed' && m[1] !== 'hidx' && m[1] !== 'idx') {
      out += buf;
    }
    i = j + 1;
  }
  return out.trim();
}

const HEADING_RE = /^(=+)(\[[^\]]*\])?(\{([^}]*)\})?\s*(.*)$/;

export function parseReview(file: string, text: string, chapter: string): ParsedFile {
  const lines = text.split(/\r?\n/);
  const headings: Heading[] = [];
  const blocks: Block[] = [];
  const refs: InlineRef[] = [];
  const lineKinds: LineKind[] = new Array(lines.length).fill('prose');
  const directiveProseSpans: ParsedFile['directiveProseSpans'] = [];

  // 見出しの階層を持ち回って path を作る。index は level-1。
  const stack: string[] = [];
  // Re:VIEW の headline index 用の段（`==` を 0 段目とする。`label ?? 見出しの文字列`）。
  const indexStack: string[] = [];
  // column（`==[column] 題` 〜 `==[/column]`）の中の見出しは索引に入らない。
  let columnLevel = -1;
  /** 直前に見た `//tsize` の引数。次の `//table` に付ける。 */
  let pendingTsize: string | undefined;

  for (let ln = 0; ln < lines.length; ln++) {
    const line = lines[ln];

    if (line.startsWith('#@')) {
      lineKinds[ln] = 'comment';
      continue;
    }

    if (line.startsWith('//')) {
      lineKinds[ln] = 'directive';
      if (line === '//}') continue;
      const nameMatch = /^\/\/([a-zA-Z0-9_]+)/.exec(line);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      const { args, spans, end } = parseBracketArgs(line, nameMatch[0].length);
      const hasBody = line.slice(end).trimStart().startsWith('{');

      if (name === 'tsize') {
        pendingTsize = args[0];
        continue;
      }

      // 規則（地の文）を当ててよいのはキャプション類だけ。id の引数は外す。
      const idBearing = ID_BLOCKS.has(name);
      for (let a = 0; a < spans.length; a++) {
        if (idBearing && a === 0) continue;
        if (/^scale=/.test(args[a])) continue;
        directiveProseSpans.push({ line: ln, start: spans[a].start, end: spans[a].end });
      }

      const body: string[] = [];
      let bodyStartLine = -1;
      let lastLine = ln;
      if (hasBody) {
        bodyStartLine = ln + 1;
        const bodyKind: LineKind = CODE_BLOCKS.has(name) ? 'code' : 'blockBody';
        let k = ln + 1;
        while (k < lines.length && lines[k] !== '//}') {
          lineKinds[k] = lines[k].startsWith('#@') ? 'comment' : bodyKind;
          body.push(lines[k]);
          k++;
        }
        if (k < lines.length) lineKinds[k] = 'directive';
        lastLine = Math.min(k, lines.length - 1);
      }

      const kind = blockKind(name);
      const block: Block = {
        file,
        span: span(ln, 0, lastLine, lines[lastLine]?.length ?? 0),
        kind,
        args,
        body,
        bodyStartLine,
        chapter,
      };
      if (idBearing && args.length > 0) block.id = args[0];
      if (name === 'footnote') {
        if (args.length > 1) block.caption = args[1];
      } else if (idBearing && args.length > 1) {
        block.caption = args[1];
      } else if (!idBearing && args.length > 0) {
        block.caption = args[0];
      }
      if (kind === 'table' || kind === 'imgtable') {
        if (pendingTsize !== undefined) block.tsize = pendingTsize;
      }
      pendingTsize = undefined;
      blocks.push(block);
      ln = lastLine;
      continue;
    }

    if (line.startsWith('=')) {
      const m = HEADING_RE.exec(line);
      if (m) {
        const level = m[1].length;
        const modifier = m[2] ? m[2].slice(1, -1) : undefined;
        const label = m[4];
        const title = m[5] ?? '';
        const titleStart = line.length - (m[5] ?? '').length;
        const plainTitle = stripInline(title);
        stack.length = Math.max(0, level - 1);
        stack[level - 1] = plainTitle;

        // column の開始・終了。Re:VIEW は column の中の見出しを headline index に入れない。
        if (modifier === 'column') {
          columnLevel = level;
        } else if (modifier === '/column') {
          columnLevel = -1;
        } else if (columnLevel >= 0 && level <= columnLevel) {
          columnLevel = -1;
        }
        const inColumn = columnLevel >= 0;

        // Re:VIEW の鍵は `==` から始まる段。`=`（章の題）は入らない。
        let indexId: string | undefined;
        if (level >= 2) {
          indexStack.length = Math.max(0, level - 2);
          indexStack[level - 2] = label ? label : plainTitle;
          if (!inColumn && plainTitle !== '') indexId = indexStack.slice(0, level - 1).join('|');
        }
        const heading: Heading = {
          file,
          span: span(ln, 0, ln, line.length),
          level,
          title,
          plainTitle,
          chapter,
          path: stack.slice(0, level).map((s) => s ?? ''),
          selectionSpan: span(ln, titleStart, ln, line.length),
        };
        if (label) heading.label = label;
        if (modifier) heading.modifier = modifier;
        if (indexId !== undefined) heading.indexId = indexId;
        headings.push(heading);
      }
    }
    pendingTsize = undefined;
  }

  // インライン命令は、コメント行以外のすべての行から拾う（ブロックのキャプションにも
  // `@<code>` が入るし、`//footnote[id][… @<chap>{vm}]` のような参照も実在する）。
  for (let ln = 0; ln < lines.length; ln++) {
    if (lineKinds[ln] === 'comment') continue;
    if (lineKinds[ln] === 'code') continue; // コードの中の `@<...>` は参照ではない
    for (const op of parseInlineOps(lines[ln])) {
      refs.push({
        file,
        span: span(ln, op.start, ln, op.end),
        argSpan: span(ln, op.argStart, ln, op.argEnd),
        op: op.op,
        arg: op.arg,
        chapter,
      });
    }
  }

  return { file, lines, headings, blocks, refs, lineKinds, directiveProseSpans };
}
