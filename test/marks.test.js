// マーカー（src/core/marks.ts）: 保存形式、位置の探し直し、依頼の組み立て、結果の読み込み。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  captureMark,
  anchorMark,
  refreshMark,
  parseMarks,
  serializeMarks,
  saveMarks,
  loadMarks,
  parseAiResults,
  planSuggestion,
  buildAiRequest,
  contextLines,
  fenceFor,
  groupMarks,
  readMarksConfig,
  defaultMarksConfig,
  loadConfig,
  newMarkId,
  posAt,
  offsetAt,
  ReviewIndex,
} = require('../dist/core.js');

const L = 32;
const NOW = new Date('2026-10-17T00:00:00Z');

/** text の中の needle（n 番目、0 起点）を選んでマーカーにする。 */
function markOn(text, needle, n = 0, extra = {}) {
  let at = -1;
  for (let k = 0; k <= n; k++) at = text.indexOf(needle, at + 1);
  assert.ok(at >= 0, `${needle} が無い`);
  return captureMark({ text, file: 'a.re', start: at, end: at + needle.length, kind: 'ai-check', contextLength: L, now: NOW, ...extra });
}

const slice = (text, a) => text.slice(a.start, a.end);

const BASE = [
  '= 章',
  '',
  'VM は命令を 1 つずつ読む。読んだ命令の種類で分岐する。分岐の先でレジスタを読み書きする。',
  '',
  '== 節',
  '',
  'GC は印を付けてから掃く。印の付いていないオブジェクトを解放する。',
  '',
].join('\n');

test('captureMark: quote・前後・行（1 起点）・既定の状態', () => {
  const m = markOn(BASE, '読んだ命令の種類で分岐する。');
  assert.strictEqual(m.quote, '読んだ命令の種類で分岐する。');
  assert.strictEqual(m.line, 3);
  assert.strictEqual(m.status, 'open');
  assert.strictEqual(m.created, '2026-10-17T00:00:00.000Z');
  assert.ok(BASE.includes(m.prefix + m.quote + m.suffix));
  assert.ok(m.prefix.length <= L && m.suffix.length <= L);
  assert.strictEqual(captureMark({ text: BASE, file: 'a.re', start: 5, end: 5, kind: 'x', contextLength: L }), undefined, '空の範囲');
});

test('captureMark: 前後の文脈はサロゲートの片割れで切らない', () => {
  const text = 'a😀b'.repeat(4) + 'XYZ' + 'c😀d'.repeat(4);
  const at = text.indexOf('XYZ');
  for (let len = 1; len <= 8; len++) {
    const m = captureMark({ text, file: 'a.re', start: at, end: at + 3, kind: 'x', contextLength: len, now: NOW });
    const lone = (s) => /^[\udc00-\udfff]|[\ud800-\udbff]$/.test(s);
    assert.ok(!lone(m.prefix) && !lone(m.suffix), `len=${len}: ${JSON.stringify(m)}`);
  }
});

test('anchorMark: 変わっていなければ exact で同じ所', () => {
  const m = markOn(BASE, '印の付いていないオブジェクトを解放する。');
  const a = anchorMark(BASE, m);
  assert.strictEqual(a.kind, 'exact');
  assert.strictEqual(slice(BASE, a), m.quote);
});

test('anchorMark: 前後に文を足しても追いつく', () => {
  const m = markOn(BASE, '読んだ命令の種類で分岐する。');
  const edited = BASE.replace('= 章\n', '= 章\n\n前に足した段落。\n').replace('分岐の先で', 'ここに足した文。分岐の先で');
  const a = anchorMark(edited, m);
  assert.strictEqual(a.kind, 'exact');
  assert.strictEqual(slice(edited, a), m.quote);
  assert.strictEqual(posAt(edited, a.start).line, 4);
});

test('anchorMark: 選んだ文の中を直すと fuzzy で直した後の文に当たる', () => {
  const m = markOn(BASE, '読んだ命令の種類で分岐する。');
  const edited = BASE.replace('読んだ命令の種類で分岐する。', '読んだ opcode で分岐する。');
  const a = anchorMark(edited, m);
  assert.strictEqual(a.kind, 'fuzzy');
  assert.strictEqual(slice(edited, a), '読んだ opcode で分岐する。');
});

test('anchorMark: 段落を移しても exact で当たる', () => {
  const m = markOn(BASE, 'GC は印を付けてから掃く。');
  const lines = BASE.split('\n');
  const moved = [lines[0], '', lines[6], '', lines[2], '', lines[4], ''].join('\n');
  const a = anchorMark(moved, m);
  assert.strictEqual(a.kind, 'exact');
  assert.strictEqual(slice(moved, a), m.quote);
  assert.strictEqual(posAt(moved, a.start).line, 2);
});

test('anchorMark: 選んだ文を消すと見失う（別の所に当てない）', () => {
  const m = markOn(BASE, '読んだ命令の種類で分岐する。');
  const edited = BASE.replace('読んだ命令の種類で分岐する。', '');
  assert.deepStrictEqual(anchorMark(edited, m), { kind: 'lost' });
});

test('anchorMark: 文と前後をまとめて書き直すと見失う', () => {
  const m = markOn(BASE, '読んだ命令の種類で分岐する。');
  const edited = BASE.replace(/VM は.*$/m, 'まったく別の段落に書き直した。');
  assert.deepStrictEqual(anchorMark(edited, m), { kind: 'lost' });
});

test('anchorMark: fuzzy は段落の切れ目をまたいで当てない', () => {
  const text = 'あいうえお。前の文脈がここ。選ぶ文。後の文脈がここ。\n\nかきくけこ。';
  const m = captureMark({ text, file: 'a.re', start: text.indexOf('選ぶ文。'), end: text.indexOf('選ぶ文。') + 4, kind: 'x', contextLength: 8, now: NOW });
  // 選んだ文を消して、前の文脈と後の文脈の間に段落を挟む
  const edited = text.replace('選ぶ文。', '\n\n別の段落。\n\n');
  assert.deepStrictEqual(anchorMark(edited, m), { kind: 'lost' });
});

test('anchorMark: 同じ文が 2 か所にあると前後の文脈で正しい方を選ぶ', () => {
  const text = ['最初の段落。ここで同じ文が出る。前の話。', '', '二つ目の段落。ここで同じ文が出る。後の話。', ''].join('\n');
  const second = markOn(text, 'ここで同じ文が出る。', 1);
  const first = markOn(text, 'ここで同じ文が出る。', 0);
  // 行の目安をわざと逆にしても文脈が勝つ
  const a2 = anchorMark(text, { ...second, line: 1 });
  const a1 = anchorMark(text, { ...first, line: 3 });
  assert.strictEqual(posAt(text, a2.start).line, 2);
  assert.strictEqual(posAt(text, a1.start).line, 0);
  // 前に段落を足して行がずれても同じ
  const edited = '足した段落。\n\n' + text;
  assert.strictEqual(posAt(edited, anchorMark(edited, second).start).line, 4);
});

test('anchorMark: 文脈で決まらなければ行の目安に近い方', () => {
  const text = 'X。\n\nX。\n\nX。\n';
  const m = { quote: 'X。', prefix: '', suffix: '', line: 3 };
  assert.strictEqual(posAt(text, anchorMark(text, m).start).line, 2);
});

test('anchorMark: ファイルの先頭と末尾のマーカー（prefix / suffix が空）も直せる', () => {
  const text = '先頭の文。続き。';
  const head = captureMark({ text, file: 'a.re', start: 0, end: 5, kind: 'x', contextLength: L, now: NOW });
  assert.strictEqual(head.prefix, '');
  const edited = text.replace('先頭の文。', '直した先頭。');
  const a = anchorMark(edited, head);
  assert.strictEqual(a.kind, 'fuzzy');
  assert.strictEqual(slice(edited, a), '直した先頭。');
});

test('refreshMark: 直した後の文で quote と前後と行を取り直す。見失ったものは元のまま', () => {
  const m = markOn(BASE, '読んだ命令の種類で分岐する。');
  const edited = '足した。\n\n' + BASE.replace('読んだ命令の種類で分岐する。', '読んだ opcode で分岐する。');
  const r = refreshMark(edited, m, L);
  assert.strictEqual(r.quote, '読んだ opcode で分岐する。');
  assert.strictEqual(r.line, 5);
  assert.strictEqual(r.id, m.id);
  assert.ok(edited.includes(r.prefix + r.quote + r.suffix));
  const gone = refreshMark('全部消した。', m, L);
  assert.strictEqual(gone, m);
});

test('posAt / offsetAt は往復する', () => {
  for (let off = 0; off <= BASE.length; off++) assert.strictEqual(offsetAt(BASE, posAt(BASE, off)), off);
});

test('parseMarks / serializeMarks: 往復と、壊れた項目だけ落とす', () => {
  const m = markOn(BASE, 'GC は印を付けてから掃く。');
  const data = { version: 1, marks: [m, { ...m, id: 'm2', status: 'done', note: 'メモ' }] };
  assert.deepStrictEqual(parseMarks(serializeMarks(data)).data, data);
  const broken = parseMarks(JSON.stringify({ marks: [m, { id: 'x' }, m] }));
  assert.strictEqual(broken.data.marks.length, 1);
  assert.strictEqual(broken.problems.length, 2, broken.problems.join('\n'));
  assert.match(parseMarks('{').problems[0], /JSON/);
  assert.match(parseMarks('{}').problems[0], /marks/);
});

test('saveMarks / loadMarks: ディレクトリが無ければ作る', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-marks-'));
  const cfg = defaultMarksConfig();
  assert.deepStrictEqual(loadMarks(root, cfg).data.marks, []);
  const m = markOn(BASE, 'GC は印を付けてから掃く。');
  const file = saveMarks(root, cfg, { version: 1, marks: [m] });
  assert.strictEqual(file, path.join(root, '.review-assist', 'marks.json'));
  assert.deepStrictEqual(loadMarks(root, cfg).data.marks, [m]);
});

test('newMarkId: 同じ時刻でも重ならない', () => {
  const a = newMarkId(NOW, []);
  const b = newMarkId(NOW, [a]);
  const c = newMarkId(NOW, [a, b]);
  assert.strictEqual(new Set([a, b, c]).size, 3);
  assert.match(a, /^m[0-9a-z]+$/);
});

test('parseAiResults: 正しい項目、知らない id、壊れた項目、壊れた JSON', () => {
  const known = new Set(['m1', 'm2']);
  const text = JSON.stringify({
    version: 1,
    results: [
      { id: 'm1', verdict: 'fix', comment: 'バージョンが違う', suggestion: '直した文。', quote: '元の文。' },
      { id: 'm2', verdict: 'ok', comment: '' },
      { id: 'm9', verdict: 'ok', comment: '消したマーカー' },
      { id: 'm2', verdict: 'maybe' },
      { verdict: 'ok' },
    ],
  });
  const r = parseAiResults(text, known);
  assert.deepStrictEqual([...r.results.keys()], ['m1', 'm2']);
  assert.strictEqual(r.results.get('m1').suggestion, '直した文。');
  assert.strictEqual(r.results.get('m2').suggestion, undefined);
  assert.deepStrictEqual(r.unknownIds, ['m9']);
  assert.strictEqual(r.problems.length, 2, r.problems.join('\n'));
  const bad = parseAiResults('{"results": [', known);
  assert.strictEqual(bad.results.size, 0);
  assert.match(bad.problems[0], /JSON/);
  assert.match(parseAiResults('[]', known).problems[0], /results/);
});

test('planSuggestion: 当てる範囲、古い結果の印、当てられない理由', () => {
  const m = markOn(BASE, '読んだ命令の種類で分岐する。');
  const result = { id: m.id, verdict: 'fix', comment: '', suggestion: '命令の種類で分岐する。', quote: m.quote };
  const p = planSuggestion(BASE, m, result);
  assert.strictEqual(p.ok, true);
  assert.strictEqual(BASE.slice(p.start, p.end), m.quote);
  assert.strictEqual(p.stale, false);
  const edited = BASE.replace('読んだ命令の種類で分岐する。', '読んだ opcode で分岐する。');
  const q = planSuggestion(edited, m, result);
  assert.strictEqual(q.ok, true);
  assert.strictEqual(q.stale, true, '原稿が AI の見た文から変わった');
  assert.strictEqual(planSuggestion(BASE, m, undefined).ok, false);
  assert.strictEqual(planSuggestion(BASE, m, { ...result, suggestion: undefined }).ok, false);
  assert.strictEqual(planSuggestion('全部消した。', m, result).ok, false);
});

test('contextLines: 選んだ段落と前後 n 段落', () => {
  const lines = ['p1', '', 'p2a', 'p2b', '', '', 'p3', '', 'p4', '', 'p5'];
  assert.deepStrictEqual(contextLines(lines, 6, 6, 0), [6, 6]);
  assert.deepStrictEqual(contextLines(lines, 6, 6, 1), [2, 8]);
  assert.deepStrictEqual(contextLines(lines, 6, 6, 2), [0, 10]);
  assert.deepStrictEqual(contextLines(lines, 0, 0, 1), [0, 3]);
});

test('fenceFor: 中の ` の連続より長い', () => {
  assert.strictEqual(fenceFor('abc'), '```');
  assert.strictEqual(fenceFor('a ``` b'), '````');
});

test('readMarksConfig: 既定、種類の差し替え、色の補い', () => {
  const d = readMarksConfig(undefined);
  assert.deepStrictEqual(d.kinds.map((k) => k.id), ['ai-check', 'read-later']);
  const c = readMarksConfig({ kinds: [{ id: 'read-later', label: '読む' }, { id: 'fact' }, { label: 'id が無い' }], contextLength: 16, aiProcedure: 'docs/x.md' });
  assert.deepStrictEqual(c.kinds.map((k) => [k.id, k.label]), [['read-later', '読む'], ['fact', 'fact']]);
  assert.strictEqual(c.kinds[0].color, d.kinds[1].color, '同じ id の既定の色');
  assert.strictEqual(c.contextLength, 16);
  assert.strictEqual(c.aiProcedure, 'docs/x.md');
  assert.strictEqual(c.contextParagraphs, d.contextParagraphs);
});

test('loadConfig: marks を読む', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-cfg-'));
  fs.writeFileSync(path.join(root, '.review-assist.json'), JSON.stringify({ marks: { aiProcedure: 'docs/notes/ai.md' } }));
  const { config } = loadConfig(root);
  assert.strictEqual(config.marks.aiProcedure, 'docs/notes/ai.md');
  assert.strictEqual(config.marks.kinds.length, 2);
});

test('groupMarks: 種類 → 章（catalog の順）→ 項目、済み／未済で絞る、設定に無い種類も出す', () => {
  const mk = (id, kind, file, line, status = 'open') => ({ id, kind, file, line, status, quote: 'q', prefix: '', suffix: '', note: '', created: '' });
  const data = {
    version: 1,
    marks: [mk('a', 'ai-check', 'gc.re', 5), mk('b', 'ai-check', 'vm.re', 9), mk('c', 'ai-check', 'vm.re', 2, 'done'), mk('d', 'old', 'vm.re', 1), mk('e', 'read-later', 'x.re', 1)],
  };
  const chapterOf = (f) => ({ 'gc.re': 'gc', 'vm.re': 'vm' })[f] ?? '';
  const g = groupMarks(data, defaultMarksConfig(), 'all', chapterOf, ['vm', 'gc']);
  assert.deepStrictEqual(
    g.map((x) => [x.kind.id, x.chapters.map((c) => [c.chapter, c.marks.map((m) => m.id)])]),
    [
      ['ai-check', [['vm', ['c', 'b']], ['gc', ['a']]]],
      ['read-later', [['', ['e']]]],
      ['old', [['vm', ['d']]]],
    ]
  );
  const open = groupMarks(data, defaultMarksConfig(), 'open', chapterOf, ['vm', 'gc']);
  assert.deepStrictEqual(open[0].chapters[0].marks.map((m) => m.id), ['b']);
  const done = groupMarks(data, defaultMarksConfig(), 'done', chapterOf, ['vm', 'gc']);
  assert.deepStrictEqual(done.map((x) => x.kind.id), ['ai-check']);
});

/** 小さな本を作る（catalog.yml と 2 章）。 */
function makeBook() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-book-'));
  fs.mkdirSync(path.join(root, 'contents'));
  fs.writeFileSync(path.join(root, 'catalog.yml'), 'CHAPS:\n  - contents/vm.re\n  - contents/gc.re\n');
  fs.writeFileSync(path.join(root, 'contents', 'vm.re'), BASE);
  fs.writeFileSync(
    path.join(root, 'contents', 'gc.re'),
    ['= GC', '', '== 印', '', '前の段落。', '', '印を付ける。```を含む文。', '', '後の段落。', '', '離れた段落。', ''].join('\n')
  );
  // `=` の無いファイル（book_mruby3 の sub-article と同じ形）
  fs.writeFileSync(path.join(root, 'contents', 'sub.re'), ['=={chap_X} X', '', '=== 概要', '', '動作: 何かする。', ''].join('\n'));
  fs.writeFileSync(path.join(root, '.review-assist.json'), JSON.stringify({ marks: { aiProcedure: 'docs/ai.md' } }));
  return root;
}

test('buildAiRequest: 依頼ファイルの形', () => {
  const root = makeBook();
  const idx = new ReviewIndex(root);
  idx.build();
  const cfg = idx.config.marks;
  const vm = BASE;
  const gc = fs.readFileSync(path.join(root, 'contents', 'gc.re'), 'utf8');
  const m1 = captureMark({ text: gc, file: 'contents/gc.re', start: gc.indexOf('印を付ける。'), end: gc.indexOf('印を付ける。') + 6, kind: 'ai-check', note: '本当？', contextLength: L, now: NOW });
  const m2 = captureMark({ text: vm, file: 'contents/vm.re', start: vm.indexOf('分岐の先で'), end: vm.indexOf('分岐の先で') + 5, kind: 'ai-check', contextLength: L, now: new Date(NOW.getTime() + 1) });
  const m3 = { ...m2, id: 'mdone', status: 'done' };
  const m4 = { ...m2, id: 'mlater', kind: 'read-later' };
  const m5 = { ...m2, id: 'mlost', quote: 'どこにも無い文', prefix: 'どこにも', suffix: '無い' };
  const sub = fs.readFileSync(path.join(root, 'contents', 'sub.re'), 'utf8');
  const m6 = captureMark({ text: sub, file: 'contents/sub.re', start: sub.indexOf('何かする。'), end: sub.indexOf('何かする。') + 5, kind: 'ai-check', contextLength: L, now: new Date(NOW.getTime() + 2) });
  const req = buildAiRequest(idx, { version: 1, marks: [m1, m2, m3, m4, m5, m6] }, cfg, { now: NOW });
  const md = req.markdown;
  // 未済の ai-check だけ、章の順（vm → gc）
  assert.deepStrictEqual(req.ids, [m2.id, 'mlost', m1.id, m6.id]);
  // 章の題の無いファイルの見出しの道筋は空の段を詰める
  assert.match(md, new RegExp(`## ${m6.id}[\\s\\S]*- 見出し: X > 概要\n`));
  assert.deepStrictEqual(req.lost, ['mlost']);
  assert.ok(md.indexOf(`## ${m2.id}`) < md.indexOf(`## ${m1.id}`));
  assert.ok(!md.includes('## mdone') && !md.includes('## mlater'));
  // 先頭に手順の文書、結果の書き先
  assert.match(md, /先に手順 `docs\/ai\.md` を読むこと/);
  assert.match(md, /`\.review-assist\/ai-results\.json`/);
  // 1 件の中身: 章・場所・見出しの道筋・メモ・選んだ文・前後の段落（離れた段落は入らない）
  const sec = md.slice(md.indexOf(`## ${m1.id}`), md.indexOf(`## ${m6.id}`));
  assert.match(sec, /- 章: gc/);
  assert.match(sec, /- 場所: contents\/gc\.re:7/);
  assert.match(sec, /- 見出し: GC > 印/);
  assert.match(sec, /- メモ: 本当？/);
  assert.ok(sec.includes('前の段落。') && sec.includes('後の段落。') && !sec.includes('離れた段落。'));
  // 選んだ文は ``` を含まないので囲みは 3 つ、前後は ``` を含むので 4 つ
  assert.ok(sec.includes('```review\n印を付ける。\n```'));
  assert.ok(sec.includes('````review\n前の段落。\n\n印を付ける。```を含む文。'));
  // 見失ったものは付けたときの文で出す
  assert.match(md, /## mlost[\s\S]*今は位置を見失っている[\s\S]*どこにも無い文/);
  // 末尾の雛形は JSON として読めて、そのまま parseAiResults に通る形
  const json = md.slice(md.lastIndexOf('```json\n') + 8, md.lastIndexOf('\n```'));
  const skeleton = JSON.parse(json);
  assert.deepStrictEqual(skeleton.results.map((r) => r.id), req.ids);
  assert.strictEqual(skeleton.results[2].quote, '印を付ける。');
  for (const r of skeleton.results) r.verdict = 'ok';
  const back = parseAiResults(JSON.stringify(skeleton), new Set(req.ids));
  assert.deepStrictEqual(back.problems, []);
  assert.strictEqual(back.results.size, 4);
});
