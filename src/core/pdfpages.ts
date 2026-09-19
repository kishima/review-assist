// 「この節を PDF で開く」の判断。索引 JSON（本側の `tools/pdf_pages.py` が作る）から、
// カーソル位置の見出しに当たるページ番号を引く。
//
// 索引 JSON の鍵は Re:VIEW の headline index と同じ作り方で、`章ID`（章の題）か
// `章ID|見出しの鍵` の形（`docs/design/review-syntax.md`）。原稿の見出しから同じ鍵を
// 組み立てて引くので、両側で規則が食い違わなければページが出る。
//
// 見出しが索引に無いとき（本を組んだあとに足した節など）は、その見出しの**上の段**、
// 最後は章の先頭へ落とす。「開いたが少し手前だった」ほうが「開けない」より使えるため。
import * as fs from 'node:fs';
import type { ReviewIndex } from './index.js';
import type { Heading } from './types.js';

/** 索引 JSON の中身。鍵 → ページ番号（1 起点。PDF ビューアの `#page=` と同じ）。 */
export type PageIndex = Record<string, number>;

export interface PageIndexLoad {
  pages?: PageIndex;
  /** 読もうとしたパス（ワークスペース相対）。設定が無ければ undefined。 */
  path?: string;
  /** `not-configured` = 設定 `pageIndex` が無い、`missing` = ファイルが無い、`broken` = 壊れている。 */
  problem?: 'not-configured' | 'missing' | 'broken';
  error?: string;
}

export function loadPageIndex(index: ReviewIndex): PageIndexLoad {
  const rel = index.config.pageIndex;
  if (!rel) return { problem: 'not-configured' };
  const abs = index.abs(rel);
  if (!fs.existsSync(abs)) return { path: rel, problem: 'missing' };
  try {
    const raw = JSON.parse(fs.readFileSync(abs, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { path: rel, problem: 'broken', error: '中身が { "鍵": ページ } の形でない' };
    }
    const pages: PageIndex = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) pages[key] = value;
    }
    return { pages, path: rel };
  } catch (e) {
    return { path: rel, problem: 'broken', error: e instanceof Error ? e.message : String(e) };
  }
}

/** その行から見て直近の（その行を含む、それより上の）見出し。 */
export function headingAt(index: ReviewIndex, file: string, line: number): Heading | undefined {
  const parsed = index.files.get(file);
  if (!parsed) return undefined;
  let found: Heading | undefined;
  for (const h of parsed.headings) {
    if (h.span.start.line > line) break;
    found = h;
  }
  return found;
}

/**
 * 索引 JSON を引く鍵の候補を、近いものから順に返す。
 * 見出し → その上の段 → … → 章の先頭。
 */
export function pageKeys(index: ReviewIndex, file: string, line: number): string[] {
  const chapter = index.chapterOfFile(file);
  if (!chapter) return [];
  const keys: string[] = [];
  const heading = headingAt(index, file, line);
  if (heading?.indexId) {
    const segments = heading.indexId.split('|');
    for (let n = segments.length; n > 0; n--) keys.push(`${chapter}|${segments.slice(0, n).join('|')}`);
  }
  keys.push(chapter);
  return keys;
}

export type PageLookup =
  | { kind: 'ok'; page: number; key: string; via: 'heading' | 'ancestor' | 'chapter'; heading?: Heading }
  /** そのファイルが章に属していない（`catalog.yml` に無い）。 */
  | { kind: 'no-chapter' }
  /** 章も見出しも索引 JSON に無い。 */
  | { kind: 'not-found'; keys: string[] };

export function lookupPage(index: ReviewIndex, pages: PageIndex, file: string, line: number): PageLookup {
  const keys = pageKeys(index, file, line);
  if (keys.length === 0) return { kind: 'no-chapter' };
  const heading = headingAt(index, file, line);
  for (let i = 0; i < keys.length; i++) {
    const page = pages[keys[i]];
    if (page === undefined) continue;
    const via = i === 0 && heading?.indexId ? 'heading' : i === keys.length - 1 ? 'chapter' : 'ancestor';
    return { kind: 'ok', page, key: keys[i], via, heading };
  }
  return { kind: 'not-found', keys };
}

/** 設定 `pdf` の指す PDF（ワークスペース相対）。無ければ undefined。 */
export function pdfRelPath(index: ReviewIndex): string | undefined {
  return index.config.pdf;
}
