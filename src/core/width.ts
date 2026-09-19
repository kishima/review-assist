// 文字の幅を半角の個数で数える。East Asian Width が W（Wide）か F（Fullwidth）の文字を 2、
// それ以外を 1 とする。book_mruby3/CLAUDE.md の「`l` 列の幅は最長セルの半角換算文字数 ×
// 0.012（全角は 2 文字）」の「半角換算」がこれ。

/** 全角（W / F）の符号位置の範囲。Unicode 15 の EastAsianWidth.txt から主要なものを取った。 */
const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f], // ハングル字母
  [0x2e80, 0x303e], // CJK 部首補助〜CJK の記号と句読点
  [0x3041, 0x33ff], // ひらがな・カタカナ・ハングル・CJK 互換
  [0x3400, 0x4dbf], // CJK 統合漢字拡張 A
  [0x4e00, 0x9fff], // CJK 統合漢字
  [0xa000, 0xa4cf], // イ文字
  [0xac00, 0xd7a3], // ハングル音節
  [0xf900, 0xfaff], // CJK 互換漢字
  [0xfe10, 0xfe19], // 縦書き形
  [0xfe30, 0xfe6f], // CJK 互換形・小字形
  [0xff00, 0xff60], // 全角 ASCII・全角句読点
  [0xffe0, 0xffe6], // 全角記号
  [0x1f300, 0x1f64f], // 絵文字
  [0x1f900, 0x1f9ff],
  [0x20000, 0x2fffd], // CJK 統合漢字拡張 B 以降
  [0x30000, 0x3fffd],
];

export function charColumns(codePoint: number): number {
  for (const [lo, hi] of WIDE_RANGES) {
    if (codePoint >= lo && codePoint <= hi) return 2;
    if (codePoint < lo) break;
  }
  return 1;
}

/** 文字列の半角換算の長さ。 */
export function displayWidth(text: string): number {
  let w = 0;
  for (const ch of text) w += charColumns(ch.codePointAt(0)!);
  return w;
}
