// 編集画面のコード（地の文の @<code> とコードの本文）が、本文の書体ではなく等幅の書体で描かれるかを確かめる。
//
//   node tools/check-fonts.mjs <本のディレクトリ> [<ファイル>]
//
// Chromium の DevTools Protocol の `CSS.getPlatformFontsForNode` で、その要素の文字を実際に描いた書体の名前を取る。
// 3 とおりで開く:
//   既定          設定 editor.page.fonts の既定のまま（この機械にある書体で）
//   Windows 相当   コードの名前を Windows にある書体（Consolas、Cascadia Mono）だけにし、VS Code のエディタの書体を
//                  Windows の既定（Consolas, 'Courier New', monospace）にする。この機械にはどれも無いので、総称の monospace まで落ちる
//   等幅が全部無い コードの名前を存在しない書体だけにする（monospace まで落ちること、本文の明朝に落ちないこと）
// 合格: コードの欧文を描いた書体が本文の和文の書体（Noto Serif CJK JP など）でなく、等幅の書体（名前に Mono・Consolas・Courier を含む）。
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const core = require(path.join(here, '..', 'dist', 'core.js'));
const { chromium } = require('playwright-core');

const root = path.resolve(process.argv[2] ?? '');
const rel = process.argv[3] ?? 'contents/vm.re';
const index = new core.ReviewIndex(root);
index.build();
const text = fs.readFileSync(index.abs(rel), 'utf8');
const textWidth = core.resolveTextWidth(root, index.config.editor);

const variants = [
  { name: '既定', code: undefined, editorFont: 'monospace' },
  { name: 'Windows 相当', code: ['Consolas', 'Cascadia Mono'], editorFont: "Consolas, 'Courier New', monospace" },
  { name: '等幅が全部無い', code: ['NoSuchMonoA', 'NoSuchMonoB'], editorFont: 'NoSuchEditorFont' },
];

const browser = await chromium.launch();
let failures = 0;
for (const v of variants) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 3000 } });
  await page.goto(pathToFileURL(path.join(here, 'editor-harness.html')).toString());
  const config = JSON.parse(JSON.stringify(index.config.editor));
  if (v.code) config.page.fonts.code = v.code;
  await page.evaluate(
    async ({ text, config, textWidth, editorFont }) => {
      document.documentElement.style.setProperty('--vscode-editor-font-family', editorFont);
      window.postMessage({ type: 'init', text, eol: '\n', config, textWidth, seq: 0 }, '*');
      await new Promise((r) => setTimeout(r, 50));
      await document.fonts.ready;
      const view = window.__reviewAssist.view;
      view.dispatch({ selection: { anchor: 0 } });
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    },
    { text, config, textWidth, editorFont: v.editorFont }
  );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root: docRoot } = await cdp.send('DOM.getDocument', { depth: -1 });
  const fontsOf = async (selector) => {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector });
    if (!nodeId) return undefined;
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return fonts.map((f) => `${f.familyName}×${f.glyphCount}`);
  };
  const family = await page.evaluate(() => getComputedStyle(document.querySelector('.cm-ra-code')).fontFamily);
  const inline = await fontsOf('.cm-ra-code');
  const block = await fontsOf('.cm-ra-body-code');
  const body = await fontsOf('.cm-line.cm-ra-p');
  const bodyFace = (body ?? [])[0]?.split('×')[0];
  const isMono = (list) => !!list && list.length > 0 && /Mono|Consolas|Courier|Cascadia|Menlo/i.test(list[0]) && !list[0].startsWith(bodyFace ?? '\u0000');
  const ok = isMono(inline) && isMono(block);
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${v.name}`);
  console.log(`      @<code> の font-family: ${family}`);
  console.log(`      @<code> を描いた書体: ${inline?.join(', ')}`);
  console.log(`      コードの本文を描いた書体: ${block?.join(', ')}`);
  console.log(`      本文の行を描いた書体: ${body?.join(', ')}`);
  await page.close();
}
await browser.close();
process.exit(failures === 0 ? 0 : 1);
