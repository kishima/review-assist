// `@<...>{...}` を索引の中の場所に対応づける。
//
// 規則は推測せず、Re:VIEW 2.5.0 の実装（`lib/review/builder.rb` の `inline_hd`、
// `lib/review/book/index.rb` の `Index#[]` と `HeadlineIndex.parse`）に合わせてある。
//
//   * `inline_hd(id)`: 先頭の `|` **1 個だけ**で分ける。前半が章 ID なら、その章に残り全部を
//     渡す。章 ID でなければ、その参照が書かれている章に id をそのまま渡す
//   * headline index の鍵は「`==` から数えた見出しの道を `|` でつないだもの」で、各段は
//     ラベルがあればラベル、無ければ見出しの文字列。`=`（章の題）は入らない
//   * `Index#[]` の引き方: ① 鍵と完全一致 → ② 一致しないとき、どれかの鍵の**最後の段**が
//     id と等しいものが 2 つ以上あれば「曖昧」で失敗 → ③ 鍵をどれか 1 段でも含むものの最初
//
// ③ があるので `@<hd>{chap_LAMBDA}`（道の途中の段）でも引ける。逆に `@<hd>{補足}` のように
// どの記事にもある段を指すと ② で落ちる。ここでは ② を error として報告する。
import type { Block, BlockKind, Heading, InlineRef } from './types.js';
import type { Chapter, ReviewIndex, Target } from './index.js';

/** 参照を持つインライン命令と、その先のブロックの種類（Re:VIEW の *Index の item_type）。 */
const BLOCK_REF_KINDS: Record<string, BlockKind[]> = {
  // ListIndex: (list|listnum)。`//emlist` `//cmd` `//source` は索引に入らない
  list: ['list'],
  // TableIndex: (table|imgtable)
  table: ['table', 'imgtable'],
  // Chapter#image は ImageIndex(image|graph|imgtable) → IconIndex → NumberlessImageIndex →
  // IndepImageIndex の順に引く
  img: ['image', 'imgtable', 'indepimage'],
  fn: ['footnote'],
};

export const REFERENCE_OPS = new Set(['chap', 'chapref', 'title', 'hd', 'list', 'table', 'img', 'fn']);

export function isReferenceOp(op: string): boolean {
  return REFERENCE_OPS.has(op);
}

/**
 * `inline_hd` と同じ分け方。先頭の `|` 1 個だけで切り、前半が章 ID のときだけ章として扱う。
 */
export function splitChapterPrefix(index: ReviewIndex, arg: string): { chapter?: string; rest: string } {
  const m = /^([^|]+)\|(.+)$/.exec(arg);
  if (m && index.chapters.has(m[1])) return { chapter: m[1], rest: m[2] };
  return { rest: arg };
}

function chaptersToSearch(index: ReviewIndex, ref: InlineRef, explicit?: string): Chapter[] {
  if (explicit) {
    const c = index.chapters.get(explicit);
    return c ? [c] : [];
  }
  const own = index.chapterOfFile(ref.file);
  if (own) {
    const c = index.chapters.get(own);
    if (c) return [c];
  }
  // 章に属さないファイル（catalog.yml に無い `.re`）。Re:VIEW では起こらないが、
  // 書きかけのファイルでも参照をたどれるように全章を順に見る。
  return index.chapterOrder.map((id) => index.chapters.get(id)!).filter(Boolean);
}

export type LookupResult<T> = { kind: 'hit'; item: T; via: string } | { kind: 'ambiguous' } | { kind: 'miss' };

/**
 * Re:VIEW の `Index#[]`。`ids` は索引の鍵（`|` でつないだ道）。
 */
export function lookupIndex<T>(items: { id: string; item: T }[], key: string): LookupResult<T> {
  const exact = items.find((i) => i.id === key);
  if (exact) return { kind: 'hit', item: exact.item, via: 'exact' };

  // 最後の段が key と等しい鍵が 2 つ以上 → 曖昧
  let lastSegmentHits = 0;
  for (const i of items) {
    const segments = i.id.split('|');
    if (segments[segments.length - 1] === key) lastSegmentHits++;
  }
  if (lastSegmentHits > 1) return { kind: 'ambiguous' };

  const partial = items.find((i) => i.id.split('|').includes(key));
  if (partial) return { kind: 'hit', item: partial.item, via: 'segment' };
  return { kind: 'miss' };
}

function headingItems(index: ReviewIndex, chapter: Chapter): { id: string; item: Heading }[] {
  const out: { id: string; item: Heading }[] = [];
  for (const h of index.headingsOfChapter(chapter.id)) {
    if (h.indexId === undefined) continue;
    out.push({ id: h.indexId, item: h });
  }
  return out;
}

function blockItems(index: ReviewIndex, chapter: Chapter, kinds: BlockKind[]): { id: string; item: Block }[] {
  const out: { id: string; item: Block }[] = [];
  for (const b of index.blocksOfChapter(chapter.id)) {
    if (!b.id || !kinds.includes(b.kind)) continue;
    out.push({ id: b.id, item: b });
  }
  return out;
}

export type ResolveOutcome = { kind: 'hit'; target: Target } | { kind: 'ambiguous' } | { kind: 'miss' };

export function resolveRefDetailed(index: ReviewIndex, ref: InlineRef): ResolveOutcome {
  if (!isReferenceOp(ref.op)) return { kind: 'miss' };

  if (ref.op === 'chap' || ref.op === 'chapref' || ref.op === 'title') {
    const chapter = index.chapters.get(ref.arg);
    if (!chapter) return { kind: 'miss' };
    const file = chapter.files[0] ?? chapter.catalogFile;
    return { kind: 'hit', target: { kind: 'chapter', file, chapter, via: 'catalog' } };
  }

  const { chapter: explicit, rest } = splitChapterPrefix(index, ref.arg);
  const candidates = chaptersToSearch(index, ref, explicit);
  let ambiguous = false;

  for (const chapter of candidates) {
    if (ref.op === 'hd') {
      const r = lookupIndex(headingItems(index, chapter), rest);
      if (r.kind === 'hit') return { kind: 'hit', target: { kind: 'heading', file: r.item.file, heading: r.item, chapter, via: r.via } };
      if (r.kind === 'ambiguous') ambiguous = true;
      continue;
    }
    const kinds = BLOCK_REF_KINDS[ref.op];
    if (!kinds) return { kind: 'miss' };
    const r = lookupIndex(blockItems(index, chapter, kinds), rest);
    if (r.kind === 'hit') return { kind: 'hit', target: { kind: 'block', file: r.item.file, block: r.item, chapter, via: r.via } };
    if (r.kind === 'ambiguous') ambiguous = true;
  }
  return ambiguous ? { kind: 'ambiguous' } : { kind: 'miss' };
}

export function resolveRef(index: ReviewIndex, ref: InlineRef): Target | undefined {
  const r = resolveRefDetailed(index, ref);
  return r.kind === 'hit' ? r.target : undefined;
}

/** ホバーに出す、対象の見出し・ブロックの説明。 */
export function describeTarget(index: ReviewIndex, target: Target): string[] {
  const lines: string[] = [];
  if (target.kind === 'chapter') {
    lines.push(`**章 \`${target.chapter.id}\`**`);
    const top = index.headingsOfChapter(target.chapter.id).find((h) => h.level === 1);
    if (top) lines.push(top.plainTitle);
    lines.push(`\`${target.chapter.files.join('`, `')}\``);
    return lines;
  }
  if (target.heading) {
    const h = target.heading;
    lines.push(`**${'='.repeat(h.level)} ${h.plainTitle}**`);
    if (h.path.length > 1) lines.push(h.path.slice(0, -1).join(' > '));
    lines.push(`\`${h.file}:${h.span.start.line + 1}\``);
    return lines;
  }
  if (target.block) {
    const b = target.block;
    lines.push(`**//${b.kind}[${b.id ?? ''}]**`);
    if (b.caption) lines.push(b.caption);
    lines.push(`\`${b.file}:${b.span.start.line + 1}\``);
    return lines;
  }
  return lines;
}

/** `imagePreview` のパスを作る。`//image` の id とその章から。 */
export function imagePreviewPath(index: ReviewIndex, block: Block): string | undefined {
  const template = index.config.imagePreview;
  if (!template || !block.id) return undefined;
  return template.replace(/\{chapter\}/g, block.chapter).replace(/\{id\}/g, block.id);
}
