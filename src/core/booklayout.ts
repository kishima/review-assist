// 本の組版の設定から、編集画面（0.3.0）の紙面に近い見た目に要るものを読む。今は本文の幅だけ。
//
// Re:VIEW（LaTeX）の本文の幅は `sty/` の中で `\setlength{\textwidth}{49zw}` のように決まる（Re:VIEW Starter の
// `sty/mytextsize.sty`）。zw は和文 1 文字の幅なので、編集画面では「全角 N 文字」の幅として使える。
// 文字の大きさ（`config.yml` の `texdocumentclass` の `9pt` など）は読まない。編集画面は本文の 1zw を
// VS Code のエディタの文字の大きさに当て、ほかを比で決めるので、紙面の pt は要らない。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DEFAULT_TEXT_WIDTH_ZW, type EditorConfig } from './editor-config.js';

export interface TextWidth {
  zw: number;
  /** どこから来たか（`sty/mytextsize.sty:28`、`設定`、`既定`）。 */
  from: string;
}

/** `sty/*.sty` から `\setlength{\textwidth}{Nzw}` を探す（`%` から後はコメント）。最後に書かれたものが効く。 */
export function readTextWidth(root: string): TextWidth | undefined {
  const dir = path.join(root, 'sty');
  let files: string[];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.sty')).sort();
  } catch {
    return undefined;
  }
  let found: TextWidth | undefined;
  for (const f of files) {
    const lines = fs.readFileSync(path.join(dir, f), 'utf8').split(/\r?\n/);
    lines.forEach((raw, i) => {
      const line = raw.replace(/(^|[^\\])%.*$/, '$1');
      const m = /\\setlength\s*\{\s*\\textwidth\s*\}\s*\{\s*([0-9.]+)\s*zw\s*\}/.exec(line);
      if (m) found = { zw: Number(m[1]), from: `sty/${f}:${i + 1}` };
    });
  }
  return found;
}

/** 設定 `editor.page.textWidth` を数に直す。 */
export function resolveTextWidth(root: string, config: EditorConfig): TextWidth {
  const w = config.page.textWidth;
  if (typeof w === 'number') return { zw: w, from: '設定' };
  return readTextWidth(root) ?? { zw: DEFAULT_TEXT_WIDTH_ZW, from: '既定' };
}

/** Re:VIEW 2.5.0 の `secnolevel` の既定（`lib/review/configure.rb` の `'secnolevel' => 2`）。 */
export const DEFAULT_SECNOLEVEL = 2;

/** `config.yml` の `secnolevel:`（番号を付ける見出しの深さ。`@<hd>` の印刷に番号を付けるか）。`#` から後はコメント。 */
export function readSecnolevel(root: string): number {
  let text: string;
  try {
    text = fs.readFileSync(path.join(root, 'config.yml'), 'utf8');
  } catch {
    return DEFAULT_SECNOLEVEL;
  }
  let found = DEFAULT_SECNOLEVEL;
  for (const raw of text.split(/\r?\n/)) {
    const m = /^secnolevel:\s*(\d+)/.exec(raw.replace(/#.*$/, ''));
    if (m) found = Number(m[1]);
  }
  return found;
}
