// 編集画面の見た目。色と書体はすべて VS Code のテーマの CSS 変数から取る（新しい色を持たない）。
// 見出しの大きさは設定 `editor.headingScale`（editor.ts の themeFor）。罫線の 1px と札の内側の余白は
// 紙面に関わらない飾りなので設定にしていない（docs/design/thresholds.md の「編集画面」）。

export const css = {
  '&': {
    height: '100%',
    color: 'var(--vscode-editor-foreground)',
    backgroundColor: 'var(--vscode-editor-background)',
    fontSize: 'var(--vscode-editor-font-size)',
  },
  '.cm-scroller': { fontFamily: 'var(--vscode-font-family)', lineHeight: 'normal' },
  '.cm-content': { caretColor: 'var(--vscode-editorCursor-foreground)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--vscode-editor-selectionBackground)',
  },

  // 見出し
  '.cm-ra-h': { fontWeight: 'bold' },

  // インライン
  '.cm-ra-code': { fontFamily: 'var(--vscode-editor-font-family)', backgroundColor: 'var(--vscode-textCodeBlock-background)' },
  '.cm-ra-bold': { fontWeight: 'bold' },
  '.cm-ra-faint, .cm-ra-comment': { color: 'var(--vscode-descriptionForeground)' },
  '.cm-ra-link': { color: 'var(--vscode-textLink-foreground)', textDecoration: 'underline' },
  '.cm-ra-chip': {
    display: 'inline-block',
    padding: '0 0.3em',
    margin: '0 0.1em',
    border: '1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border))',
    borderRadius: '0.3em',
    color: 'var(--vscode-badge-foreground)',
    backgroundColor: 'var(--vscode-badge-background)',
    lineHeight: 'normal',
  },
  '.cm-ra-chip-ref': { color: 'var(--vscode-textLink-foreground)', backgroundColor: 'transparent' },
  '.cm-ra-chip-broken': { color: 'var(--vscode-errorForeground)', borderColor: 'var(--vscode-errorForeground)', backgroundColor: 'transparent' },
  '.cm-ra-chip-label, .cm-ra-chip-tsize, .cm-ra-chip-id, .cm-ra-chip-br, .cm-ra-chip-embed': {
    color: 'var(--vscode-descriptionForeground)',
    backgroundColor: 'transparent',
  },
  '.cm-ra-bullet': { color: 'var(--vscode-descriptionForeground)' },

  // ブロック
  '.cm-ra-dir-code, .cm-ra-dir-table, .cm-ra-dir-quote, .cm-ra-dir-image, .cm-ra-dir-footnote': {
    borderTop: '1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border))',
  },
  '.cm-ra-head': { color: 'var(--vscode-descriptionForeground)' },
  '.cm-ra-caption': { marginLeft: '0.5em' },
  '.cm-ra-body-code, .cm-ra-dir-code ~ .cm-ra-body-code': {
    fontFamily: 'var(--vscode-editor-font-family)',
    backgroundColor: 'var(--vscode-textCodeBlock-background)',
  },
  '.cm-ra-body-quote': { borderLeft: '1px solid var(--vscode-textBlockQuote-border, var(--vscode-panel-border))', paddingLeft: '1em' },
  '.cm-ra-end': { borderBottom: '1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border))' },
  '.cm-ra-tr': { fontFamily: 'var(--vscode-editor-font-family)' },
  '.cm-ra-th': { fontWeight: 'bold' },
  '.cm-ra-trule': { borderBottom: '1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border))' },
  '.cm-ra-tab': { display: 'inline-block', borderRight: '1px solid var(--vscode-editorWidget-border, var(--vscode-panel-border))' },
  '.cm-ra-rule': {
    display: 'inline-block',
    width: '100%',
    textAlign: 'center',
    color: 'var(--vscode-descriptionForeground)',
    borderBottom: '1px dashed var(--vscode-descriptionForeground)',
  },
  // 見出しの横の PDF のページ番号。全角 1 字（1em）あけて薄く
  '.cm-ra-pageno': { marginLeft: '1em', color: 'var(--vscode-descriptionForeground)', fontWeight: 'normal' },
  '.cm-ra-pageno-stale': { color: 'var(--vscode-disabledForeground)' },
  '.cm-ra-figure': { textAlign: 'center' },
  '.cm-ra-figure img': { maxWidth: '100%' },
  '.cm-ra-missing': { color: 'var(--vscode-descriptionForeground)' },

  // マーカーと診断
  '.cm-ra-diag-error': { textDecoration: 'underline wavy var(--vscode-editorError-foreground)' },
  '.cm-ra-diag-warning': { textDecoration: 'underline wavy var(--vscode-editorWarning-foreground)' },
  '.cm-ra-diag-info': { textDecoration: 'underline wavy var(--vscode-editorInfo-foreground)' },
  '.cm-ra-diag-hint': { textDecoration: 'underline dotted var(--vscode-editorHint-foreground, var(--vscode-descriptionForeground))' },
  '.cm-tooltip.cm-tooltip-hover': {
    color: 'var(--vscode-editorHoverWidget-foreground)',
    backgroundColor: 'var(--vscode-editorHoverWidget-background)',
    border: '1px solid var(--vscode-editorHoverWidget-border)',
  },
  '.cm-ra-hover': { padding: '0.3em 0.6em', maxWidth: '40em' },
  '.cm-ra-hover pre': { whiteSpace: 'pre-wrap', fontFamily: 'var(--vscode-editor-font-family)' },
  '.cm-ra-hover-mark + .cm-ra-hover-mark, .cm-ra-hover-diag + .cm-ra-hover-mark': {
    borderTop: '1px solid var(--vscode-editorHoverWidget-border)',
  },
  '.cm-ra-hover-actions button': {
    color: 'var(--vscode-textLink-foreground)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: '0',
    marginRight: '1em',
    font: 'inherit',
  },
  '.cm-ra-hover-error': { color: 'var(--vscode-errorForeground)' },
  '.cm-tooltip-autocomplete': {
    color: 'var(--vscode-editorSuggestWidget-foreground)',
    backgroundColor: 'var(--vscode-editorSuggestWidget-background)',
    border: '1px solid var(--vscode-editorSuggestWidget-border)',
  },
  '.cm-tooltip-autocomplete ul li[aria-selected]': {
    color: 'var(--vscode-editorSuggestWidget-selectedForeground)',
    backgroundColor: 'var(--vscode-editorSuggestWidget-selectedBackground)',
  },
  '.cm-panels': { color: 'var(--vscode-editorWidget-foreground)', backgroundColor: 'var(--vscode-editorWidget-background)' },
};
