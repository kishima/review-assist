// catalog.yml を読む。Re:VIEW 2.5 の catalog は PREDEF / CHAPS / APPENDIX / POSTDEF の
// 4 つのセクションに、ファイル名かパスを並べたもの。CHAPS だけは部（part）で入れ子にできる。
// YAML の全機能は要らないので、行ベースで読む（実行時依存を持たない方針）。

export type CatalogSection = 'PREDEF' | 'CHAPS' | 'APPENDIX' | 'POSTDEF';

export interface CatalogEntry {
  /** catalog.yml に書かれていたそのままの文字列（`contents/vm.re` か `vm.re`）。 */
  raw: string;
  section: CatalogSection;
  /** part の見出しファイル（`- part1.re:` の形）なら true。 */
  isPart: boolean;
}

const SECTIONS: CatalogSection[] = ['PREDEF', 'CHAPS', 'APPENDIX', 'POSTDEF'];

export function parseCatalog(text: string): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  let section: CatalogSection | undefined;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '');
    if (!line.trim()) continue;
    const head = /^([A-Z]+):\s*$/.exec(line.trim());
    if (head && SECTIONS.includes(head[1] as CatalogSection)) {
      section = head[1] as CatalogSection;
      continue;
    }
    if (!section) continue;
    const item = /^\s*-\s*(.+?)\s*$/.exec(line);
    if (!item) continue;
    let value = item[1];
    let isPart = false;
    // `- part1.re:` は部の見出し。続く行のより深い `-` がその部の章。
    if (value.endsWith(':')) {
      value = value.slice(0, -1).trim();
      isPart = true;
    }
    value = value.replace(/^["']|["']$/g, '');
    if (!value || !value.endsWith('.re')) continue;
    out.push({ raw: value, section, isPart });
  }
  return out;
}

/** 拡張子とディレクトリを落として章 ID にする（`contents/vm.re` → `vm`）。 */
export function chapterIdOf(raw: string): string {
  const base = raw.split('/').pop() ?? raw;
  return base.replace(/\.re$/, '');
}
