// 設定 `editor`（記法を畳む編集画面、0.3.0）。webview の束にも入るので、ファイルシステムに触らない。

/** 記法を畳む編集画面（0.3.0）。数の出どころは docs/design/thresholds.md の「編集画面」。 */
export interface EditorConfig {
  /** `@<hidx>` の見せ方。`hide`（印ごと隠す。紙面に出ないため）か `faint`（薄く出す）。 */
  hidx: 'hide' | 'faint';
  /**
   * 見出しの文字の大きさ（本文に対する倍率）。`=` から順に。足りない深さは最後の値。
   * 既定は HTML の h1〜h5 の既定の大きさ（HTML Living Standard「15.3.6 Sections and headings」）。
   */
  headingScale: number[];
  /** 表の列の間に足す幅（半角の個数）。既定 2 は見た目で置いた仮の値（段階 3 で紙面から決め直す）。 */
  tableGap: number;
}

export function defaultEditorConfig(): EditorConfig {
  return { hidx: 'hide', headingScale: [2, 1.5, 1.17, 1, 0.83], tableGap: 2 };
}

export function readEditorConfig(raw: unknown): EditorConfig {
  const config = defaultEditorConfig();
  if (!raw || typeof raw !== 'object') return config;
  const r = raw as Record<string, unknown>;
  if (r.hidx === 'hide' || r.hidx === 'faint') config.hidx = r.hidx;
  if (Array.isArray(r.headingScale) && r.headingScale.length > 0 && r.headingScale.every((n) => typeof n === 'number' && n > 0)) {
    config.headingScale = r.headingScale as number[];
  }
  if (typeof r.tableGap === 'number' && r.tableGap >= 0) config.tableGap = r.tableGap;
  return config;
}
