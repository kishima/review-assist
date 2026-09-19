// 診断（段階 1 の参照切れ・段階 2 の規則と幅）。
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { ReviewIndex, diagnoseWorkspace, diagnoseFile, sliceForScope, parseReview, ruleDiagnostics, duplicateIdDiagnostics } = require('../dist/core.js');

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

test('段階 2: 規則は scope prose では地の文とキャプションだけ', () => {
  const idx = index();
  const hits = diagnoseFile(idx, 'contents/first.re').filter((d) => d.code === 'rule.old-notation');
  const lines = hits.map((d) => d.span.start.line + 1);
  // 7 行目の地の文と 13 行目の //list のキャプション。コード本体（17 行目）は拾わない
  assert.deepStrictEqual(lines, [7, 13]);
});

test('段階 2: 規則は scope code ではコード本体だけ', () => {
  const idx = index();
  const hits = diagnoseFile(idx, 'contents/first.re').filter((d) => d.code === 'rule.code-tab');
  assert.deepStrictEqual(hits.map((d) => d.span.start.line + 1), [17]);
});

test('sliceForScope: prose は本文・見出し・キャプション、code はコード本体', () => {
  const text = ['== 見出し', '地の文', '#@# コメント', '//list[i][キャプション]{', 'コード', '//}'].join('\n');
  const p = parseReview('t.re', text, 'ch');
  assert.deepStrictEqual(
    sliceForScope(p, 'prose').map((s) => s.text),
    ['== 見出し', '地の文', 'キャプション']
  );
  assert.deepStrictEqual(
    sliceForScope(p, 'code').map((s) => s.text),
    ['コード']
  );
  assert.deepStrictEqual(
    sliceForScope(p, 'all').map((s) => s.text),
    ['== 見出し', '地の文', '//list[i][キャプション]{', 'コード', '//}']
  );
});

test('allowIn に当たるファイルでは規則を当てない', () => {
  const idx = index();
  idx.config.rules = [{ id: 'r', pattern: '地の文', message: 'x', scope: 'prose', allowIn: ['contents/*.re'] }];
  assert.strictEqual(ruleDiagnostics(idx, idx.files.get('contents/first.re')).length, 0);
  idx.config.rules = [{ id: 'r', pattern: '地の文', message: 'x', scope: 'prose', allowIn: ['sub/*.re'] }];
  assert.ok(ruleDiagnostics(idx, idx.files.get('contents/first.re')).length > 0);
});

test('否定先読みで @<code>{} の中を外せる', () => {
  const idx = index();
  const p = parseReview('t.re', 'ダンプから OP_ が消えた。@<code>{OP_SEND}はCの識別子。', 'first');
  idx.config.rules = [{ id: 'op', pattern: '(?<!@<code>\\{[^}]*)\\bOP_', message: 'x', scope: 'prose' }];
  const hits = ruleDiagnostics(idx, p);
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].span.start.column, 6);
});

test('壊れた正規表現は error で報告して他の規則は続ける', () => {
  const idx = index();
  idx.config.rules = [
    { id: 'bad', pattern: '(', message: 'x' },
    { id: 'ok', pattern: '地の文', message: 'y', scope: 'prose' },
  ];
  const hits = ruleDiagnostics(idx, idx.files.get('contents/first.re'));
  assert.ok(hits.some((d) => d.code === 'rule.bad' && d.severity === 'error'));
  assert.ok(hits.some((d) => d.code === 'rule.ok'));
});

test('段階 2: コードブロックの行長（既定は文字数）', () => {
  const idx = index();
  const hits = diagnoseFile(idx, 'contents/first.re').filter((d) => d.code === 'code-line-length');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].span.start.line + 1, 17);
});

test('codeLineWidth: halfwidth にすると全角を 2 で数える', () => {
  const idx = index();
  const p = parseReview('t.re', ['//list[a][c]{', 'あいうえお', '//}'].join('\n'), 'first');
  idx.config.maxCodeLineLength = 7;
  idx.config.codeLineWidth = 'chars';
  assert.strictEqual(diagnoseFileOf(idx, p).filter((d) => d.code === 'code-line-length').length, 0);
  idx.config.codeLineWidth = 'halfwidth';
  assert.strictEqual(diagnoseFileOf(idx, p).filter((d) => d.code === 'code-line-length').length, 1);
});

function diagnoseFileOf(idx, parsed) {
  idx.files.set(parsed.file, parsed);
  return diagnoseFile(idx, parsed.file);
}

test('段階 2: 表の幅', () => {
  const idx = index();
  const hits = diagnoseFile(idx, 'contents/first.re').filter((d) => d.code === 'table-width');
  assert.strictEqual(hits.length, 1);
  assert.match(hits[0].message, /t2/);
  assert.match(hits[0].message, /`\/\/tsize` を付けて/);
});

test('段階 2: #@# の TODO は info', () => {
  const idx = index();
  const p = parseReview('t.re', '#@# TODO(著者): あとで直す', 'first');
  const hits = diagnoseFileOf(idx, p).filter((d) => d.code === 'todo');
  assert.strictEqual(hits.length, 1);
  assert.strictEqual(hits[0].severity, 'info');
  assert.strictEqual(hits[0].message, 'TODO(著者): あとで直す');
});

test('章の中で id とラベルが二重なら warning', () => {
  const idx = index();
  idx.updateFile('sub/b.re', ['=={chap_A} 別の記事', '//table[t1][cap]{', 'a\tb', '//}'].join('\n'));
  const hits = duplicateIdDiagnostics(idx);
  assert.ok(hits.some((d) => d.message.includes('chap_A')));
});
