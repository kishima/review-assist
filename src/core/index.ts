// ワークスペース（catalog.yml のあるディレクトリ）の索引。
// 章 → 元ファイル → 見出し・ブロック・参照、という対応を持つ。ファイルの差分更新ができる。
import * as fs from 'node:fs';
import * as path from 'node:path';
import { chapterIdOf, parseCatalog, type CatalogSection } from './catalog.js';
import { loadConfig, type LoadedConfig, type ReviewAssistConfig } from './config.js';
import { matchesAny } from './glob.js';
import { parseReview } from './parser.js';
import type { Block, Heading, InlineRef, ParsedFile } from './types.js';

export interface Chapter {
  id: string;
  section: CatalogSection;
  /** catalog.yml が指しているファイル（ワークスペース相対）。 */
  catalogFile: string;
  /** この章の中身がある元ファイル。設定 `chapters` が無ければ catalogFile 1 本。 */
  files: string[];
  /** catalogFile が `chapters` で読み替えられている（= 生成物）。 */
  generated: boolean;
}

/** 参照を解決した結果。 */
export interface Target {
  kind: 'chapter' | 'heading' | 'block';
  file: string;
  heading?: Heading;
  block?: Block;
  chapter: Chapter;
  /** どの規則で当たったか（ホバーと worklog 用）。 */
  via: string;
}

export class ReviewIndex {
  readonly root: string;
  config: ReviewAssistConfig;
  configLoad: LoadedConfig;
  chapters = new Map<string, Chapter>();
  /** 章の並び（catalog.yml の順）。 */
  chapterOrder: string[] = [];
  /** ワークスペース相対パス → 解析結果。 */
  files = new Map<string, ParsedFile>();
  /** ファイル → 属する章 ID（属さなければ undefined）。 */
  private fileChapter = new Map<string, string>();
  /** catalog.yml が見つからなかったときに true。 */
  noCatalog = false;

  constructor(root: string) {
    this.root = root;
    this.configLoad = loadConfig(root);
    this.config = this.configLoad.config;
  }

  /** ワークスペース相対パスへ（区切りは `/`）。 */
  rel(abs: string): string {
    return path.relative(this.root, abs).split(path.sep).join('/');
  }

  abs(rel: string): string {
    return path.join(this.root, ...rel.split('/'));
  }

  /** catalog.yml と設定を読み直し、対象のファイルを全部解析する。 */
  build(): void {
    this.configLoad = loadConfig(this.root);
    this.config = this.configLoad.config;
    this.chapters.clear();
    this.chapterOrder = [];
    this.files.clear();
    this.fileChapter.clear();

    const catalogPath = path.join(this.root, 'catalog.yml');
    if (!fs.existsSync(catalogPath)) {
      this.noCatalog = true;
      return;
    }
    this.noCatalog = false;
    const entries = parseCatalog(fs.readFileSync(catalogPath, 'utf8'));

    const overridden = new Set<string>();
    for (const entry of entries) {
      const id = chapterIdOf(entry.raw);
      const catalogFile = this.resolveCatalogEntry(entry.raw);
      const override = this.config.chapters[id];
      let files: string[];
      let generated = false;
      if (override && override.length > 0) {
        files = this.expandGlobs(override);
        generated = true;
        overridden.add(catalogFile);
      } else {
        files = [catalogFile];
      }
      const chapter: Chapter = { id, section: entry.section, catalogFile, files, generated };
      this.chapters.set(id, chapter);
      this.chapterOrder.push(id);
    }

    // 読み替えられた章の生成物（contents/opcodes.re など）は索引から外す。
    // 中身は元ファイルと同じなので、両方入れると id と label が二重になる。
    const excluded = (rel: string) => overridden.has(rel) || matchesAny(rel, this.config.exclude);

    for (const chapter of this.chapters.values()) {
      for (const file of chapter.files) {
        if (excluded(file)) continue;
        this.fileChapter.set(file, chapter.id);
      }
    }

    // 章に属さない `.re` も読む（catalog に入れ忘れたファイルでもアウトラインは出したい）。
    for (const file of this.listReFiles()) {
      if (excluded(file)) continue;
      if (!this.fileChapter.has(file)) this.fileChapter.set(file, '');
    }

    for (const file of this.fileChapter.keys()) this.parseFile(file);
  }

  /** 1 ファイルだけ読み直す（エディタでの編集用）。索引に無いファイルは足す。 */
  updateFile(rel: string, text?: string): void {
    if (matchesAny(rel, this.config.exclude)) return;
    if (!this.fileChapter.has(rel)) this.fileChapter.set(rel, this.chapterOfPath(rel));
    this.parseFile(rel, text);
  }

  removeFile(rel: string): void {
    this.files.delete(rel);
    this.fileChapter.delete(rel);
  }

  private parseFile(rel: string, text?: string): void {
    const abs = this.abs(rel);
    let body = text;
    if (body === undefined) {
      if (!fs.existsSync(abs)) {
        this.files.delete(rel);
        return;
      }
      body = fs.readFileSync(abs, 'utf8');
    }
    this.files.set(rel, parseReview(rel, body, this.fileChapter.get(rel) ?? ''));
  }

  private chapterOfPath(rel: string): string {
    for (const chapter of this.chapters.values()) {
      if (chapter.files.includes(rel)) return chapter.id;
    }
    return '';
  }

  chapterOfFile(rel: string): string {
    return this.fileChapter.get(rel) ?? this.chapterOfPath(rel);
  }

  /** catalog.yml の項目を、実在するパスに直す。 */
  private resolveCatalogEntry(raw: string): string {
    const candidates = raw.includes('/') ? [raw] : [path.posix.join(this.config.contentDir, raw), raw];
    for (const c of candidates) {
      if (fs.existsSync(this.abs(c))) return c;
    }
    return candidates[0];
  }

  private expandGlobs(globs: string[]): string[] {
    const all = this.listReFiles();
    const out: string[] = [];
    for (const g of globs) {
      if (!/[*?]/.test(g)) {
        const direct = g.includes('/') ? g : path.posix.join(this.config.contentDir, g);
        out.push(fs.existsSync(this.abs(g)) ? g : direct);
        continue;
      }
      for (const f of all) if (matchesAny(f, [g])) out.push(f);
    }
    return [...new Set(out)];
  }

  private reFileCache: string[] | undefined;

  /** ワークスペース下の `.re` を全部。`node_modules` などは見ない。 */
  listReFiles(refresh = false): string[] {
    if (this.reFileCache && !refresh) return this.reFileCache;
    const skip = new Set(['node_modules', '.git', 'dist', 'out', '.review-assist-cache']);
    const out: string[] = [];
    const walk = (dir: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith('.') && e.isDirectory()) continue;
        if (skip.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile() && e.name.endsWith('.re')) out.push(this.rel(full));
      }
    };
    walk(this.root);
    out.sort();
    this.reFileCache = out;
    return out;
  }

  headingsOfChapter(id: string): Heading[] {
    const chapter = this.chapters.get(id);
    if (!chapter) return [];
    const out: Heading[] = [];
    for (const file of chapter.files) {
      const parsed = this.files.get(file);
      if (parsed) out.push(...parsed.headings);
    }
    return out;
  }

  blocksOfChapter(id: string): Block[] {
    const chapter = this.chapters.get(id);
    if (!chapter) return [];
    const out: Block[] = [];
    for (const file of chapter.files) {
      const parsed = this.files.get(file);
      if (parsed) out.push(...parsed.blocks);
    }
    return out;
  }

  allRefs(): InlineRef[] {
    const out: InlineRef[] = [];
    for (const parsed of this.files.values()) out.push(...parsed.refs);
    return out;
  }
}
