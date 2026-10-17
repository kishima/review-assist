// 本の PDF を測って、編集画面の「紙面に近い見た目」（設定 editor.page）の値を出す。
//
//   node tools/measure-page.mjs <本のディレクトリ> [--json <出力>]
//
// 読むのは .review-assist.json の pdf と pageIndex、それに索引（見出しの題とページ）。PDF の文字の位置・大きさ・
// 書体は pdf.js（pdfjs-dist、devDependencies）で取る。数はどれも PDF の pt（1/72 インチ）で、比は本文の和文の
// 大きさ（1zw）に対するもの。編集画面は 1zw を VS Code のエディタの文字の大きさに当て、ほかを比で決める。
//
// 測るもの:
//   本文: 和文の大きさ（1zw）、欧文の大きさ、行の送り、1 行の幅（両端をそろえた行の幅）
//   見出し: 深さごとの和文・欧文の大きさ（索引のページで、見出しの題で終わる太字のゴシックの行を探す）
//   コード: 等幅の大きさと行の送り、コードの中の和文の大きさ
//   表: セルの文字の大きさ（原稿の表のセルの文字列を PDF で探す）
//   書体: 本文・見出し・コード・表に使われている書体の名前
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, '..', 'dist', 'core.js'));
const pdfjs = await import(path.join(here, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));

const args = process.argv.slice(2);
const root = path.resolve(args[0] ?? '');
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : undefined;
const index = new core.ReviewIndex(root);
index.build();
const pdfRel = index.config.pdf;
if (!pdfRel) throw new Error('.review-assist.json に pdf がありません');
const pageLoad = core.loadPageIndex(index);
if (!pageLoad.pages) throw new Error(`pageIndex が読めません（${pageLoad.problem}）`);
const pagesJson = pageLoad.pages;

const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(index.abs(pdfRel))), disableFontFace: true, verbosity: 0 }).promise;

// 書体の名前（`ABCDEF+NotoSerifCJKjp-Regular-Identity-H` → `NotoSerifCJKjp-Regular`）
const cleanFont = (n) => n.replace(/^[A-Z]{6}\+/, '').replace(/-Identity-H$/, '');
const isCjk = (s) => /[぀-ヿ㐀-鿿＀-￯⺀-⿟]/.test(s);
const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '');

/** ページの文字の並び（行ごと）。行は y が同じ（0.5pt 以内）もの。 */
const pageCache = new Map();
async function linesOf(n) {
  if (pageCache.has(n)) return pageCache.get(n);
  const page = await doc.getPage(n);
  await page.getOperatorList();
  const tc = await page.getTextContent();
  const items = [];
  for (const it of tc.items) {
    if (!it.str || !it.str.trim()) continue;
    let font = it.fontName;
    try {
      font = cleanFont(page.commonObjs.get(it.fontName).name);
    } catch {
      /* 名前が取れない書体はそのまま */
    }
    items.push({ str: it.str, x: it.transform[4], y: it.transform[5], size: +it.transform[3].toFixed(2), w: it.width, font });
  }
  const lines = [];
  for (const it of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const l = lines.find((x) => Math.abs(x.y - it.y) < 0.5);
    if (l) l.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.text = l.items.map((i) => i.str).join('');
    l.x0 = Math.min(...l.items.map((i) => i.x));
    l.x1 = Math.max(...l.items.map((i) => i.x + i.w));
  }
  pageCache.set(n, lines);
  return lines;
}

/** 値の出現回数でいちばん多いもの（小数第 2 位で丸める）と、その件数・全体の件数。 */
function mode(values) {
  const c = new Map();
  for (const v of values) {
    const k = +v.toFixed(2);
    c.set(k, (c.get(k) ?? 0) + 1);
  }
  let best;
  for (const [k, n] of c) if (!best || n > best.n) best = { value: k, n };
  return best ? { ...best, of: values.length } : undefined;
}

// 本文のページ: 最初の章から最後の章まで（前付けと目次を外す）
const chapterPages = index.chapterOrder.map((id) => pagesJson[id]).filter((p) => typeof p === 'number');
const firstPage = Math.min(...chapterPages);
const lastPage = doc.numPages;

const body = { cjk: [], latin: [], pitch: [], width: [], inlineMono: [], x0: [] };
const captions = { cjk: [], latin: [], fonts: new Map() };
const code = { mono: [], cjk: [], pitch: [], fonts: new Map() };
const fontsUsed = { body: new Map(), latin: new Map(), code: new Map() };
const bump = (m, k) => m.set(k, (m.get(k) ?? 0) + 1);

for (let n = firstPage; n <= lastPage; n++) {
  const lines = await linesOf(n);
  let prevBody;
  for (const l of lines) {
    const fonts = new Set(l.items.map((i) => i.font));
    const serif = l.items.filter((i) => /SerifCJK.*Regular/.test(i.font));
    // キャプション（Re:VIEW Starter は「▼表 3.1: …」「▼リスト 3.1: …」）
    if (l.text.startsWith('▼')) {
      for (const i of l.items) {
        if (i.str.startsWith('▼')) continue;
        (isCjk(i.str) ? captions.cjk : captions.latin).push(i.size);
        bump(captions.fonts, i.font);
      }
    }
    // 行頭が等幅の書体の行（コードか、インラインのコードで始まる地の文）は本文に数えない。コードは下で別に数える
    if (/Mono/.test(l.items[0].font)) {
      prevBody = undefined;
      continue;
    }
    // 本文の行: 明朝の和文があり、ゴシック（見出し・キャプション・柱）が無い
    if (serif.length === 0 || [...fonts].some((f) => /Sans(?!Mono)|NimbusSan/.test(f))) {
      prevBody = undefined;
      continue;
    }
    for (const i of serif) {
      body.cjk.push(i.size);
      bump(fontsUsed.body, i.font);
    }
    for (const i of l.items) {
      if (/Mono/.test(i.font)) body.inlineMono.push(i.size);
      if (!isCjk(i.str) && /LMRoman/.test(i.font)) {
        body.latin.push(i.size);
        bump(fontsUsed.latin, i.font);
      }
    }
    body.width.push(l.x1 - l.x0);
    body.x0.push(l.x0);
    if (prevBody && prevBody.y - l.y < 2.5 * serif[0].size) body.pitch.push(prevBody.y - l.y);
    prevBody = l;
  }
}

const zw = mode(body.cjk);

// コードの行: 行頭が等幅の書体で、本文の大きさの明朝の和文を含まない（含むならインラインのコードで始まる地の文）
for (let n = firstPage; n <= lastPage; n++) {
  const lines = await linesOf(n);
  let prevCode;
  for (const l of lines) {
    const isCode =
      /Mono/.test(l.items[0].font) && !l.items.some((i) => /SerifCJK/.test(i.font) && Math.abs(i.size - zw.value) < 0.05) && !l.items.some((i) => /Bold/.test(i.font) && !/Mono/.test(i.font));
    if (!isCode) {
      prevCode = undefined;
      continue;
    }
    for (const i of l.items) {
      if (/Mono/.test(i.font)) code.mono.push(i.size);
      else if (isCjk(i.str)) {
        code.cjk.push(i.size);
        bump(code.fonts, i.font);
      }
      bump(fontsUsed.code, i.font);
    }
    if (prevCode && prevCode.y - l.y < 3 * l.items[0].size) code.pitch.push(prevCode.y - l.y);
    prevCode = l;
  }
}
const latin = mode(body.latin);
const pitch = mode(body.pitch);
// 両端をそろえた行（段落の途中の行）の幅は本文の幅にそろう。いちばん多い幅を本文の幅とする。
const width = mode(body.width.filter((w) => w > 30 * zw.value));

// 見出し: 索引のページで、題で終わる行を探す
const headingSizes = new Map();
const headingFonts = new Map();
let headingTried = 0;
let headingFound = 0;
for (const [rel, parsed] of index.files) {
  for (const h of parsed.headings) {
    if (!h.plainTitle) continue;
    const chapter = index.chapterOfFile(rel);
    const key = h.level === 1 ? chapter : h.indexId ? `${chapter}|${h.indexId}` : undefined;
    const page = key && pagesJson[key];
    if (!page) continue;
    headingTried++;
    const want = norm(h.plainTitle);
    const lines = await linesOf(page);
    const hit = lines.find((l) => {
      const t = norm(l.text);
      // 太字のゴシック（柱は同じ題を細いゴシックで出すので外れる）
      return t.endsWith(want) && l.items.some((i) => /Sans.*Bold/.test(i.font) && isCjk(i.str));
    });
    if (!hit) continue;
    headingFound++;
    const cjk = hit.items.filter((i) => isCjk(i.str) && /Sans.*Bold/.test(i.font));
    const lat = hit.items.filter((i) => !isCjk(i.str) && /NimbusSan.*Bold/.test(i.font));
    const e = headingSizes.get(h.level) ?? { cjk: [], latin: [] };
    for (const i of cjk) e.cjk.push(i.size);
    for (const i of lat) e.latin.push(i.size);
    headingSizes.set(h.level, e);
    for (const i of hit.items) bump(headingFonts, i.font);
  }
}

// 表: 原稿の表のセルで、和文を 4 文字以上含み、本の中で 1 回しか出ない文字列を PDF で探す
const cellTexts = new Map();
for (const parsed of index.files.values()) {
  for (const b of parsed.blocks) {
    if (b.kind !== 'table') continue;
    for (const row of b.body) {
      if (/^[=-]{12}/.test(row)) continue;
      for (const c of row.split(/\t+/)) {
        const t = core.stripInline(c).replace(/^\./, '');
        if ((t.match(/[぀-ヿ一-鿿]/g) ?? []).length >= 4) cellTexts.set(norm(t), (cellTexts.get(norm(t)) ?? 0) + 1);
      }
    }
  }
}
const uniqueCells = [...cellTexts].filter(([, n]) => n === 1).map(([t]) => t);
const table = { cjk: [], pitch: [], fonts: new Map() };
let cellFound = 0;
const cellSet = new Set(uniqueCells);
for (let n = firstPage; n <= lastPage; n++) {
  const lines = await linesOf(n);
  for (const l of lines) {
    for (const i of l.items) {
      if (!cellSet.has(norm(i.str))) continue;
      cellFound++;
      table.cjk.push(i.size);
      bump(table.fonts, i.font);
    }
  }
}
// 表の行の送り: 表のセルの大きさの和文だけの行が続くところ。
// 列の間: 続いた行を 1 つの表とみなし、行の中で前の文字の終わりから表の 1zw より離れて始まる文字を「セルの始まり」とする。
// 同じ x で始まるセルを同じ列とし、列ごとに「前の列の文字の終わりからの距離」の最小を取る（いちばん広いセルの後ろの間 = 列の間）。
const tableSize = mode(table.cjk);
const colGaps = [];
for (let n = firstPage; n <= lastPage && tableSize; n++) {
  const lines = await linesOf(n);
  let prev;
  let rows = [];
  const flush = () => {
    if (rows.length >= 2) {
      const minGap = new Map();
      for (const row of rows) {
        let end = row.items[0].x + row.items[0].w;
        for (const it of row.items.slice(1)) {
          const gap = it.x - end;
          if (gap > tableSize.value) {
            const key = Math.round(it.x);
            minGap.set(key, Math.min(minGap.get(key) ?? Infinity, gap));
          }
          end = Math.max(end, it.x + it.w);
        }
      }
      for (const g of minGap.values()) colGaps.push(g);
    }
    rows = [];
  };
  for (const l of lines) {
    // 表の行: 和文がどれも表のセルの大きさで、和文が 1 つはあり、行頭が等幅でない（コードの行を外す）
    const isRow =
      !/Mono/.test(l.items[0].font) &&
      l.items.some((i) => isCjk(i.str)) &&
      l.items.every((i) => (isCjk(i.str) ? Math.abs(i.size - tableSize.value) < 0.05 : i.size < zw.value * 1.2));
    if (isRow && prev && prev.y - l.y < 2.5 * tableSize.value) table.pitch.push(prev.y - l.y);
    if (isRow) rows.push({ items: l.items.filter((i) => i.str.trim()) });
    else flush();
    prev = isRow ? l : undefined;
  }
  flush();
}
const colGap = mode(colGaps);

// 段落の頭の字下げ: 本文の行の左端でいちばん多い位置（字下げの無い行）から、それより右で始まる行の左端までの差
const left = mode(body.x0);
const indent = mode(body.x0.map((x) => x - left.value).filter((d) => d > 1 && d < 3 * zw.value));

const r = (v) => +(v / zw.value).toFixed(3);
const levels = [...headingSizes.keys()].sort();
const result = {
  pdf: pdfRel,
  pages: `${firstPage}〜${lastPage}`,
  body: {
    zw: zw,
    latin,
    pitch,
    width,
    widthZw: +(width.value / zw.value).toFixed(2),
    lineHeight: r(pitch.value),
    latinScale: r(latin.value),
    left,
    indent,
    indentZw: +(indent.value / zw.value).toFixed(3),
    inlineCode: mode(body.inlineMono),
    inlineCodeScale: r(mode(body.inlineMono).value),
  },
  captions: { cjk: mode(captions.cjk), latin: mode(captions.latin), scale: r(mode(captions.cjk).value), fonts: Object.fromEntries(captions.fonts) },
  headings: Object.fromEntries(
    levels.map((lv) => {
      const e = headingSizes.get(lv);
      const m = mode(e.cjk);
      return [lv, { cjk: m, latin: mode(e.latin), scale: r(m.value) }];
    })
  ),
  headingMatch: `${headingFound}/${headingTried}`,
  code: {
    mono: mode(code.mono),
    cjk: mode(code.cjk),
    pitch: mode(code.pitch),
    scale: r(mode(code.mono).value),
    cjkScale: code.cjk.length ? r(mode(code.cjk).value) : undefined,
    lineHeight: +(mode(code.pitch).value / mode(code.mono).value).toFixed(3),
  },
  table: {
    cells: `${cellFound}（探した ${uniqueCells.length}）`,
    cjk: tableSize,
    pitch: mode(table.pitch),
    scale: tableSize ? r(tableSize.value) : undefined,
    lineHeight: tableSize && table.pitch.length ? +(mode(table.pitch).value / tableSize.value).toFixed(3) : undefined,
    columnGap: colGap,
    // 列の間を、表の文字の半角（表の 1zw の半分）の個数で
    columnGapHalfwidth: tableSize && colGap ? +(colGap.value / (tableSize.value / 2)).toFixed(2) : undefined,
  },
  fonts: {
    body: Object.fromEntries(fontsUsed.body),
    bodyLatin: Object.fromEntries(fontsUsed.latin),
    headings: Object.fromEntries(headingFonts),
    code: Object.fromEntries(fontsUsed.code),
    table: Object.fromEntries(table.fonts),
  },
};
console.log(JSON.stringify(result, null, 2));
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(result, null, 2));
