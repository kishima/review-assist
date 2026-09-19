// 診断。索引を受け取って、ファイル 1 本分の診断を作る（段階 1: 参照）。
import type { ReviewIndex } from './index.js';
import { resolveRefDetailed, isReferenceOp, splitChapterPrefix } from './resolve.js';
import type { Diagnostic, ParsedFile, Span } from './types.js';

export const CODES = {
  brokenRef: 'broken-ref',
  unknownChapter: 'unknown-chapter',
  ambiguousRef: 'ambiguous-ref',
  unreferencedTable: 'unreferenced-table',
  duplicateId: 'duplicate-id',
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

/** ファイル 1 本分の、索引全体を見なくてよい診断。 */
export function diagnoseFile(index: ReviewIndex, file: string): Diagnostic[] {
  const parsed = index.files.get(file);
  if (!parsed) return [];
  return referenceDiagnostics(index, parsed);
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
