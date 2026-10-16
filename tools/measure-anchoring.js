// マーカーの位置の探し直しを、本の git log の実際の修正に当てて測る。
//
//   npm run build && node tools/measure-anchoring.js /path/to/book [--lengths 0,8,16,32,64,128] [--json]
//
// 各コミット C について、C^ の .re の地の文を「。」で文に切り、1 文ずつマーカーにする
// （前後の文脈は長さ L）。それを C の .re で探し直し、`git diff -U0` から決まる正解と比べる。
//
//  * 行が変わっていない文: 正解は対応する新しい行の同じ桁。そこに exact で当たれば「正しい」、
//    別の所に当たれば「取り違え」、当たらなければ「見失った」
//  * 修正の hunk に入った文: 新しい側の hunk の行のどこかに当たれば「正しい」、hunk の外に
//    当たれば「取り違え」、当たらなければ「見失った」。文がそのまま残っているか（hunk の
//    新しい側に quote があるか）で 2 つに分けて数える
//
// 生成物（contents/opcodes.re と、contents/ に移す前の chapter03.re）は外す。
'use strict';
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { parseReview, captureMark, anchorMark, lineStarts, posAt } = require('../dist/core.js');

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith('--')) ?? '.');
const li = args.indexOf('--lengths');
const lengths = (li >= 0 ? args[li + 1] : '0,8,16,32,64,128').split(',').map(Number);
const asJson = args.includes('--json');
const wi = args.indexOf('--show-wrong');
const showWrong = wi >= 0 ? Number(args[wi + 1]) : undefined;
const GENERATED = new Set(['opcodes.re', 'chapter03.re']);

const git = (...a) => execFileSync('git', ['-C', root, ...a], { encoding: 'utf8', maxBuffer: 1 << 28 });

const commits = git('log', '--format=%H %P', '--', '*.re')
  .trim()
  .split('\n')
  .map((l) => l.split(' '))
  .filter((p) => p.length === 2); // 親が 1 つのもの（根とマージは外す）

function hunksOf(parent, commit, oldPath, newPath) {
  const out = git('diff', '-U0', '-M', '--no-color', parent, commit, '--', oldPath, newPath);
  const hunks = [];
  for (const m of out.matchAll(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm)) {
    const a = Number(m[1]);
    const b = m[2] === undefined ? 1 : Number(m[2]);
    const c = Number(m[3]);
    const d = m[4] === undefined ? 1 : Number(m[4]);
    // 0 起点の [start, end)。長さ 0 の側は「その行の後ろに入る」なので start は a（1 起点の a 行の次）。
    hunks.push({ oldStart: b === 0 ? a : a - 1, oldEnd: b === 0 ? a : a - 1 + b, newStart: d === 0 ? c : c - 1, newEnd: d === 0 ? c : c - 1 + d });
  }
  return hunks;
}

function sentences(text, parsed) {
  const starts = lineStarts(text);
  const out = [];
  parsed.lines.forEach((line, ln) => {
    if (parsed.lineKinds[ln] !== 'prose' || line.trim() === '' || line.startsWith('=')) return;
    let from = 0;
    for (const m of line.matchAll(/[^。]*。|[^。]+$/g)) {
      const s = m[0];
      const lead = s.length - s.trimStart().length;
      const body = s.trim();
      from = m.index + lead;
      if (body.length > 0) out.push({ line: ln, column: from, start: starts[ln] + from, end: starts[ln] + from + body.length });
    }
  });
  return out;
}

const stats = new Map(lengths.map((L) => [L, { unchanged: [0, 0, 0], kept: [0, 0, 0], moved: [0, 0, 0], edited: [0, 0, 0] }]));
// [正しい, 取り違え, 見失った]
let pairs = 0;
let sampled = 0;
const t0 = Date.now();
for (const [commit, parent] of commits) {
  const status = git('diff', '-M', '--name-status', parent, commit, '--', '*.re').trim();
  if (!status) continue;
  for (const row of status.split('\n')) {
    const cols = row.split('\t');
    const st = cols[0][0];
    if (st !== 'M' && st !== 'R') continue;
    const oldPath = cols[1];
    const newPath = cols[st === 'R' ? 2 : 1];
    if (GENERATED.has(path.posix.basename(newPath)) || GENERATED.has(path.posix.basename(oldPath))) continue;
    const hunks = hunksOf(parent, commit, oldPath, newPath);
    if (hunks.length === 0) continue;
    const oldText = git('show', `${parent}:${oldPath}`);
    const newText = git('show', `${commit}:${newPath}`);
    const newStarts = lineStarts(newText);
    const newLines = newText.split('\n');
    pairs++;
    const parsed = parseReview(oldPath, oldText, '');
    for (const s of sentences(oldText, parsed)) {
      sampled++;
      const hunk = hunks.find((h) => s.line >= h.oldStart && s.line < h.oldEnd);
      let expect;
      if (hunk) {
        const region = newLines.slice(hunk.newStart, hunk.newEnd).join('\n');
        const quote = oldText.slice(s.start, s.end);
        const span = (h) => ({ from: newStarts[h.newStart] ?? newText.length, to: h.newEnd < newStarts.length ? newStarts[h.newEnd] : newText.length });
        if (region.includes(quote)) expect = { kind: 'kept', spans: [span(hunk)] };
        else {
          // 別の hunk の新しい側にそのまま出てくる = 段落を移した。正解はその hunk。
          const others = hunks.filter((h) => h !== hunk && newLines.slice(h.newStart, h.newEnd).join('\n').includes(quote));
          expect = others.length > 0 ? { kind: 'moved', spans: others.map(span) } : { kind: 'edited', spans: [span(hunk)] };
        }
      } else {
        let delta = 0;
        for (const h of hunks) if (h.oldEnd <= s.line) delta += h.newEnd - h.newStart - (h.oldEnd - h.oldStart);
        expect = { kind: 'unchanged', at: newStarts[s.line + delta] + s.column };
      }
      for (const L of lengths) {
        const mark = captureMark({ text: oldText, file: newPath, start: s.start, end: s.end, kind: 'x', contextLength: L, now: new Date(0) });
        const a = anchorMark(newText, mark);
        const bucket = stats.get(L)[expect.kind];
        if (a.kind === 'lost') bucket[2]++;
        else if (expect.kind === 'unchanged' ? a.kind === 'exact' && a.start === expect.at : expect.spans.some((sp) => a.start >= sp.from && a.start <= sp.to)) bucket[0]++;
        else {
          bucket[1]++;
          if (showWrong && L === showWrong) console.error(`取り違え L=${L} ${expect.kind} ${commit.slice(0, 7)} ${newPath}:${s.line + 1} 「${oldText.slice(s.start, s.end)}」 → ${a.kind} ${newPath}:${posAt(newText, a.start).line + 1}`);
        }
      }
    }
  }
}
const ms = Date.now() - t0;

const pct = (n, d) => (d === 0 ? '-' : `${((100 * n) / d).toFixed(2)}%`);
if (asJson) {
  console.log(JSON.stringify({ root, commits: commits.length, pairs, sampled, ms, stats: Object.fromEntries(stats) }, null, 2));
} else {
  console.log(`book: ${root}`);
  console.log(`commits ${commits.length}（親 1 つ）、変更のあったファイルの組 ${pairs}、文 ${sampled}、${ms} ms`);
  console.log('');
  const names = { unchanged: '行が不変', kept: 'hunk 内・文が残る', moved: '別の hunk に移った', edited: '文が直された' };
  console.log('| L | 分類 | 件数 | 正しい | 取り違え | 見失った |');
  console.log('|---|---|---|---|---|---|');
  for (const [L, s] of stats) {
    for (const [k, b] of Object.entries(s)) {
      const n = b[0] + b[1] + b[2];
      console.log(`| ${L} | ${names[k]} | ${n} | ${b[0]} (${pct(b[0], n)}) | ${b[1]} (${pct(b[1], n)}) | ${b[2]} (${pct(b[2], n)}) |`);
    }
  }
}
