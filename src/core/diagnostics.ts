// 診断。索引を受け取って、ファイル 1 本分の診断を作る。
// 段階 1（参照切れ・参照されていない表）と段階 2（規則・コードの行長・表の幅）の両方。
import { matchesAny } from './glob.js';
import type { ReviewIndex } from './index.js';
import { resolveRefDetailed, isReferenceOp, splitChapterPrefix } from './resolve.js';
import { estimateTable } from './tablewidth.js';
import type { Diagnostic, ParsedFile, Severity, Span } from './types.js';
import { displayWidth } from './width.js';

export const CODES = {
  brokenRef: 'broken-ref',
  unknownChapter: 'unknown-chapter',
  ambiguousRef: 'ambiguous-ref',
  unreferencedTable: 'unreferenced-table',
  duplicateId: 'duplicate-id',
  rule: 'rule',
  codeLineLength: 'code-line-length',
  tableWidth: 'table-width',
  todo: 'todo',
} as const;

const OP_LABEL: Record<string, string> = {
  chap: '章',
  hd: '見出し',
  list: 'リスト',
  table: '表',
  img: '図',
  fn: '脚注',
};

function span(line: number, start: number, end: number): Span {
  return { start: { line, column: start }, end: { line, column: end } };
}

/** 参照切れ（段階 1）。 */
export function referenceDiagnostics(index: ReviewIndex, parsed: ParsedFile): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const ref of parsed.refs) {
    if (!isReferenceOp(ref.op)) continue;
    const outcome = resolveRefDetailed(index, ref);
    if (outcome.kind === 'hit') continue;
    const label = OP_LABEL[ref.op] ?? ref.op;
    if (outcome.kind === 'ambiguous') {
      // Re:VIEW は `Index#[]` で KeyError（ambiguous）にしてビルドを止める。
      out.push({
        file: parsed.file,
        span: ref.span,
        severity: 'error',
        code: CODES.ambiguousRef,
        message: `@<${ref.op}>{${ref.arg}} は曖昧（同じ名前の${label}が章の中に複数ある）。ラベルを付けるか、上の段を足して \`親|子\` の形にする`,
      });
      continue;
    }
    let message = `@<${ref.op}>{${ref.arg}} の先が見つからない（${label}）`;
    const { chapter } = splitChapterPrefix(index, ref.arg);
    if (ref.op === 'chap') {
      message = `章 \`${ref.arg}\` が catalog.yml に無い`;
    } else if (!chapter && ref.arg.includes('|')) {
      const guess = ref.arg.split('|')[0];
      message += `（\`${guess}\` は章 ID ではないので、このファイルの章の中だけを探した）`;
    } else if (!chapter) {
      const own = index.chapterOfFile(parsed.file);
      message += own ? `（章 \`${own}\` の中を探した）` : '（このファイルはどの章にも属していない）';
    }
    out.push({
      file: parsed.file,
      span: ref.span,
      severity: 'error',
      code: ref.op === 'chap' ? CODES.unknownChapter : CODES.brokenRef,
      message,
    });
  }
  return out;
}

/** 参照されていない表（段階 1、設定で切れる）。索引全体を見るのでファイル単位では出せない。 */
export function unreferencedTableDiagnostics(index: ReviewIndex): Diagnostic[] {
  if (!index.config.warnUnreferencedTables) return [];
  const referenced = new Set<string>();
  for (const parsed of index.files.values()) {
    for (const ref of parsed.refs) {
      if (ref.op !== 'table') continue;
      const { chapter, rest } = splitChapterPrefix(index, ref.arg);
      const own = chapter ?? index.chapterOfFile(parsed.file);
      referenced.add(`${own}|${rest}`);
    }
  }
  const out: Diagnostic[] = [];
  for (const parsed of index.files.values()) {
    for (const block of parsed.blocks) {
      if (block.kind !== 'table' || !block.id) continue;
      if (referenced.has(`${block.chapter}|${block.id}`)) continue;
      out.push({
        file: parsed.file,
        span: span(block.span.start.line, 0, index.files.get(parsed.file)!.lines[block.span.start.line].length),
        severity: 'warning',
        code: CODES.unreferencedTable,
        message: `表 \`${block.id}\` はどこからも @<table> で参照されていない`,
      });
    }
  }
  return out;
}

/** 同じ章の中で id が二重になっているブロック（Re:VIEW は後勝ちで気づきにくい）。 */
export function duplicateIdDiagnostics(index: ReviewIndex): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const chapter of index.chapters.values()) {
    const seen = new Map<string, { file: string; line: number }>();
    for (const block of index.blocksOfChapter(chapter.id)) {
      if (!block.id) continue;
      const key = `${block.kind}|${block.id}`;
      const prev = seen.get(key);
      if (prev) {
        out.push({
          file: block.file,
          span: block.span,
          severity: 'warning',
          code: CODES.duplicateId,
          message: `//${block.kind} の id \`${block.id}\` が章 \`${chapter.id}\` の中で二重（先に ${prev.file}:${prev.line + 1}）`,
        });
      } else {
        seen.set(key, { file: block.file, line: block.span.start.line });
      }
    }
    const labels = new Map<string, { file: string; line: number }>();
    for (const h of index.headingsOfChapter(chapter.id)) {
      if (!h.label) continue;
      const prev = labels.get(h.label);
      if (prev) {
        out.push({
          file: h.file,
          span: h.span,
          severity: 'warning',
          code: CODES.duplicateId,
          message: `見出しのラベル \`${h.label}\` が章 \`${chapter.id}\` の中で二重（先に ${prev.file}:${prev.line + 1}）`,
        });
      } else {
        labels.set(h.label, { file: h.file, line: h.span.start.line });
      }
    }
  }
  return out;
}

/**
 * 規則（段階 2）を当てるための、行ごとの「地の文」「コード」の切り出し。
 * 地の文 = ブロックの本体でも `#@#` でもない行。`//...` の行はキャプションの引数だけ。
 * これで地の文を切り出しておけば、規則の正規表現は素の本文だけを見ればよい。
 */
export function sliceForScope(parsed: ParsedFile, scope: 'prose' | 'code' | 'all'): { line: number; start: number; text: string }[] {
  const out: { line: number; start: number; text: string }[] = [];
  for (let ln = 0; ln < parsed.lines.length; ln++) {
    const kind = parsed.lineKinds[ln];
    const line = parsed.lines[ln];
    if (scope === 'all') {
      if (kind === 'comment') continue;
      out.push({ line: ln, start: 0, text: line });
      continue;
    }
    if (scope === 'code') {
      if (kind === 'code') out.push({ line: ln, start: 0, text: line });
      continue;
    }
    // prose
    if (kind === 'prose') out.push({ line: ln, start: 0, text: line });
    else if (kind === 'directive') {
      for (const s of parsed.directiveProseSpans) {
        if (s.line === ln) out.push({ line: ln, start: s.start, text: line.slice(s.start, s.end) });
      }
    }
  }
  return out;
}

/** `.review-assist.json` の `rules`（段階 2）。 */
export function ruleDiagnostics(index: ReviewIndex, parsed: ParsedFile): Diagnostic[] {
  const out: Diagnostic[] = [];
  index.config.rules.forEach((rule, i) => {
    if (rule.allowIn && matchesAny(parsed.file, rule.allowIn)) return;
    let re: RegExp;
    try {
      const flags = rule.flags ?? '';
      re = new RegExp(rule.pattern, flags.includes('g') ? flags : flags + 'g');
    } catch (e) {
      out.push({
        file: parsed.file,
        span: span(0, 0, 0),
        severity: 'error',
        code: `${CODES.rule}.${rule.id ?? i}`,
        message: `規則の正規表現が壊れている: ${rule.pattern}（${e instanceof Error ? e.message : String(e)}）`,
      });
      return;
    }
    const severity: Severity = rule.severity ?? 'warning';
    for (const slice of sliceForScope(parsed, rule.scope ?? 'prose')) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(slice.text)) !== null) {
        const start = slice.start + m.index;
        out.push({
          file: parsed.file,
          span: span(slice.line, start, start + Math.max(m[0].length, 1)),
          severity,
          code: `${CODES.rule}.${rule.id ?? i}`,
          message: rule.message,
        });
        if (m[0].length === 0) re.lastIndex++;
      }
    }
  });
  return out;
}

/**
 * コードブロックの行長（段階 2、組込み）。
 *
 * 数え方は既定で「文字数」（全角も 1）。根拠: book_mruby3/CLAUDE.md「紙面幅の制約」は
 * 「1 行 83 文字を超えると右にはみ出す」「**1 行 80 文字以内**にする」と文字数で書いており、
 * 実際に和文コメント入りの行（例: contents/vm.re:408 は 73 文字 / 半角換算 85）を含む
 * 原稿が `Overfull hbox` 0 でビルドできている。つまり `alltt` の和文は半角 2 個分では無い。
 * 半角換算で数えたい場合は設定 `codeLineWidth: "halfwidth"`。
 */
export function codeLineDiagnostics(index: ReviewIndex, parsed: ParsedFile): Diagnostic[] {
  const limit = index.config.maxCodeLineLength;
  if (limit <= 0) return [];
  const halfwidth = index.config.codeLineWidth === 'halfwidth';
  const out: Diagnostic[] = [];
  for (let ln = 0; ln < parsed.lines.length; ln++) {
    if (parsed.lineKinds[ln] !== 'code') continue;
    const line = parsed.lines[ln];
    const w = halfwidth ? displayWidth(line) : [...line].length;
    if (w <= limit) continue;
    out.push({
      file: parsed.file,
      span: span(ln, 0, line.length),
      severity: 'warning',
      code: CODES.codeLineLength,
      message: `コードブロックの行が ${w} ${halfwidth ? '文字（半角換算）' : '文字'}で上限 ${limit} を超えている`,
    });
  }
  return out;
}

/** 表の幅（段階 2、組込み）。 */
export function tableWidthDiagnostics(index: ReviewIndex, parsed: ParsedFile): Diagnostic[] {
  if (index.config.tableWidth.enable === false) return [];
  const out: Diagnostic[] = [];
  for (const block of parsed.blocks) {
    if (block.kind !== 'table' && block.kind !== 'imgtable') continue;
    const est = estimateTable(block, {
      limits: index.config.tableWidth.limits,
      charWidth: index.config.tableWidth.charWidth,
    });
    if (!est || !est.overflow) continue;
    const detail = est.widths.map((w) => w.toFixed(3)).join(' + ');
    const how = est.hasTsize
      ? '`//tsize` の P{} を狭めるか、長いセルを短くする'
      : '`//tsize` を付けて長い列を `P{幅}` にする';
    out.push({
      file: parsed.file,
      span: span(block.span.start.line, 0, parsed.lines[block.span.start.line].length),
      severity: 'warning',
      code: CODES.tableWidth,
      message:
        `表 \`${block.id ?? ''}\`（${est.columns} 列）の幅の見積もりが ${est.total.toFixed(3)} で、` +
        `上限 ${est.limit.toFixed(3)} を超えている（${detail}）。` +
        `一番広いのは ${est.widestColumn + 1} 列目「${est.widestCell.slice(0, 24)}」。${how}`,
    });
  }
  return out;
}

/** `#@#` の中の TODO（段階 2、組込み）。 */
export function todoDiagnostics(index: ReviewIndex, parsed: ParsedFile): Diagnostic[] {
  if (!index.config.todoComments) return [];
  const out: Diagnostic[] = [];
  for (let ln = 0; ln < parsed.lines.length; ln++) {
    if (parsed.lineKinds[ln] !== 'comment') continue;
    const m = /TODO/.exec(parsed.lines[ln]);
    if (!m) continue;
    out.push({
      file: parsed.file,
      span: span(ln, m.index, parsed.lines[ln].length),
      severity: 'info',
      code: CODES.todo,
      message: parsed.lines[ln].replace(/^#@#\s*/, '').trim(),
    });
  }
  return out;
}

/** ファイル 1 本分の、索引全体を見なくてよい診断。 */
export function diagnoseFile(index: ReviewIndex, file: string): Diagnostic[] {
  const parsed = index.files.get(file);
  if (!parsed) return [];
  return [
    ...referenceDiagnostics(index, parsed),
    ...ruleDiagnostics(index, parsed),
    ...codeLineDiagnostics(index, parsed),
    ...tableWidthDiagnostics(index, parsed),
    ...todoDiagnostics(index, parsed),
  ];
}

/** ワークスペース全体。 */
export function diagnoseWorkspace(index: ReviewIndex): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const file of [...index.files.keys()].sort()) out.push(...diagnoseFile(index, file));
  out.push(...unreferencedTableDiagnostics(index));
  out.push(...duplicateIdDiagnostics(index));
  out.sort((a, b) =>
    a.file === b.file ? a.span.start.line - b.span.start.line || a.span.start.column - b.span.start.column : a.file < b.file ? -1 : 1
  );
  return out;
}
