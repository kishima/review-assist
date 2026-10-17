// 参照の札（紙面に印刷される形。src/core/printed.ts）が、本のビルドが実際に出したものと合うかを確かめる。
//
//   node tools/check-printed-refs.mjs <本のディレクトリ>
//
// 1. Re:VIEW がビルドの途中で書いた LaTeX（`<bookname>-pdf/*.tex`）と比べる
//    * 表・リスト・図: `\reviewtableref{3.1}{table:vm:id}` の番号と、札の番号
//    * 見出し: 札の「…」がその章の .tex にそのままあるか
//    * 章: 札（第3章、付録A）の数が、その章の .tex の中の同じ文字列の数以下か
//    * 脚注: その章の k 番目の `\footnote{…}`（または `\footnotemark`）が、札 *k の脚注の文か
// 2. PDF で、参照の直前の地の文と札をつないだ文字列を探す（種類ごとに 5 つずつ）
//
// .tex と PDF は最後にビルドしたときのもの。その後で原稿を直した所は合わないことがある（数を分けて出す）。
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, '..', 'dist', 'core.js'));
const pdfjs = await import(path.join(here, '..', 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.mjs'));

const root = path.resolve(process.argv[2] ?? '');
const index = new core.ReviewIndex(root);
index.build();
const bookname = /^bookname:\s*(\S+)/m.exec(fs.readFileSync(path.join(root, 'config.yml'), 'utf8'))?.[1];
const texDir = path.join(root, `${bookname}-pdf`);
const printed = core.buildPrintedIndex(index);
const secnolevel = core.readSecnolevel(root);
console.log(`secnolevel ${secnolevel}、.tex は ${texDir}`);

const norm = (s) => s.normalize('NFKC').replace(/\s+/g, '').replace(/∕/g, '/').replace(/‧/g, '・');
/** LaTeX の行から文字だけを取り出す（`\texttt{}` などの命令を外す）。見出しの「…」を探すため。 */
const texText = (s) => s.replace(/\\index\{[^}]*\}/g, '').replace(/\\textunderscore\{\}/g, '_').replace(/\\[a-zA-Z@]+\*?(\[[^\]]*\])?/g, '').replace(/[{}]/g, '').replace(/\\(.)/g, '$1');

const result = { block: { ok: 0, ng: [] }, hd: { ok: 0, ng: [] }, chap: { ok: 0, ng: [] }, fn: { ok: 0, ng: [] } };
const samples = { chap: [], hd: [], table: [], list: [], img: [], fn: [] };

for (const chapId of index.chapterOrder) {
  const chapter = index.chapters.get(chapId);
  const texFile = path.join(texDir, `${chapId}.tex`);
  if (!fs.existsSync(texFile)) continue;
  const tex = fs.readFileSync(texFile, 'utf8');
  const texPlain = norm(texText(tex));
  const files = chapter.files.filter((f) => index.files.has(f));
  const labelsAll = {};
  const occurrences = [];
  for (const f of files) {
    const parsed = index.files.get(f);
    Object.assign(labelsAll, core.refLabels(index, parsed, printed, secnolevel));
    for (const r of parsed.refs) {
      if (!['chap', 'hd', 'table', 'list', 'img', 'fn'].includes(r.op)) continue;
      const line = parsed.lines[r.span.start.line];
      // 直前の地の文（PDF で探す手がかり）。直前にインライン命令があると印刷される文字が違うので、命令の無い所だけ
      const raw = line.slice(0, r.span.start.column);
      const tail = raw.slice(-12);
      occurrences.push({ f, r, before: /[@{}]/.test(tail) ? '' : core.stripInline(raw) });
    }
  }
  // 表・リスト・図: .tex の \review…ref{番号}{種類:章:id}
  const re = /\\review(table|list|image)ref\{([^}]*)\}\{(table|list|image):([^:}]*):([^}]*)\}/g;
  let m;
  while ((m = re.exec(tex)) !== null) {
    const op = m[1] === 'image' ? 'img' : m[1];
    const chap = m[4];
    const id = m[5];
    const arg = chap === chapId ? id : `${chap}|${id}`;
    const label = labelsAll[core.refKey(op, arg)] ?? labelsAll[core.refKey(op, id)];
    const want = `${{ table: '表', list: 'リスト', img: '図' }[op]}${m[2]}`;
    if (label?.text === want) result.block.ok++;
    else result.block.ng.push(`${chapId}: ${m[0]} → 札 ${label?.text}`);
  }
  // 見出しと章
  const chapCount = new Map();
  for (const o of occurrences) {
    const label = labelsAll[core.refKey(o.r.op, o.r.arg)];
    if (!label?.ok) continue;
    if (o.r.op === 'hd') {
      if (texPlain.includes(norm(label.text))) result.hd.ok++;
      else result.hd.ng.push(`${o.f}:${o.r.span.start.line + 1} ${label.text}`);
    }
    if (o.r.op === 'chap') chapCount.set(label.text, (chapCount.get(label.text) ?? 0) + 1);
    if (samples[o.r.op].length < 5 && norm(o.before).length >= 4) samples[o.r.op].push({ f: o.f, line: o.r.span.start.line + 1, before: norm(o.before).slice(-6), label: label.text });
  }
  for (const [label, n] of chapCount) {
    const inTex = tex.split(label).length - 1;
    if (inTex >= n) result.chap.ok += n;
    else result.chap.ng.push(`${chapId}: ${label} 原稿 ${n}、.tex ${inTex}`);
  }
  // 脚注: k 番目の \footnote / \footnotemark
  const fnTex = [...tex.matchAll(/\\(?:protect\\)?footnote(mark)?(?:\[\d+\])?\{?/g)];
  const fnTexts = [];
  for (const x of fnTex) {
    if (x[1]) {
      fnTexts.push('(mark)');
      continue;
    }
    let depth = 1;
    let i = x.index + x[0].length;
    const start = i;
    while (i < tex.length && depth > 0) {
      if (tex[i] === '\\') i++;
      else if (tex[i] === '{') depth++;
      else if (tex[i] === '}') depth--;
      i++;
    }
    fnTexts.push(norm(texText(tex.slice(start, i - 1))));
  }
  for (const o of occurrences) {
    if (o.r.op !== 'fn') continue;
    const label = labelsAll[core.refKey('fn', o.r.arg)];
    const k = Number(label?.text?.slice(1));
    const t = fnTexts[k - 1];
    if (t !== undefined && (t === '(mark)' || t === norm(label.title ?? ''))) result.fn.ok++;
    else result.fn.ng.push(`${o.f}:${o.r.span.start.line + 1} ${label?.text} .tex の ${k} 番目 = ${t}`);
  }
}

console.log(`表・リスト・図: .tex の番号と同じ ${result.block.ok}、違う ${result.block.ng.length}`);
for (const x of result.block.ng) console.log(`  ${x}`);
console.log(`見出し: 札が .tex にある ${result.hd.ok}、無い ${result.hd.ng.length}`);
for (const x of result.hd.ng) console.log(`  ${x}`);
console.log(`章: 合う ${result.chap.ok}、合わない ${result.chap.ng.length}`);
for (const x of result.chap.ng) console.log(`  ${x}`);
console.log(`脚注: 合う ${result.fn.ok}、合わない ${result.fn.ng.length}`);
for (const x of result.fn.ng) console.log(`  ${x}`);

// PDF で、参照の直前の文字と札をつないだ文字列を探す
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(index.abs(index.config.pdf))), verbosity: 0 }).promise;
let stream = '';
const pageAt = [];
for (let n = 1; n <= doc.numPages; n++) {
  const tc = await (await doc.getPage(n)).getTextContent();
  pageAt.push([stream.length, n]);
  stream += norm(tc.items.map((i) => i.str).join(''));
}
const pageOf = (pos) => pageAt.filter(([s]) => s <= pos).pop()?.[1];
let pdfOk = 0;
let pdfNg = 0;
console.log('PDF:');
for (const [op, list] of Object.entries(samples)) {
  for (const s of list) {
    const needle = s.before + norm(s.label);
    const at = stream.indexOf(needle);
    if (at >= 0) pdfOk++;
    else pdfNg++;
    console.log(`  ${at >= 0 ? 'ok  ' : 'なし'} ${op} ${s.f}:${s.line} 「${needle}」${at >= 0 ? ` p.${pageOf(at)}` : ''}`);
  }
}
console.log(`PDF で見つかった ${pdfOk}、見つからない ${pdfNg}`);
