// `.review-assist.json`（ワークスペース直下）。無ければ既定値で動く。
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface ReviewAssistConfig {
  /** catalog.yml の項目がファイル名だけのときに前に付けるディレクトリ。既定は `contents`。 */
  contentDir: string;
  /** 章 ID → その章の中身がある**元ファイル**の glob。生成物の章を元ファイルに読み替える。 */
  chapters: Record<string, string[]>;
  /** 索引から外す glob。`chapters` で読み替えた章の catalog 上のファイルは自動で外れる。 */
  exclude: string[];
  /** `@<img>` のホバーに出す PNG のパス。`{chapter}` と `{id}` を置き換える。 */
  imagePreview?: string;
  /** 参照されていない `//table` を warning にする。 */
  warnUnreferencedTables: boolean;
}

export const CONFIG_FILE = '.review-assist.json';

export function defaultConfig(): ReviewAssistConfig {
  return {
    contentDir: 'contents',
    chapters: {},
    exclude: [],
    warnUnreferencedTables: true,
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
    if (typeof raw.warnUnreferencedTables === 'boolean') config.warnUnreferencedTables = raw.warnUnreferencedTables;
    return { config, path: file };
  } catch (e) {
    return { config, path: file, error: e instanceof Error ? e.message : String(e) };
  }
}
