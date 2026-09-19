// 実際の原稿（book_mruby3）に対する確認。隣に無ければ飛ばす（GitHub の CI では飛ぶ）。
// 計画書 v0-plan.md 段階 1 の「確認」がここ: 参照切れ 0 件、索引が 1 秒以内。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ReviewIndex, diagnoseWorkspace, resolveRefDetailed } = require('../dist/core.js');

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
