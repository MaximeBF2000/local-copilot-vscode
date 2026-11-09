import * as vscode from 'vscode';

const targetDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('editor.findRangeHighlightBackground'),
});

const progressDecoration = vscode.window.createTextEditorDecorationType({
  after: {
    color: new vscode.ThemeColor('editorGhostText.foreground'),
    margin: '0 0 0 2em',
    fontStyle: 'italic',
  },
});

/**
 * Highlights the code being rewritten and shows "Generating…" next to it while the model works.
 * Also sets the `localCopilot.generating` context key so Esc can cancel.
 */
export class GenerationIndicator implements vscode.Disposable {
  private disposed = false;

  constructor(private readonly editor: vscode.TextEditor, private readonly range: vscode.Range) {
    editor.setDecorations(targetDecoration, range.isEmpty ? [] : [range]);
    this.update('Generating…');
    void vscode.commands.executeCommand('setContext', 'localCopilot.generating', true);
  }

  update(message: string): void {
    if (this.disposed) return;
    const line = this.editor.document.lineAt(this.range.start.line);
    this.editor.setDecorations(progressDecoration, [
      { range: line.range, renderOptions: { after: { contentText: `⟳ ${message}  (Esc to cancel)` } } },
    ]);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.editor.setDecorations(targetDecoration, []);
    this.editor.setDecorations(progressDecoration, []);
    void vscode.commands.executeCommand('setContext', 'localCopilot.generating', false);
  }
}
