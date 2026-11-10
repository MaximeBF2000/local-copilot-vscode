import * as vscode from 'vscode';
import { findChangedRegion } from './textRegion';

const changedLinesDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const FLASH_DURATION_MS = 1500;

/**
 * Writes AI changes straight into the document as a single undoable edit (Cmd+Z reverts it),
 * then briefly highlights the changed lines.
 */
export async function replaceRange(document: vscode.TextDocument, range: vscode.Range, newText: string): Promise<boolean> {
  const editor = await editorFor(document);
  const applied = await editor.edit((edit) => edit.replace(range, newText), { undoStopBefore: true, undoStopAfter: true });
  if (applied) {
    const lineCount = newText.split('\n').length;
    flash(editor, new vscode.Range(range.start.line, 0, range.start.line + lineCount - 1, 0));
    vscode.window.setStatusBarMessage('$(check) Local Copilot: change applied — Cmd+Z to undo', 4000);
  }
  return applied;
}

/** Replaces the whole document content, touching only the lines that actually changed. Returns the number of changed lines. */
export async function replaceDocument(document: vscode.TextDocument, newText: string): Promise<number> {
  const editor = await editorFor(document);
  const region = findChangedRegion(document.getText(), newText);
  if (!region) {
    return 0;
  }
  const endLine = region.startLine + region.oldLineCount;
  const range =
    endLine < document.lineCount
      ? new vscode.Range(region.startLine, 0, endLine, 0)
      : new vscode.Range(region.startLine, 0, document.lineCount - 1, document.lineAt(document.lineCount - 1).text.length);
  const replacement = endLine < document.lineCount ? region.newLines.map((line) => `${line}\n`).join('') : region.newLines.join('\n');

  const applied = await editor.edit((edit) => edit.replace(range, replacement), { undoStopBefore: true, undoStopAfter: true });
  if (applied && region.newLines.length > 0) {
    const changed = new vscode.Range(region.startLine, 0, region.startLine + region.newLines.length - 1, 0);
    flash(editor, changed);
    editor.revealRange(changed, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  return applied ? Math.max(region.newLines.length, region.oldLineCount) : 0;
}

/** The visible editor showing the document, or a newly shown one (keeps focus where it is). */
async function editorFor(document: vscode.TextDocument): Promise<vscode.TextEditor> {
  const visible = vscode.window.visibleTextEditors.find((e) => e.document === document);
  return visible ?? vscode.window.showTextDocument(document, { preserveFocus: true, preview: false });
}

function flash(editor: vscode.TextEditor, range: vscode.Range): void {
  editor.setDecorations(changedLinesDecoration, [range]);
  setTimeout(() => editor.setDecorations(changedLinesDecoration, []), FLASH_DURATION_MS);
}
