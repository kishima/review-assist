// マーカー（「AI にダブルチェックしてほしい」「後で読む」などの印）。
//
// 原稿（`.re`）には何も書かない。ワークスペースの `.review-assist/marks.json` に、選んだ文字列と
// その前後の文脈ごと保存し、原稿が変わったら文字列で位置を探し直す（W3C Web Annotation の
// TextQuoteSelector と同じ考え方）。AI との受け渡しもファイルで、拡張は依頼（`ai-check.md`）を
// 書き出し、結果（`ai-results.json`）を読むだけ。VS Code には依存しない（テストと CLI から使う）。
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ReviewIndex } from './index.js';
import { headingAt } from './pdfpages.js';
import type { Pos } from './types.js';

// ---------------------------------------------------------------------------
// 設定

export interface MarkKindConfig {
  /** 機械が読む名前（`marks.json` の `kind`）。 */
  id: string;
  /** コマンドとビューに出す名前。 */
  label: string;
  /** ガターの印と概要ルーラーの色（CSS の色）。 */
  color: string;
  /** 範囲の背景色（CSS の色。文字が読めるよう半透明にする）。 */
  background: string;
}

export interface MarksConfig {
  kinds: MarkKindConfig[];
  /** 保存先のディレクトリ（ワークスペース相対）。 */
  dir: string;
  /**
   * 保存する前後の文脈（`prefix` と `suffix`）の長さ（UTF-16 の文字数）。
   * 既定は book_mruby3 の git log の修正を当てて測って決めた（docs/design/thresholds.md）。
   */
  contextLength: number;
  /** AI への依頼に、選んだ所を含む段落の前後から何段落ずつ添えるか。 */
  contextParagraphs: number;
  /** AI への依頼に書き出す種類。 */
  aiKind: string;
  /** AI が読む手順の文書（ワークスペース相対）。依頼ファイルの先頭から指す。 */
  aiProcedure?: string;
}

/**
 * 既定の 2 種類。色は VS Code のマージの衝突の色（`merge.currentContentBackground` /
 * `merge.incomingContentBackground`: `#40C8AE` / `#40A6FF` を 0.5 × 0.4 = 0.2 の不透明度で。
 * microsoft/vscode `src/vs/platform/theme/common/colors/editorColors.ts`）を借りた。
 * 「下の文字と装飾を隠さない」ための半透明で、明暗どちらのテーマでも読める。0.2 は 0x33。
 */
export const DEFAULT_MARK_KINDS: readonly MarkKindConfig[] = [
  { id: 'ai-check', label: 'AI チェック', color: '#40C8AE', background: '#40C8AE33' },
  { id: 'read-later', label: '後で読む', color: '#40A6FF', background: '#40A6FF33' },
];

/**
 * 前後の文脈の既定の長さ。book_mruby3 の過去の修正 93 コミットに当てて、見失う・取り違える割合が
 * 下げ止まる所で決めた（docs/verification/marks-anchoring.md）。
 */
export const DEFAULT_CONTEXT_LENGTH = 32;

export function defaultMarksConfig(): MarksConfig {
  return {
    kinds: DEFAULT_MARK_KINDS.map((k) => ({ ...k })),
    dir: '.review-assist',
    contextLength: DEFAULT_CONTEXT_LENGTH,
    // 計画書の「選んだ文と前後の段落」= 前後 1 段落ずつ。
    contextParagraphs: 1,
    aiKind: 'ai-check',
  };
}

/** `.review-assist.json` の `marks` を読む。知らない項目と型の違う項目は既定値のまま。 */
export function readMarksConfig(raw: unknown): MarksConfig {
  const config = defaultMarksConfig();
  if (!raw || typeof raw !== 'object') return config;
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.kinds)) {
    const kinds: MarkKindConfig[] = [];
    for (const k of r.kinds) {
      if (!k || typeof k !== 'object') continue;
      const o = k as Record<string, unknown>;
      if (typeof o.id !== 'string' || o.id === '') continue;
      // 色を書かなかった種類は、同じ id の既定か、無ければ既定の 1 つ目の色を使う。
      const base = DEFAULT_MARK_KINDS.find((d) => d.id === o.id) ?? DEFAULT_MARK_KINDS[0];
      kinds.push({
        id: o.id,
        label: typeof o.label === 'string' ? o.label : o.id,
        color: typeof o.color === 'string' ? o.color : base.color,
        background: typeof o.background === 'string' ? o.background : base.background,
      });
    }
    if (kinds.length > 0) config.kinds = kinds;
  }
  if (typeof r.dir === 'string' && r.dir !== '') config.dir = r.dir;
  if (typeof r.contextLength === 'number' && r.contextLength >= 0) config.contextLength = Math.floor(r.contextLength);
  if (typeof r.contextParagraphs === 'number' && r.contextParagraphs >= 0) config.contextParagraphs = Math.floor(r.contextParagraphs);
  if (typeof r.aiKind === 'string') config.aiKind = r.aiKind;
  if (typeof r.aiProcedure === 'string') config.aiProcedure = r.aiProcedure;
  return config;
}

// ---------------------------------------------------------------------------
// 保存形式

export type MarkStatus = 'open' | 'done';

export interface Mark {
  id: string;
  kind: string;
  /** ワークスペース相対（区切りは `/`）。 */
  file: string;
  /** 選んだ文字列。 */
  quote: string;
  /** 選んだ所の直前 `contextLength` 文字。 */
  prefix: string;
  /** 選んだ所の直後 `contextLength` 文字。 */
  suffix: string;
  /** 選んだ所の最初の行（**1 起点**。人と AI が読むので）。位置を探すときの目安。 */
  line: number;
  note: string;
  /** ISO 8601。 */
  created: string;
  status: MarkStatus;
}

export interface MarksData {
  version: 1;
  marks: Mark[];
}

export const MARKS_FILE = 'marks.json';
export const REQUEST_FILE = 'ai-check.md';
export const RESULTS_FILE = 'ai-results.json';

export function emptyMarks(): MarksData {
  return { version: 1, marks: [] };
}

/** `marks.json` を読む。壊れた項目は落として `problems` に言う（ファイル全体は捨てない）。 */
export function parseMarks(text: string): { data: MarksData; problems: string[] } {
  const data = emptyMarks();
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { data, problems: [`JSON として読めない: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { marks?: unknown }).marks) ? (raw as { marks: unknown[] }).marks : undefined;
  if (!list) return { data, problems: ['"marks" の配列が無い'] };
  const seen = new Set<string>();
  list.forEach((m, i) => {
    const o = (m ?? {}) as Record<string, unknown>;
    const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : undefined);
    const id = str('id');
    const kind = str('kind');
    const file = str('file');
    const quote = str('quote');
    if (!id || !kind || !file || quote === undefined || quote === '') {
      problems.push(`${i + 1} 件目: id・kind・file・quote のどれかが無い`);
      return;
    }
    if (seen.has(id)) {
      problems.push(`${i + 1} 件目: id ${id} が二重`);
      return;
    }
    seen.add(id);
    data.marks.push({
      id,
      kind,
      file,
      quote,
      prefix: str('prefix') ?? '',
      suffix: str('suffix') ?? '',
      line: typeof o.line === 'number' && o.line >= 1 ? Math.floor(o.line) : 1,
      note: str('note') ?? '',
      created: str('created') ?? '',
      status: o.status === 'done' ? 'done' : 'open',
    });
  });
  return { data, problems };
}

export function serializeMarks(data: MarksData): string {
  return JSON.stringify(data, null, 2) + '\n';
}

export function marksPath(root: string, config: MarksConfig, name: string = MARKS_FILE): string {
  return path.join(root, ...config.dir.split('/'), name);
}

export function loadMarks(root: string, config: MarksConfig): { data: MarksData; path: string; problems: string[] } {
  const file = marksPath(root, config);
  if (!fs.existsSync(file)) return { data: emptyMarks(), path: file, problems: [] };
  return { ...parseMarks(fs.readFileSync(file, 'utf8')), path: file };
}

export function saveMarks(root: string, config: MarksConfig, data: MarksData): string {
  const file = marksPath(root, config);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeMarks(data));
  return file;
}

// ---------------------------------------------------------------------------
// 位置（文字列の中の offset と、0 起点の行・桁）

export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

export function posAt(text: string, offset: number, starts: number[] = lineStarts(text)): Pos {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, column: offset - starts[lo] };
}

export function offsetAt(text: string, pos: Pos, starts: number[] = lineStarts(text)): number {
  if (pos.line >= starts.length) return text.length;
  return Math.min(text.length, starts[Math.max(0, pos.line)] + pos.column);
}

const isLow = (c: number) => c >= 0xdc00 && c <= 0xdfff;
const isHigh = (c: number) => c >= 0xd800 && c <= 0xdbff;

/** `text[start, end)` の前後 `length` 文字。サロゲートの片割れは落とす。 */
export function contextAround(text: string, start: number, end: number, length: number): { prefix: string; suffix: string } {
  let ps = Math.max(0, start - length);
  if (ps > 0 && isLow(text.charCodeAt(ps))) ps++;
  let se = Math.min(text.length, end + length);
  if (se < text.length && isHigh(text.charCodeAt(se - 1))) se--;
  return { prefix: text.slice(ps, start), suffix: text.slice(end, se) };
}

/** 新しい id。`m` + 作った時刻（36 進）。同じ時刻に作ったら末尾に文字を足す。 */
export function newMarkId(now: Date, existing: Iterable<string>): string {
  const taken = new Set(existing);
  const base = `m${now.getTime().toString(36)}`;
  if (!taken.has(base)) return base;
  for (let n = 1; ; n++) {
    const id = `${base}-${n}`;
    if (!taken.has(id)) return id;
  }
}

export interface CaptureArgs {
  text: string;
  file: string;
  start: number;
  end: number;
  kind: string;
  note?: string;
  contextLength: number;
  now?: Date;
  existingIds?: Iterable<string>;
}

/** 選んだ範囲からマーカーを 1 件作る。範囲が空なら undefined。 */
export function captureMark(a: CaptureArgs): Mark | undefined {
  if (a.end <= a.start) return undefined;
  const now = a.now ?? new Date();
  const { prefix, suffix } = contextAround(a.text, a.start, a.end, a.contextLength);
  return {
    id: newMarkId(now, a.existingIds ?? []),
    kind: a.kind,
    file: a.file,
    quote: a.text.slice(a.start, a.end),
    prefix,
    suffix,
    line: posAt(a.text, a.start).line + 1,
    note: a.note ?? '',
    created: now.toISOString(),
    status: 'open',
  };
}

// ---------------------------------------------------------------------------
// 位置の探し直し

export type Anchor =
  /** `quote` がそのまま見つかった。 */
  | { kind: 'exact'; start: number; end: number }
  /** `quote` は無いが、前後の文脈に挟まれた所が見つかった（選んだ文の中が直された）。 */
  | { kind: 'fuzzy'; start: number; end: number }
  | { kind: 'lost' };

function indexesOf(text: string, needle: string): number[] {
  const out: number[] = [];
  if (needle === '') return out;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + 1)) out.push(i);
  return out;
}

function commonSuffixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a.charCodeAt(a.length - 1 - n) === b.charCodeAt(b.length - 1 - n)) n++;
  return n;
}

function commonPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a.charCodeAt(n) === b.charCodeAt(n)) n++;
  return n;
}

/** 段落の切れ目（空行）の数。 */
function paragraphBreaks(s: string): number {
  return (s.match(/\n[ \t]*\n/g) ?? []).length;
}

/**
 * マーカーの今の位置を探す。
 *
 * 1. `quote` がそのまま 1 か所にあれば、そこ。
 * 2. 何か所もあれば、前後の文脈がいちばん長く一致する所。同点なら `line` に近い所。
 * 3. 無ければ（選んだ文の中が直された）、`prefix` と `suffix` が両方そのまま残っていて、
 *    その間が空でなく、段落の切れ目を `quote` より多く含まない所。候補が複数なら
 *    長さが `quote` に近い所、次に `line` に近い所。
 * 4. どれでもなければ見失った（消さずに「見失った」と出す）。
 */
export function anchorMark(text: string, mark: Pick<Mark, 'quote' | 'prefix' | 'suffix' | 'line'>): Anchor {
  const { quote, prefix, suffix } = mark;
  const starts = lineStarts(text);
  const hint = starts[Math.min(starts.length - 1, Math.max(0, mark.line - 1))];
  const distance = (offset: number) => Math.abs(offset - hint);

  const hits = indexesOf(text, quote);
  if (hits.length === 1) return { kind: 'exact', start: hits[0], end: hits[0] + quote.length };
  if (hits.length > 1) {
    let best = hits[0];
    let bestScore = -1;
    for (const h of hits) {
      const before = text.slice(Math.max(0, h - prefix.length), h);
      const after = text.slice(h + quote.length, h + quote.length + suffix.length);
      const score = commonSuffixLength(prefix, before) + commonPrefixLength(suffix, after);
      if (score > bestScore || (score === bestScore && distance(h) < distance(best))) {
        best = h;
        bestScore = score;
      }
    }
    return { kind: 'exact', start: best, end: best + quote.length };
  }

  if (prefix === '' && suffix === '') return { kind: 'lost' };
  // prefix が空 = 付けたときファイルの先頭だった。suffix が空 = 末尾だった。
  const prefixEnds = prefix === '' ? [0] : indexesOf(text, prefix).map((p) => p + prefix.length);
  const suffixStarts = suffix === '' ? [text.length] : indexesOf(text, suffix);
  if (prefixEnds.length === 0 || suffixStarts.length === 0) return { kind: 'lost' };
  const allowedBreaks = paragraphBreaks(quote);
  let found: { start: number; end: number } | undefined;
  for (const pe of prefixEnds) {
    const s = suffixStarts.find((x) => x >= pe);
    if (s === undefined || s === pe) continue;
    if (paragraphBreaks(text.slice(pe, s)) > allowedBreaks) continue;
    if (
      !found ||
      Math.abs(s - pe - quote.length) < Math.abs(found.end - found.start - quote.length) ||
      (Math.abs(s - pe - quote.length) === Math.abs(found.end - found.start - quote.length) && distance(pe) < distance(found.start))
    ) {
      found = { start: pe, end: s };
    }
  }
  return found ? { kind: 'fuzzy', ...found } : { kind: 'lost' };
}

/**
 * 探し直した位置で `quote`・`prefix`・`suffix`・`line` を取り直す（保存のときに呼ぶ）。
 * 見失ったものは元のまま返す。直した後の文に追いつくので、次に原稿が変わっても探しやすい。
 */
export function refreshMark(text: string, mark: Mark, contextLength: number, anchor: Anchor = anchorMark(text, mark)): Mark {
  if (anchor.kind === 'lost') return mark;
  const { prefix, suffix } = contextAround(text, anchor.start, anchor.end, contextLength);
  return { ...mark, quote: text.slice(anchor.start, anchor.end), prefix, suffix, line: posAt(text, anchor.start).line + 1 };
}

// ---------------------------------------------------------------------------
// AI の結果

export type Verdict = 'ok' | 'fix' | 'question';
export const VERDICTS: readonly Verdict[] = ['ok', 'fix', 'question'];

export interface AiResult {
  id: string;
  verdict: Verdict;
  comment: string;
  /** 置き換え案（選んだ範囲をこれに置き換える）。 */
  suggestion?: string;
  /** AI が見た `quote`（依頼ファイルから写したもの）。今の文と違えば結果は古い。 */
  quote?: string;
}

export interface AiResultsLoad {
  results: Map<string, AiResult>;
  /** 読めなかった理由（ファイル全体または項目ごと）。 */
  problems: string[];
  /** `marks.json` に無い id（消したマーカーへの結果など）。 */
  unknownIds: string[];
}

/** `ai-results.json` を読む。壊れた JSON は結果 0 件と理由、壊れた項目はその項目だけ落とす。 */
export function parseAiResults(text: string, knownIds: Set<string>): AiResultsLoad {
  const out: AiResultsLoad = { results: new Map(), problems: [], unknownIds: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    out.problems.push(`JSON として読めない: ${e instanceof Error ? e.message : String(e)}`);
    return out;
  }
  const list = raw && typeof raw === 'object' && Array.isArray((raw as { results?: unknown }).results) ? (raw as { results: unknown[] }).results : undefined;
  if (!list) {
    out.problems.push('"results" の配列が無い');
    return out;
  }
  list.forEach((r, i) => {
    const o = (r ?? {}) as Record<string, unknown>;
    if (typeof o.id !== 'string') {
      out.problems.push(`${i + 1} 件目: id が無い`);
      return;
    }
    if (!VERDICTS.includes(o.verdict as Verdict)) {
      out.problems.push(`${o.id}: verdict は ok / fix / question のどれか（${JSON.stringify(o.verdict)} だった）`);
      return;
    }
    if (!knownIds.has(o.id)) {
      out.unknownIds.push(o.id);
      return;
    }
    out.results.set(o.id, {
      id: o.id,
      verdict: o.verdict as Verdict,
      comment: typeof o.comment === 'string' ? o.comment : '',
      ...(typeof o.suggestion === 'string' ? { suggestion: o.suggestion } : {}),
      ...(typeof o.quote === 'string' ? { quote: o.quote } : {}),
    });
  });
  return out;
}

export function loadAiResults(root: string, config: MarksConfig, knownIds: Set<string>): AiResultsLoad & { path: string; exists: boolean } {
  const file = marksPath(root, config, RESULTS_FILE);
  if (!fs.existsSync(file)) return { results: new Map(), problems: [], unknownIds: [], path: file, exists: false };
  return { ...parseAiResults(fs.readFileSync(file, 'utf8'), knownIds), path: file, exists: true };
}

export type SuggestionPlan =
  | { ok: true; start: number; end: number; replacement: string; /** AI が見た文と今の文が違う。 */ stale: boolean }
  | { ok: false; reason: string };

/** 「案を当てる」で何をどこに入れるか。当てたあとも自動で済みにはしない（著者が見て決める）。 */
export function planSuggestion(text: string, mark: Mark, result: AiResult | undefined): SuggestionPlan {
  if (!result) return { ok: false, reason: 'AI の結果がまだ無い' };
  if (result.suggestion === undefined) return { ok: false, reason: 'AI の結果に置き換え案（suggestion）が無い' };
  const anchor = anchorMark(text, mark);
  if (anchor.kind === 'lost') return { ok: false, reason: 'マーカーの位置を見失っている' };
  const current = text.slice(anchor.start, anchor.end);
  const seen = result.quote ?? mark.quote;
  return { ok: true, start: anchor.start, end: anchor.end, replacement: result.suggestion, stale: current !== seen };
}

// ---------------------------------------------------------------------------
// ビューの木（種類 → 章 → 項目）

export type MarkFilter = 'all' | 'open' | 'done';

export interface MarkGroup {
  kind: MarkKindConfig;
  chapters: { chapter: string; marks: Mark[] }[];
}

/** ビューに出す並び。種類は設定の順、章は catalog.yml の順（章に属さないファイルは最後）、項目はファイルと行の順。 */
export function groupMarks(data: MarksData, config: MarksConfig, filter: MarkFilter, chapterOf: (file: string) => string, chapterOrder: string[]): MarkGroup[] {
  const pass = (m: Mark) => filter === 'all' || m.status === filter;
  const rank = (c: string) => {
    const i = chapterOrder.indexOf(c);
    return i < 0 ? chapterOrder.length : i;
  };
  const kinds = [...config.kinds];
  // 設定から消した種類のマーカーも捨てずに出す。
  for (const m of data.marks) {
    if (!kinds.some((k) => k.id === m.kind)) kinds.push({ ...DEFAULT_MARK_KINDS[0], id: m.kind, label: m.kind });
  }
  const groups: MarkGroup[] = [];
  for (const kind of kinds) {
    const marks = data.marks.filter((m) => m.kind === kind.id && pass(m));
    if (marks.length === 0) continue;
    const byChapter = new Map<string, Mark[]>();
    for (const m of marks) {
      const c = chapterOf(m.file);
      byChapter.set(c, [...(byChapter.get(c) ?? []), m]);
    }
    const chapters = [...byChapter.entries()]
      .sort((a, b) => rank(a[0]) - rank(b[0]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([chapter, ms]) => ({ chapter, marks: ms.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1)) }));
    groups.push({ kind, chapters });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// AI への依頼

/** 0 起点の行 `line` を含む段落（空行で区切った行の並び）の [最初, 最後]。空行なら undefined。 */
function paragraphAt(lines: string[], line: number): [number, number] | undefined {
  const blank = (l: number) => lines[l].trim() === '';
  if (line < 0 || line >= lines.length || blank(line)) return undefined;
  let a = line;
  let b = line;
  while (a > 0 && !blank(a - 1)) a--;
  while (b < lines.length - 1 && !blank(b + 1)) b++;
  return [a, b];
}

/** 選んだ行を含む段落と、その前後 `n` 段落ずつの [最初, 最後]（0 起点）。 */
export function contextLines(lines: string[], startLine: number, endLine: number, n: number): [number, number] {
  let first = paragraphAt(lines, startLine)?.[0] ?? startLine;
  let last = paragraphAt(lines, endLine)?.[1] ?? endLine;
  for (let k = 0; k < n; k++) {
    let l = first - 1;
    while (l >= 0 && lines[l].trim() === '') l--;
    const p = paragraphAt(lines, l);
    if (!p) break;
    first = p[0];
  }
  for (let k = 0; k < n; k++) {
    let l = last + 1;
    while (l < lines.length && lines[l].trim() === '') l++;
    const p = paragraphAt(lines, l);
    if (!p) break;
    last = p[1];
  }
  return [first, last];
}

/** 中身に含まれるどの連続した ` よりも長い囲み（CommonMark: 3 個以上で、中の連続より長いこと）。 */
export function fenceFor(body: string): string {
  let longest = 0;
  for (const m of body.matchAll(/`+/g)) longest = Math.max(longest, m[0].length);
  return '`'.repeat(Math.max(3, longest + 1));
}

function fenced(body: string, lang: string): string {
  const f = fenceFor(body);
  return `${f}${lang}\n${body}\n${f}`;
}

export interface RequestOptions {
  /** ファイルの今の中身。既定は索引の行（エディタで開いているものは拡張が updateFile 済み）。 */
  textOf?: (file: string) => string | undefined;
  now?: Date;
}

export interface AiRequest {
  markdown: string;
  /** 依頼に入れたマーカー。 */
  ids: string[];
  /** そのうち位置を見失っていたもの。 */
  lost: string[];
}

/**
 * `status: open` の `aiKind` のマーカーを、AI が 1 件ずつ読める Markdown にする。
 * 1 件ごとに id、章とファイルと行、見出しの道筋、メモ、選んだ文、前後の段落。
 * 先頭で手順の文書（設定 `aiProcedure`）を指し、末尾に結果の JSON の雛形を付ける。
 */
export function buildAiRequest(index: ReviewIndex, data: MarksData, config: MarksConfig, options: RequestOptions = {}): AiRequest {
  const textOf =
    options.textOf ??
    ((file: string) => {
      const parsed = index.files.get(file);
      if (parsed) return parsed.lines.join('\n');
      const abs = index.abs(file);
      return fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
    });
  const now = options.now ?? new Date();
  const marks = data.marks
    .filter((m) => m.kind === config.aiKind && m.status === 'open')
    .sort((a, b) => {
      // 章は catalog.yml の順、章に属さないファイルは最後。
      const rank = (file: string) => {
        const i = index.chapterOrder.indexOf(index.chapterOfFile(file));
        return i < 0 ? index.chapterOrder.length : i;
      };
      return rank(a.file) - rank(b.file) || (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1);
    });
  const resultsRel = `${config.dir}/${RESULTS_FILE}`;
  const out: string[] = [];
  const lost: string[] = [];
  const skeleton: Record<string, string>[] = [];
  const sections: string[] = [];

  for (const m of marks) {
    const text = textOf(m.file);
    const anchor = text === undefined ? ({ kind: 'lost' } as const) : anchorMark(text, m);
    const s: string[] = [];
    s.push(`## ${m.id}`, '');
    const chapter = index.chapterOfFile(m.file);
    if (anchor.kind === 'lost' || text === undefined) {
      lost.push(m.id);
      s.push(`- 章: ${chapter || '（catalog.yml に無いファイル）'}`);
      s.push(`- 場所: ${m.file}:${m.line}（付けたときの行。**今は位置を見失っている**。原稿が直されて、選んだ文も前後も変わった）`);
      if (m.note) s.push(`- メモ: ${m.note}`);
      s.push('', '### 選んだ文（付けたとき）', '', fenced(m.quote, 'review'), '');
      skeleton.push({ id: m.id, quote: m.quote, verdict: '', comment: '' });
      sections.push(s.join('\n'));
      continue;
    }
    const starts = lineStarts(text);
    const startPos = posAt(text, anchor.start, starts);
    const endPos = posAt(text, Math.max(anchor.start, anchor.end - 1), starts);
    const quote = text.slice(anchor.start, anchor.end);
    const heading = index.files.has(m.file) ? headingAt(index, m.file, startPos.line) : undefined;
    const lines = text.split(/\r?\n/);
    const [first, last] = contextLines(lines, startPos.line, endPos.line, config.contextParagraphs);
    s.push(`- 章: ${chapter || '（catalog.yml に無いファイル）'}`);
    s.push(`- 場所: ${m.file}:${startPos.line + 1}${endPos.line > startPos.line ? `–${endPos.line + 1}` : ''}`);
    // path は抜けた段を空文字で持つ（`=` の無い sub-article など）ので詰める。
    const trail = heading?.path.filter((t) => t !== '') ?? [];
    if (trail.length > 0) s.push(`- 見出し: ${trail.join(' > ')}`);
    if (m.note) s.push(`- メモ: ${m.note}`);
    if (anchor.kind === 'fuzzy') s.push(`- 注: マーカーを付けた後で選んだ文が直されている（付けたときは「${m.quote.replace(/\n/g, ' ')}」）`);
    s.push('', '### 選んだ文', '', fenced(quote, 'review'), '');
    s.push(`### 前後（${m.file}:${first + 1}–${last + 1}）`, '', fenced(lines.slice(first, last + 1).join('\n'), 'review'), '');
    skeleton.push({ id: m.id, quote, verdict: '', comment: '' });
    sections.push(s.join('\n'));
  }

  out.push('# AI チェックの依頼', '');
  out.push(`<!-- review-assist が ${now.toISOString()} に書き出した。手で直さない（書き出し直すと上書きされる）。 -->`, '');
  if (config.aiProcedure) {
    out.push(`**先に手順 \`${config.aiProcedure}\` を読むこと。** 何を確かめるか、どこまで調べるかはそこにある。`, '');
  }
  out.push(`- 件数: ${marks.length}${lost.length > 0 ? `（うち位置を見失ったもの ${lost.length}）` : ''}`);
  out.push(`- 結果の書き先: \`${resultsRel}\`（ワークスペース直下から）`);
  out.push('- 原稿（`.re`）は直さない。直す案は結果の `suggestion` に書く', '');
  out.push('## 結果の書き方', '');
  out.push('1 件ごとに次の項目を持つ JSON。末尾の雛形を埋めて書く。', '');
  out.push('| 項目 | 必須 | 中身 |', '|---|---|---|');
  out.push('| `id` | 必須 | 下の `## m...` の見出し |');
  out.push('| `quote` | 推奨 | 雛形のまま残す（「選んだ文」の写し。拡張はこれで結果が古くなったかを見る） |');
  out.push('| `verdict` | 必須 | `ok`（直さなくてよい）／`fix`（直すべき）／`question`（著者に確かめたい） |');
  out.push('| `comment` | 必須 | 判断の理由。確かめた根拠（ファイルと行、実行した結果）を書く |');
  out.push('| `suggestion` | 任意 | 選んだ文をそっくり置き換える文字列（前後は含めない）。`fix` のとき（`question` でも案があれば） |');
  out.push('', '---', '');
  out.push(...sections);
  out.push('---', '', '## 結果の雛形', '', fenced(JSON.stringify({ version: 1, results: skeleton }, null, 2), 'json'), '');
  return { markdown: out.join('\n'), ids: marks.map((m) => m.id), lost };
}

export function writeAiRequest(root: string, config: MarksConfig, request: AiRequest): string {
  const file = marksPath(root, config, REQUEST_FILE);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, request.markdown);
  return file;
}
