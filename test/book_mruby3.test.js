// 実際の原稿（book_mruby3）に対する確認。隣に無ければ飛ばす（GitHub の CI では飛ぶ）。
// 計画書 v0-plan.md 段階 1 の「確認」がここ: 参照切れ 0 件、索引が 1 秒以内。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ReviewIndex, diagnoseWorkspace, resolveRefDetailed, imagePreviewPath, loadPageIndex, lookupPage, buildOutline } = require('../dist/core.js');
const { checkContainment, countNodes } = require('./helper.js');

const BOOK = process.env.REVIEW_ASSIST_BOOK || path.join(__dirname, '..', '..', '..', 'book_mruby3');
const available = fs.existsSync(path.join(BOOK, 'catalog.yml'));

test('book_mruby3: 索引が 1 秒以内にできる', { skip: available ? false : `${BOOK} が無い` }, () => {
  const idx = new ReviewIndex(BOOK);
  const t0 = process.hrtime.bigint();
  idx.build();
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.ok(idx.chapters.size > 0, 'catalog.yml から章が読めていない');
  assert.ok(idx.files.size > 40, `ファイル数が少なすぎる: ${idx.files.size}`);
  assert.ok(ms < 1000, `索引に ${ms.toFixed(0)} ms かかった`);
});

test('book_mruby3: 参照切れと曖昧な参照が 0 件', { skip: available ? false : `${BOOK} が無い` }, () => {
  const idx = new ReviewIndex(BOOK);
  idx.build();
  const bad = diagnoseWorkspace(idx).filter((d) => d.severity === 'error');
  assert.deepStrictEqual(
    bad.map((d) => `${d.file}:${d.span.start.line + 1} [${d.code}] ${d.message}`),
    []
  );
});

test('book_mruby3: 生成物の章 opcodes は元ファイルで索引する', { skip: available ? false : `${BOOK} が無い` }, () => {
  const idx = new ReviewIndex(BOOK);
  idx.build();
  const opcodes = idx.chapters.get('opcodes');
  assert.ok(opcodes, 'opcodes 章がない');
  assert.strictEqual(opcodes.generated, true, '.review-assist.json の chapters が効いていない');
  assert.ok(opcodes.files.some((f) => f.startsWith('sub-article/')), 'sub-article が章に入っていない');
  assert.strictEqual(idx.files.has('contents/opcodes.re'), false, '生成物が索引に残っている');

  // sub-article にある見出しを、他の章から `@<hd>{opcodes|chap_SEND}` で引けること
  const ref = { file: 'contents/vm.re', op: 'hd', arg: 'opcodes|chap_SEND', chapter: 'vm', span: null, argSpan: null };
  const r = resolveRefDetailed(idx, ref);
  assert.strictEqual(r.kind, 'hit');
  assert.match(r.target.file, /sub-article\/.*SEND/);
});

// 計画書 段階 3 の「確認」。どちらも本側の生成物（`tools/drawio2pdf.sh` の PNG と
// `tools/build_pdf.sh` が呼ぶ `tools/pdf_pages.py` の索引）が要るので、無ければ飛ばす。
const pngDir = path.join(BOOK, 'images', 'png');
const hasPng = available && fs.existsSync(pngDir);

test('book_mruby3: 全部の図で imagePreview の PNG が解決する', { skip: hasPng ? false : `${pngDir} が無い（tools/drawio2pdf.sh を走らせる）` }, () => {
  const idx = new ReviewIndex(BOOK);
  idx.build();
  const missing = [];
  let total = 0;
  for (const parsed of idx.files.values()) {
    for (const block of parsed.blocks) {
      if (block.kind !== 'image' && block.kind !== 'indepimage' && block.kind !== 'imgtable') continue;
      if (!block.id) continue;
      total++;
      const preview = imagePreviewPath(idx, block);
      if (!preview || !fs.existsSync(idx.abs(preview))) missing.push(`${block.file} ${block.id} → ${preview}`);
    }
  }
  assert.ok(total > 30, `図が少なすぎる: ${total}`);
  assert.deepStrictEqual(missing, []);
});

const pageIndexFile = available ? path.join(BOOK, 'book_mruby3-pages.json') : '';
const hasPages = available && fs.existsSync(pageIndexFile);

test('book_mruby3: どの見出しからも PDF のページが引ける', { skip: hasPages ? false : `${pageIndexFile} が無い（tools/build_pdf.sh を走らせる）` }, () => {
  const idx = new ReviewIndex(BOOK);
  idx.build();
  const load = loadPageIndex(idx);
  assert.ok(load.pages, `索引が読めない: ${load.problem} ${load.error ?? ''}`);

  // 全部の見出しの行で引いてみる。落ちる先が章の先頭でもよいが、見つからないのは困る
  const notFound = [];
  const viaChapter = [];
  let total = 0;
  for (const [rel, parsed] of idx.files) {
    for (const heading of parsed.headings) {
      total++;
      const r = lookupPage(idx, load.pages, rel, heading.span.start.line);
      if (r.kind !== 'ok') notFound.push(`${rel}:${heading.span.start.line + 1} ${heading.plainTitle} (${r.kind})`);
      else if (r.via === 'chapter' && heading.level > 1) viaChapter.push(`${rel} ${heading.plainTitle}`);
    }
  }
  assert.ok(total > 500, `見出しが少なすぎる: ${total}`);
  assert.deepStrictEqual(notFound, []);
  assert.deepStrictEqual(viaChapter, [], '章の先頭に落ちた見出しがある（索引の鍵が合っていない）');
});

// 0.1.1 の「アウトラインがフラットに見える」調べ。VS Code の DocumentSymbol は
// 「selectionRange ⊆ range」「子の range ⊆ 親の range」を要求し、破れると木を崩すことがある。
// 著者の手元で実際に深い木が出ているファイルを並べて、どの設定でも不変条件が保たれることを見る。
const OUTLINE_FILES = [
  'contents/vm.re',
  'contents/gc.re',
  'contents/codegen.re',
  'sub-article/chap3-037-SEND.re',
  'opcodes_template.re',
];

test('book_mruby3: アウトラインの range が入れ子になっている', { skip: available ? false : `${BOOK} が無い` }, () => {
  const idx = new ReviewIndex(BOOK);
  idx.build();
  const problems = [];
  for (const rel of OUTLINE_FILES) {
    const parsed = idx.files.get(rel);
    assert.ok(parsed, `${rel} が索引にない`);
    // 既定（見出しだけ）と、全部のブロックを出した場合の両方で確かめる
    for (const blocks of [[], ['list', 'table', 'image', 'footnote']]) {
      const roots = buildOutline(parsed, { blocks });
      problems.push(...checkContainment(roots, `${rel} blocks=[${blocks.join(',')}]`));
    }
  }
  assert.deepStrictEqual(problems, []);
});

test('book_mruby3: 既定のアウトラインは見出しだけで、ブロックを入れると増える', { skip: available ? false : `${BOOK} が無い` }, () => {
  const idx = new ReviewIndex(BOOK);
  idx.build();
  const parsed = idx.files.get('contents/vm.re');
  assert.ok(parsed, 'contents/vm.re が索引にない');
  const headingsOnly = countNodes(buildOutline(parsed));
  const withBlocks = countNodes(buildOutline(parsed, { blocks: ['list', 'table', 'image', 'footnote'] }));
  assert.strictEqual(headingsOnly.nodes, parsed.headings.length, '既定の木に見出し以外が混じっている');
  assert.ok(withBlocks.nodes > headingsOnly.nodes, 'ブロックを入れても増えていない');
  assert.ok(headingsOnly.depth > 1, `見出しだけの木が平ら: depth=${headingsOnly.depth}`);
});
