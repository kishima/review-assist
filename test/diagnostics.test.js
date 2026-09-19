// 診断（段階 1: 参照切れ・曖昧・参照されていない表・id の二重）。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { ReviewIndex, diagnoseWorkspace, diagnoseFile, duplicateIdDiagnostics } = require('../dist/core.js');

const ROOT = path.join(__dirname, 'fixtures', 'sample');

function index() {
  const idx = new ReviewIndex(ROOT);
  idx.build();
  return idx;
}

function codes(diags) {
  return diags.map((d) => d.code).sort();
}

test('段階 1: 参照切れ・曖昧・無い章', () => {
  const idx = index();
  const diags = diagnoseWorkspace(idx);
  const errors = diags.filter((d) => d.severity === 'error');
  assert.deepStrictEqual(codes(errors), ['ambiguous-ref', 'broken-ref', 'broken-ref', 'broken-ref', 'unknown-chapter']);
  const amb = errors.find((d) => d.code === 'ambiguous-ref');
  assert.match(amb.message, /チャート/);
  const chap = errors.find((d) => d.code === 'unknown-chapter');
  assert.match(chap.message, /nosuch/);
});

test('参照切れの位置は @<...> の全体', () => {
  const idx = index();
  const d = diagnoseFile(idx, 'contents/first.re').find((x) => x.code === 'broken-ref' && x.message.includes('nosuchlist'));
  const line = idx.files.get('contents/first.re').lines[d.span.start.line];
  assert.strictEqual(line.slice(d.span.start.column, d.span.end.column), '@<list>{nosuchlist}');
});

test('段階 1: 参照されていない表だけが warning', () => {
  const idx = index();
  const unref = diagnoseWorkspace(idx).filter((d) => d.code === 'unreferenced-table');
  assert.deepStrictEqual(unref.map((d) => d.message.match(/`(\w+)`/)[1]), ['t2']);
});

test('設定で参照されていない表の警告を切れる', () => {
  const idx = index();
  idx.config.warnUnreferencedTables = false;
  assert.strictEqual(diagnoseWorkspace(idx).filter((d) => d.code === 'unreferenced-table').length, 0);
});

test('章の中で id とラベルが二重なら warning', () => {
  const idx = index();
  idx.updateFile('sub/b.re', ['=={chap_A} 別の記事', '//table[t1][cap]{', 'a\tb', '//}'].join('\n'));
  const hits = duplicateIdDiagnostics(idx);
  assert.ok(hits.some((d) => d.message.includes('chap_A')));
});
