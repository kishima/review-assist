// 編集画面（0.3.0）の、拡張の側（extension host）と webview の間のやりとりの形。
// 型だけで、どちらの束にも入る。
//
// 位置は行と桁（0 起点、桁は UTF-16）で渡す。通しの位置で渡さないのは、CRLF の原稿では
// VS Code（`\r\n` を 2 文字と数える）と CodeMirror（行の切れ目を 1 文字と数える）で数え方が違うため。
import type { EditorConfig } from './editor-config.js';
import type { CompletionCandidate } from './editing.js';

/** 参照の札 1 枚。`ok` が false なら先が無い（赤）。 */
export interface RefLabel {
  text: string;
  ok: boolean;
  ambiguous?: boolean;
}

export interface LineCol {
  line: number;
  col: number;
}

export interface TextChange {
  from: LineCol;
  to: LineCol;
  insert: string;
}

/** 編集画面に出すマーカー 1 件（位置は拡張の側で探し直したもの）。 */
export interface MarkView {
  id: string;
  from: LineCol;
  to: LineCol;
  kind: string;
  kindLabel: string;
  color: string;
  background: string;
  status: 'open' | 'done';
  note: string;
  /** AI の結果（あれば）。 */
  verdict?: string;
  verdictLabel?: string;
  comment?: string;
  hasSuggestion?: boolean;
  suggestion?: string;
  /** AI が見た後で文が変わっている。 */
  stale?: boolean;
}

/** VS Code の診断（この拡張の規則、textlint など）1 件。 */
export interface DiagView {
  from: LineCol;
  to: LineCol;
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  source?: string;
}

/** 見出しの行と、その PDF のページ。 */
export interface HeadingPage {
  line: number;
  page: number;
}

/** 本文の幅（全角の文字数）と、どこから読んだか。 */
export interface TextWidthInfo {
  zw: number;
  from: string;
}

export interface EditorData {
  /** 見出しの PDF のページ（段階 3）。 */
  pages?: HeadingPage[];
  /** PDF が原稿より古い（ページ番号を薄く出す）。 */
  pagesStale?: boolean;
  refs?: Record<string, RefLabel>;
  /** `//image` の id → webview から読める URL。 */
  images?: Record<string, string>;
  completions?: CompletionCandidate[];
  marks?: MarkView[];
  diagnostics?: DiagView[];
}

/** 拡張 → webview。`seq` は拡張が当て終えた webview の編集の番号（位置をその後の編集で写すため）。 */
export type HostMessage =
  | ({ type: 'init'; text: string; eol: '\n' | '\r\n'; config: EditorConfig; textWidth: TextWidthInfo; seq: number } & EditorData)
  | { type: 'text'; text: string; seq: number }
  | { type: 'ack'; seq: number }
  | ({ type: 'data'; seq: number } & EditorData)
  | { type: 'wrap'; op: string }
  | { type: 'insert'; text: string; cursor: number }
  | { type: 'reveal'; from: LineCol; to: LineCol };

/** webview → 拡張。 */
export type ViewMessage =
  | { type: 'ready' }
  | { type: 'edit'; seq: number; changes: TextChange[] }
  | { type: 'selection'; anchor: LineCol; head: LineCol }
  | { type: 'sync' }
  | { type: 'command'; command: string; args: unknown[] }
  | { type: 'log'; level: 'info' | 'error'; message: string };
