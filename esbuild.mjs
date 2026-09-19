// dist/extension.js（VS Code 拡張の本体）と dist/cli.js（VS Code 無しで動く CLI）を作る。
// 実行時依存は持たない方針なので bundle して 1 ファイルずつにする。`vscode` だけは
// VS Code が実行時に用意するので external にする。
import { build, context } from 'esbuild';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  platform: 'node',
  // VS Code 1.85 は Electron 25 / Node 18。Node 18 が読める構文に合わせる。
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  logLevel: 'info',
};

const targets = [
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] },
  { ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js' },
  // テスト（node:test）が読む口。VS Code に依存しない層だけが入る。
  { ...common, entryPoints: ['src/core/all.ts'], outfile: 'dist/core.js' },
];

if (watch) {
  for (const t of targets) {
    const ctx = await context(t);
    await ctx.watch();
  }
} else {
  await Promise.all(targets.map((t) => build(t)));
}
