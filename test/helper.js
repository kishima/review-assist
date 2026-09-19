// テストの間で使う小さな道具。`*.test.js` ではないので node --test は拾わない。

/**
 * VS Code の DocumentSymbol は「selectionRange ⊆ range」「子の range ⊆ 親の range」を要求する。
 * 崩れると木を作らずフラットに並べることがあるので、不変条件として押さえる。
 * 破れている箇所の説明の配列を返す（空なら健全）。
 */
function checkContainment(roots, where) {
  const le = (a, b) => a.line < b.line || (a.line === b.line && a.column <= b.column);
  const bad = [];
  const walk = (node, parent) => {
    if (!le(node.span.start, node.selectionSpan.start) || !le(node.selectionSpan.end, node.span.end)) {
      bad.push(
        `${where}: ${node.name} の selectionRange ` +
          `(${node.selectionSpan.start.line}:${node.selectionSpan.start.column}–${node.selectionSpan.end.line}:${node.selectionSpan.end.column}) が ` +
          `range (${node.span.start.line}:${node.span.start.column}–${node.span.end.line}:${node.span.end.column}) に入らない`
      );
    }
    if (parent && (!le(parent.span.start, node.span.start) || !le(node.span.end, parent.span.end))) {
      bad.push(
        `${where}: ${node.name} (${node.span.start.line}:${node.span.start.column}–${node.span.end.line}:${node.span.end.column}) が ` +
          `親 ${parent.name} (${parent.span.start.line}:${parent.span.start.column}–${parent.span.end.line}:${parent.span.end.column}) からはみ出す`
      );
    }
    for (const c of node.children) walk(c, node);
  };
  for (const r of roots) walk(r, undefined);
  return bad;
}

/** 木のノード数と最大の深さ。 */
function countNodes(roots) {
  let nodes = 0;
  let depth = 0;
  const walk = (node, d) => {
    nodes++;
    depth = Math.max(depth, d);
    for (const c of node.children) walk(c, d + 1);
  };
  for (const r of roots) walk(r, 1);
  return { nodes, depth };
}

module.exports = { checkContainment, countNodes };
