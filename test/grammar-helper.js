// TextMate 文法（syntaxes/review.tmLanguage.json）を VS Code と同じエンジンで回すための道具。
// `*.test.js` ではないので `node --test test/*.test.js` は拾わない。
//
// VS Code 本体が文法を読むのに使っているのが vscode-textmate + vscode-oniguruma そのものなので、
// ここで出るトークンはエディタで付く scope と同じものになる（Extension Development Host が
// 使えないこの環境で、文法を機械で確かめられる唯一の道）。
const fs = require('node:fs');
const path = require('node:path');
const vsctm = require('vscode-textmate');
const oniguruma = require('vscode-oniguruma');

const GRAMMAR_PATH = path.join(__dirname, '..', 'syntaxes', 'review.tmLanguage.json');

let grammarPromise;

/** source.review の文法を 1 度だけ読む。 */
function loadReviewGrammar() {
  if (!grammarPromise) {
    const wasm = fs.readFileSync(require.resolve('vscode-oniguruma/release/onig.wasm'));
    const onigLib = oniguruma
      .loadWASM(wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength))
      .then(() => ({
        createOnigScanner: (patterns) => new oniguruma.OnigScanner(patterns),
        createOnigString: (s) => new oniguruma.OnigString(s),
      }));
    const registry = new vsctm.Registry({
      onigLib,
      loadGrammar: async (scopeName) =>
        scopeName === 'source.review'
          ? vsctm.parseRawGrammar(fs.readFileSync(GRAMMAR_PATH, 'utf8'), GRAMMAR_PATH)
          : null,
    });
    grammarPromise = registry.loadGrammar('source.review');
  }
  return grammarPromise;
}

/**
 * 文字列を行ごとにトークン化する。ブロック（//list{ 〜 //}）をまたぐので ruleStack を引き継ぐ。
 * 戻りは { lines, tokens }。tokens[i] は i 行目のトークンの配列で、各トークンは
 * { startIndex, endIndex, scopes }。
 */
async function tokenizeReview(text) {
  const grammar = await loadReviewGrammar();
  const lines = text.split(/\r?\n/);
  const tokens = [];
  let stack = vsctm.INITIAL;
  for (const line of lines) {
    const r = grammar.tokenizeLine(line, stack);
    tokens.push(r.tokens);
    stack = r.ruleStack;
  }
  return { lines, tokens };
}

/**
 * 1 行の中で、指定の scope が付いている部分の文字列を、続いている範囲ごとにまとめて返す。
 * 「この行のこの範囲はこの scope」を assert.deepStrictEqual で書くための形。
 */
function textsWithScope(lineTokens, lineText, scope) {
  const out = [];
  let cur = null;
  for (const t of lineTokens) {
    if (t.scopes.includes(scope)) {
      if (cur && cur.end === t.startIndex) cur.end = t.endIndex;
      else {
        cur = { start: t.startIndex, end: t.endIndex };
        out.push(cur);
      }
    } else {
      cur = null;
    }
  }
  return out.map((s) => lineText.slice(s.start, s.end));
}

/** 位置 col を含むトークンの scope 一覧（無ければ空配列）。 */
function scopesAt(lineTokens, col) {
  for (const t of lineTokens) {
    if (t.startIndex <= col && col < t.endIndex) return t.scopes;
  }
  return [];
}

/**
 * 取りこぼしの機械確認。原稿の中の `@<` と `//` の出現のうち、
 * 根の scope（source.review）しか付いていないものを集める。
 */
function unscopedOccurrences(lines, tokens, needles = ['@<', '//']) {
  const bad = [];
  for (let i = 0; i < lines.length; i++) {
    for (const needle of needles) {
      let at = lines[i].indexOf(needle);
      while (at >= 0) {
        const scopes = scopesAt(tokens[i], at);
        if (scopes.length <= 1) {
          bad.push({ line: i + 1, column: at, needle, text: lines[i].slice(at, at + 40), scopes });
        }
        at = lines[i].indexOf(needle, at + 1);
      }
    }
  }
  return bad;
}

module.exports = { loadReviewGrammar, tokenizeReview, textsWithScope, scopesAt, unscopedOccurrences, GRAMMAR_PATH };
