// 編集画面（dist/webview.js）の 1 か所を撮る（docs/verification の画像用）。
//
//   node tools/shot-editor.mjs <本のディレクトリ> <ファイル> <行> <出力.png> [--dark]
//
// 色は tools/editor-harness.html の Light Modern 相当。--dark で Dark Modern 相当の色に替える（VS Code の
// extensions/theme-defaults/themes/dark_modern.json の値）。カーソルは先頭に置くので、撮る所の記法はどれも畳まれている。
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, '..', 'dist', 'core.js'));
const { chromium } = require('playwright-core');

const [rootArg, rel, lineArg, out] = process.argv.slice(2);
const dark = process.argv.includes('--dark');
const root = path.resolve(rootArg);
const index = new core.ReviewIndex(root);
index.build();
const text = fs.readFileSync(index.abs(rel), 'utf8');
index.updateFile(rel, text);
const parsed = index.files.get(rel);
const images = {};
for (const [id, p] of Object.entries(core.imagePaths(index, parsed))) if (fs.existsSync(index.abs(p))) images[id] = pathToFileURL(index.abs(p)).toString();
const pl = core.loadPageIndex(index);
const data = {
  refs: core.refLabels(index, parsed),
  images,
  completions: [],
  ...(pl.pages ? { pages: core.headingPages(index, pl.pages, rel, parsed), pagesStale: false } : {}),
};
const DARK = {
  '--vscode-editor-foreground': '#CCCCCC',
  '--vscode-editor-background': '#1F1F1F',
  '--vscode-textLink-foreground': '#4daafc',
  '--vscode-descriptionForeground': '#9D9D9D',
  '--vscode-badge-background': '#616161',
  '--vscode-badge-foreground': '#F8F8F8',
  '--vscode-textCodeBlock-background': '#2B2B2B',
  '--vscode-textPreformat-background': '#3C3C3C',
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
await page.goto(pathToFileURL(path.join(here, 'editor-harness.html')).toString());
await page.evaluate(
  async ({ text, data, config, tw, line, vars }) => {
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    window.postMessage({ type: 'init', text, eol: '\n', config, textWidth: tw, seq: 0, ...data }, '*');
    await new Promise((r) => setTimeout(r, 50));
    await document.fonts.ready;
    const v = window.__reviewAssist.view;
    const pos = v.state.doc.line(line).from;
    v.dispatch({ selection: { anchor: 0 }, effects: window.__reviewAssistScroll(pos) });
    v.contentDOM.blur();
    await new Promise((r) => setTimeout(r, 300));
    v.scrollDOM.scrollTop = v.lineBlockAt(pos).top;
    await new Promise((r) => setTimeout(r, 300));
  },
  { text, data, config: index.config.editor, tw: core.resolveTextWidth(root, index.config.editor), line: Number(lineArg), vars: dark ? DARK : {} }
);
await page.screenshot({ path: out });
await browser.close();
console.log(out);
