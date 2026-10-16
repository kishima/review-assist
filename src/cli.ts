// VS Code 無しで、ワークスペース全体を索引して診断を一覧で出す。
// Extension Development Host が使えない環境での確認と、CI での見張りに使う。
//
//   node dist/cli.js <ワークスペース> [--only code1,code2] [--json] [--quiet]
//   node dist/cli.js marks <ワークスペース> [--request]
//     マーカーの一覧（今の位置、見失ったか、AI の結果）。--request で AI チェックの依頼を書き出す。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ReviewIndex } from './core/index.js';
import { anchorMark, buildAiRequest, loadAiResults, loadMarks, posAt, writeAiRequest } from './core/marks.js';
import { diagnoseWorkspace } from './core/diagnostics.js';
import type { Diagnostic } from './core/types.js';

function parseArgs(argv: string[]) {
  const out = { root: process.cwd(), only: [] as string[], json: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--quiet') out.quiet = true;
    else if (a === '--only') out.only = (argv[++i] ?? '').split(',').filter(Boolean);
    else out.root = path.resolve(a);
  }
  return out;
}

function severityRank(d: Diagnostic): number {
  return { error: 0, warning: 1, info: 2, hint: 3 }[d.severity];
}

function marksMain(argv: string[]): number {
  const root = path.resolve(argv.find((a) => !a.startsWith('--')) ?? process.cwd());
  const index = new ReviewIndex(root);
  index.build();
  if (index.noCatalog) {
    console.error(`catalog.yml が ${root} に無い`);
    return 2;
  }
  const cfg = index.config.marks;
  const load = loadMarks(root, cfg);
  for (const p of load.problems) console.error(`${load.path}: ${p}`);
  const results = loadAiResults(root, cfg, new Set(load.data.marks.map((m) => m.id)));
  for (const p of results.problems) console.error(`${results.path}: ${p}`);
  if (results.unknownIds.length > 0) console.error(`${results.path}: marks.json に無い id ${results.unknownIds.join(', ')}`);
  console.log(`marks:   ${load.path}（${load.data.marks.length} 件）`);
  console.log(`results: ${results.exists ? `${results.path}（${results.results.size} 件）` : '(無い)'}`);
  console.log('');
  for (const m of load.data.marks) {
    const abs = index.abs(m.file);
    const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : undefined;
    const a = text === undefined ? ({ kind: 'lost' } as const) : anchorMark(text, m);
    const where = a.kind === 'lost' || text === undefined ? `${m.file}:${m.line}（見失った）` : `${m.file}:${posAt(text, a.start).line + 1}${a.kind === 'fuzzy' ? '（文が直されている）' : ''}`;
    const r = results.results.get(m.id);
    console.log(`${m.id}  ${m.kind}  ${m.status}  ${where}`);
    console.log(`    「${m.quote.replace(/\n/g, '⏎')}」${m.note ? ` メモ: ${m.note}` : ''}`);
    if (r) console.log(`    AI: ${r.verdict} ${r.comment}${r.suggestion !== undefined ? ` 案:「${r.suggestion.replace(/\n/g, '⏎')}」` : ''}`);
  }
  if (argv.includes('--request')) {
    const req = buildAiRequest(index, load.data, cfg);
    const file = writeAiRequest(root, cfg, req);
    console.log('');
    console.log(`依頼: ${file}（${req.ids.length} 件${req.lost.length > 0 ? `、うち見失った ${req.lost.length}` : ''}）`);
  }
  return 0;
}

function main(): number {
  if (process.argv[2] === 'marks') return marksMain(process.argv.slice(3));
  const args = parseArgs(process.argv.slice(2));
  const index = new ReviewIndex(args.root);

  const t0 = process.hrtime.bigint();
  index.build();
  const buildMs = Number(process.hrtime.bigint() - t0) / 1e6;

  if (index.noCatalog) {
    console.error(`catalog.yml が ${args.root} に無い`);
    return 2;
  }
  if (index.configLoad.error) {
    console.error(`.review-assist.json が読めない: ${index.configLoad.error}`);
    return 2;
  }

  const t1 = process.hrtime.bigint();
  let diags = diagnoseWorkspace(index);
  const diagMs = Number(process.hrtime.bigint() - t1) / 1e6;
  if (args.only.length > 0) diags = diags.filter((d) => args.only.some((c) => d.code === c || d.code.startsWith(c + '.')));

  if (args.json) {
    console.log(JSON.stringify({ root: args.root, buildMs, diagMs, diagnostics: diags }, null, 2));
    return diags.some((d) => d.severity === 'error') ? 1 : 0;
  }

  const headings = [...index.files.values()].reduce((n, f) => n + f.headings.length, 0);
  const blocks = [...index.files.values()].reduce((n, f) => n + f.blocks.length, 0);
  const refs = [...index.files.values()].reduce((n, f) => n + f.refs.length, 0);
  const lines = [...index.files.values()].reduce((n, f) => n + f.lines.length, 0);

  console.log(`workspace: ${args.root}`);
  console.log(`config:    ${index.configLoad.path ?? '(既定値)'}`);
  console.log(
    `index:     ${index.chapters.size} 章 / ${index.files.size} ファイル / ${lines} 行 / ` +
      `見出し ${headings} / ブロック ${blocks} / インライン命令 ${refs}`
  );
  console.log(`time:      索引 ${buildMs.toFixed(1)} ms、診断 ${diagMs.toFixed(1)} ms`);
  console.log('');

  if (!args.quiet) {
    let lastFile = '';
    for (const d of [...diags].sort((a, b) => (a.file === b.file ? severityRank(a) - severityRank(b) || a.span.start.line - b.span.start.line : a.file < b.file ? -1 : 1))) {
      if (d.file !== lastFile) {
        console.log(`--- ${d.file}`);
        lastFile = d.file;
      }
      console.log(`  ${d.severity.padEnd(7)} ${String(d.span.start.line + 1).padStart(5)}:${String(d.span.start.column + 1).padEnd(3)} [${d.code}] ${d.message}`);
    }
    if (diags.length > 0) console.log('');
  }

  const byCode = new Map<string, number>();
  for (const d of diags) byCode.set(d.code, (byCode.get(d.code) ?? 0) + 1);
  console.log('summary:');
  for (const [code, n] of [...byCode.entries()].sort()) console.log(`  ${String(n).padStart(5)}  ${code}`);
  const errors = diags.filter((d) => d.severity === 'error').length;
  console.log(`  ${String(diags.length).padStart(5)}  合計（error ${errors}）`);

  return errors > 0 ? 1 : 0;
}

process.exit(main());
