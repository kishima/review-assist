// VS Code 無しで、ワークスペース全体を索引して診断を一覧で出す。
// Extension Development Host が使えない環境での確認と、CI での見張りに使う。
//
//   node dist/cli.js <ワークスペース> [--only code1,code2] [--json] [--quiet]
import * as path from 'node:path';
import { ReviewIndex } from './core/index.js';
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

function main(): number {
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
