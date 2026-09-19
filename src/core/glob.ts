// 実行時依存を持たない方針なので、設定で使う程度の glob を自前で持つ。
// 対応するのは `*`（`/` を跨がない）、`**`（`/` を跨ぐ）、`?`、それ以外はそのままの文字。

export function globToRegExp(glob: string): RegExp {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` は「0 個以上のディレクトリ」。末尾の `**` は何でも。
        if (glob[i + 2] === '/') {
          out += '(?:.*/)?';
          i += 2;
        } else {
          out += '.*';
          i += 1;
        }
      } else {
        out += '[^/]*';
      }
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(out + '$');
}

export function matchesAny(relPath: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(relPath));
}
