// `.review-assist.json`（ワークスペース直下）。無ければ既定値で動く。
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface RuleConfig {
  /** JavaScript の正規表現（文字列）。`flags` を足さなければ `g` だけが付く。 */
  pattern: string;
  flags?: string;
  message: string;
  severity?: 'error' | 'warning' | 'info' | 'hint';
  /** `prose` = 地の文とキャプション、`code` = コードブロックの本文、`all` = 全部。既定は `prose`。 */
  scope?: 'prose' | 'code' | 'all';
  /** この glob に当たるファイルでは規則を当てない（旧表記そのものを説明している節など）。 */
  allowIn?: string[];
  /** 機械可読な識別子。省略すると連番。 */
  id?: string;
}

export interface TableWidthConfig {
  enable?: boolean;
  /**
   * 列数ごとの、`P{}` と `l` 列の見積もりの合計の上限。
   * 既定は book_mruby3/CLAUDE.md「紙面幅の制約」の 2 列 0.93 / 3 列 0.90 / 4 列 0.87。
   */
  limits?: Record<string, number>;
  /** `l` 列の幅の見積もり: 半角 1 文字あたりの `\textwidth` 比。既定 0.011（同上）。 */
  charWidth?: number;
}

export interface ReviewAssistConfig {
  /** catalog.yml の項目がファイル名だけのときに前に付けるディレクトリ。既定は `contents`。 */
  contentDir: string;
  /** 章 ID → その章の中身がある**元ファイル**の glob。生成物の章を元ファイルに読み替える。 */
  chapters: Record<string, string[]>;
  /** 索引から外す glob。`chapters` で読み替えた章の catalog 上のファイルは自動で外れる。 */
  exclude: string[];
  /** `@<img>` のホバーに出す PNG のパス。`{chapter}` と `{id}` を置き換える。 */
  imagePreview?: string;
  /** 「この節を PDF で開く」が開く PDF（ワークスペース相対）。 */
  pdf?: string;
  /** 見出し → ページ番号の索引 JSON（ワークスペース相対）。本側のスクリプトが作る。 */
  pageIndex?: string;
  /** 参照されていない `//table` を warning にする。 */
  warnUnreferencedTables: boolean;
  /**
   * コードブロック 1 行の上限。既定 80。
   * 根拠: book_mruby3/CLAUDE.md「紙面幅の制約」— `alltt` は 83 文字ではみ出すので 80 以内にする。
   */
  maxCodeLineLength: number;
  /**
   * コードブロックの行長の数え方。`chars`（既定、全角も 1 文字）か `halfwidth`（全角は 2）。
   * book_mruby3 の実測では `chars` が `Overfull hbox` の有無と合う。
   */
  codeLineWidth: 'chars' | 'halfwidth';
  /** `#@#` の中の TODO を info で出す。 */
  todoComments: boolean;
  tableWidth: TableWidthConfig;
  rules: RuleConfig[];
}

export const CONFIG_FILE = '.review-assist.json';

export function defaultConfig(): ReviewAssistConfig {
  return {
    contentDir: 'contents',
    chapters: {},
    exclude: [],
    warnUnreferencedTables: true,
    maxCodeLineLength: 80,
    codeLineWidth: 'chars',
    todoComments: true,
    tableWidth: { enable: true },
    rules: [],
  };
}

export interface LoadedConfig {
  config: ReviewAssistConfig;
  /** 読んだ設定ファイルのパス。無ければ undefined。 */
  path?: string;
  /** 設定ファイルが壊れていたときの説明。 */
  error?: string;
}

export function loadConfig(root: string): LoadedConfig {
  const file = path.join(root, CONFIG_FILE);
  const config = defaultConfig();
  if (!fs.existsSync(file)) return { config };
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ReviewAssistConfig>;
    if (typeof raw.contentDir === 'string') config.contentDir = raw.contentDir;
    if (raw.chapters && typeof raw.chapters === 'object') config.chapters = raw.chapters;
    if (Array.isArray(raw.exclude)) config.exclude = raw.exclude;
    if (typeof raw.imagePreview === 'string') config.imagePreview = raw.imagePreview;
    if (typeof raw.pdf === 'string') config.pdf = raw.pdf;
    if (typeof raw.pageIndex === 'string') config.pageIndex = raw.pageIndex;
    if (typeof raw.warnUnreferencedTables === 'boolean') config.warnUnreferencedTables = raw.warnUnreferencedTables;
    if (typeof raw.maxCodeLineLength === 'number') config.maxCodeLineLength = raw.maxCodeLineLength;
    if (raw.codeLineWidth === 'chars' || raw.codeLineWidth === 'halfwidth') config.codeLineWidth = raw.codeLineWidth;
    if (typeof raw.todoComments === 'boolean') config.todoComments = raw.todoComments;
    if (raw.tableWidth && typeof raw.tableWidth === 'object') config.tableWidth = { ...config.tableWidth, ...raw.tableWidth };
    if (Array.isArray(raw.rules)) config.rules = raw.rules;
    return { config, path: file };
  } catch (e) {
    return { config, path: file, error: e instanceof Error ? e.message : String(e) };
  }
}
