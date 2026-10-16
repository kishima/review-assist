// 編集画面（0.3.0）の入力の助け。選んだ文字列をインライン命令で囲む、ブロックの雛形、
// 参照の候補。VS Code にもファイルシステムにも依存しない（囲むのと雛形は webview の束にも入る）。

/**
 * `@<op>{…}` で囲む。中の `}` と `\` は逃がす（parser.ts が `\}` `\{` `\\` を逃がしとして読むのと対）。
 * `{` は閉じ括弧を探すときに数えないので逃がさない。行をまたぐ選択は囲めない（Re:VIEW のインライン命令は
 * 1 行の中に閉じる）ので undefined。
 */
export function wrapInline(op: string, text: string): string | undefined {
  if (/[\r\n]/.test(text)) return undefined;
  return `@<${op}>{${text.replace(/\\/g, '\\\\').replace(/\}/g, '\\}')}}`;
}

export interface BlockTemplate {
  /** QuickPick に出す名前。 */
  label: string;
  /** 挿入する文字列。`$ID` と `$CAPTION` はそのまま残す（書く人が直す）。 */
  text: string;
  /** 挿入した後にカーソルを置く位置（`text` の中の位置）。 */
  cursor: number;
}

function tpl(label: string, before: string, after: string): BlockTemplate {
  return { label, text: before + after, cursor: before.length };
}

/**
 * ブロックの雛形。表の区切りの行は Re:VIEW 2.5.0 `Builder#table` の `/\A[\=\-]{12}/`（12 文字以上）に
 * 合わせて 12 文字。
 */
export const BLOCK_TEMPLATES: readonly BlockTemplate[] = [
  tpl('//list（id とキャプション付きのコード）', '//list[', 'id][キャプション]{\n\n//}\n'),
  tpl('//emlist（番号の無いコード）', '//emlist[', 'キャプション]{\n\n//}\n'),
  tpl('//cmd（コマンドの入出力）', '//cmd{\n', '\n//}\n'),
  tpl('//table（表）', '//table[', 'id][キャプション]{\n見出し1\t見出し2\n------------\nセル1\tセル2\n//}\n'),
  tpl('//image（図）', '//image[', 'id][キャプション][scale=1.0]\n'),
  tpl('//footnote（脚注）', '//footnote[', 'id][脚注の文]\n'),
  tpl('//quote（引用）', '//quote{\n', '\n//}\n'),
  tpl('//pagebreak（改ページ）', '//pagebreak', '\n'),
];

/** 参照の候補 1 つ。 */
export interface CompletionCandidate {
  /** `chap` `hd` `list` `table` `img`。 */
  op: string;
  /** `{}` の中に入れる文字列。 */
  id: string;
  /** 候補の横に出す説明（題やキャプション）。 */
  detail: string;
}

/** 候補を出す命令。 */
export const COMPLETION_OPS = ['chap', 'hd', 'list', 'table', 'img'] as const;

/** 参照の札の表（拡張 → webview）の鍵。両方の側が同じ形で引く。 */
export function refKey(op: string, arg: string): string {
  return `${op}\u0000${arg}`;
}
