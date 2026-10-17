// 参照が紙面でどう印刷されるか（`@<chap>` → 第3章、`@<hd>` → 「9.19 EXCEPT…」、`@<table>` → 表3.1、`@<fn>` → *2）。
// 編集画面（0.3.0）の参照の札に使う。原則は「畳んだ表示は紙面に出るものを出す」。
//
// 規則は Re:VIEW 2.5.0 に合わせた（推測しない）:
//   * 章の番号: `Book#parse_chapters` は CHAPS に 1 から、APPENDIX に 1 から（付録は `付録%pA` で A、B、…）、PREDEF・POSTDEF には
//     番号を付けない。`ChapterIndex#number` → `Chapter#format_number`: CHAPS は `第%d章`、APPENDIX は `付録%pA`、番号の無い章は ''
//   * 見出しの番号: `HeadlineIndex.parse`。ブロックの中と column の中と題の無い見出しを飛ばし、`==` を 0 段目として段ごとに数える
//     （`[nonum]` も数える）。`HeadlineIndex#number` は章の番号（付録は A）と段の番号を `.` でつなぐ。
//     `LATEXBuilder#inline_hd_chap`: 章に番号があり、番号の段の数が `secnolevel` 以下なら `「番号 題」`、それ以外は `「題」`
//   * 表・リスト・図: `Index.parse` は `//table`（`imgtable` も）、`//list`（`listnum` も）、`//image`（`graph`、`imgtable` も）を
//     章の中で前から 1、2、… と数え、`Builder#inline_table` などは `表` `リスト` `図` ＋ `章の番号.通し番号`
//   * 脚注: `LATEXBuilder#inline_fn` は参照の所に `\footnote` を出し、番号は LaTeX が付ける。jsbook は章ごとに 1 から数え、`*1` と印刷する
//     （book_mruby3.pdf p.46 の `*2` で確かめた）。だから `@<fn>` の参照の順（章の中で何番目の `@<fn>` か）
//
// 生成物の章（設定 `chapters` で元ファイルに読み替えた章。`book_mruby3` の `opcodes`）は、元ファイルの並びが紙面の並びと
// 同じとは限らないので、番号は `catalog.yml` が指す生成物（最後にビルドしたときのもの）を読んで数える。
import * as fs from 'node:fs';
import type { ReviewIndex } from './index.js';
import { parseReview } from './parser.js';
import type { ParsedFile } from './types.js';

export interface PrintedIndex {
  /** 章 ID → 印刷される章の番号（`第3章`、`付録A`）。番号の無い章は ''。 */
  chapterLabel: Map<string, string>;
  /** 章 ID → 番号の数字の部分（`3`、`A`）。番号の無い章は undefined。 */
  chapterNumber: Map<string, string | undefined>;
  /** `章ID|見出しの索引の鍵` → 段の番号（`[19]`、`[1, 2]`）。 */
  headings: Map<string, number[]>;
  /** `章ID\0list|table|image\0id` → 章の中の通し番号。 */
  blocks: Map<string, number>;
  /** `章ID\0脚注の id` → 章の中で何番目の `@<fn>` か（最初の参照）。 */
  footnotes: Map<string, number>;
}

/** Re:VIEW 2.5.0 の i18n.yml（ja）の `appendix: 付録%pA` の `%pA`（1 → A）。 */
function appendixLetter(n: number): string {
  return String.fromCharCode('A'.charCodeAt(0) + n - 1);
}

let generatedCache = new Map<string, { mtime: number; parsed: ParsedFile }>();

/** 生成物の章の生成物（`catalog.yml` が指すファイル）。無ければ undefined。 */
function generatedSource(index: ReviewIndex, id: string): ParsedFile | undefined {
  const chapter = index.chapters.get(id);
  if (!chapter?.generated) return undefined;
  const abs = index.abs(chapter.catalogFile);
  try {
    const mtime = fs.statSync(abs).mtimeMs;
    const cached = generatedCache.get(abs);
    if (cached && cached.mtime === mtime) return cached.parsed;
    const parsed = parseReview(chapter.catalogFile, fs.readFileSync(abs, 'utf8'), id);
    generatedCache.set(abs, { mtime, parsed });
    return parsed;
  } catch {
    return undefined;
  }
}

/** 章の中身（ファイルの並び）を数えて、見出し・ブロック・脚注の番号を out に入れる（すでにある鍵は上書きしない）。 */
function numberChapter(id: string, sources: ParsedFile[], out: PrintedIndex): void {
  const counters: number[] = [];
  const seq = { list: 0, table: 0, image: 0 };
  let fn = 0;
  const put = <T>(map: Map<string, T>, key: string, value: T) => {
    if (!map.has(key)) map.set(key, value);
  };
  for (const parsed of sources) {
    for (const h of parsed.headings) {
      if (h.indexId === undefined) continue; // `=`、column の中、題の無い見出し
      const level = h.level - 2;
      counters.length = Math.min(counters.length, level + 1);
      for (let i = 0; i <= level; i++) counters[i] ??= 0;
      counters[level]++;
      put(out.headings, `${id}|${h.indexId}`, counters.slice(0, level + 1));
    }
    for (const b of parsed.blocks) {
      if (!b.id) continue;
      const group = b.kind === 'list' ? 'list' : b.kind === 'table' || b.kind === 'imgtable' ? 'table' : b.kind === 'image' ? 'image' : undefined;
      if (!group) continue;
      seq[group]++;
      put(out.blocks, `${id}\u0000${group}\u0000${b.id}`, seq[group]);
      // `imgtable` は図の索引にも入る（Re:VIEW の ImageIndex は image|graph|imgtable）
      if (b.kind === 'imgtable') {
        seq.image++;
        put(out.blocks, `${id}\u0000image\u0000${b.id}`, seq.image);
      }
    }
    for (const r of parsed.refs) {
      if (r.op !== 'fn') continue;
      fn++;
      put(out.footnotes, `${id}\u0000${r.arg}`, fn);
    }
  }
}

/** テストで生成物の読み込みを捨てるため。 */
export function clearPrintedCache(): void {
  generatedCache = new Map();
}

export function buildPrintedIndex(index: ReviewIndex): PrintedIndex {
  const out: PrintedIndex = { chapterLabel: new Map(), chapterNumber: new Map(), headings: new Map(), blocks: new Map(), footnotes: new Map() };
  let chaps = 0;
  let appendix = 0;
  for (const id of index.chapterOrder) {
    const chapter = index.chapters.get(id)!;
    if (chapter.section === 'CHAPS') {
      chaps++;
      out.chapterNumber.set(id, String(chaps));
      out.chapterLabel.set(id, `第${chaps}章`);
    } else if (chapter.section === 'APPENDIX') {
      appendix++;
      out.chapterNumber.set(id, appendixLetter(appendix));
      out.chapterLabel.set(id, `付録${appendixLetter(appendix)}`);
    } else {
      out.chapterNumber.set(id, undefined);
      out.chapterLabel.set(id, '');
    }

    // 紙面の並びは生成物（あれば）。生成物に無い鍵（ビルドした後で足した見出しなど）は元ファイルの並びで数える
    const generated = generatedSource(index, id);
    if (generated) numberChapter(id, [generated], out);
    const chapterFiles = index.chapters.get(id)!.files.map((f) => index.files.get(f)).filter((p): p is ParsedFile => p !== undefined);
    numberChapter(id, chapterFiles, out);
  }
  return out;
}
