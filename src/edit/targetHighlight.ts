import * as vscode from 'vscode';

const targetDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('editor.findRangeHighlightBackground'),
});

/** Highlights the code the assistant is working on until disposed. */
export class TargetHighlight implements vscode.Disposable {
  constructor(private readonly editor: vscode.TextEditor, range: vscode.Range) {
    editor.setDecorations(targetDecoration, range.isEmpty ? [] : [range]);
  }

  dispose(): void {
    this.editor.setDecorations(targetDecoration, []);
  }
}
