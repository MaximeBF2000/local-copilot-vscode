import * as vscode from 'vscode';
import { PendingBlocks, classifyChange, shiftBlocks } from './lineBlocks';

const removedDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('diffEditor.removedLineBackground'),
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.deletedForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

const insertedDecoration = vscode.window.createTextEditorDecorationType({
  isWholeLine: true,
  backgroundColor: new vscode.ThemeColor('diffEditor.insertedLineBackground'),
  overviewRulerColor: new vscode.ThemeColor('editorOverviewRuler.addedForeground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

/**
 * A proposed Cmd+J edit shown in the document: the original lines are highlighted in red
 * and the proposed code is inserted below them in green, until the user accepts (Tab) or rejects (Esc).
 * Accepting deletes the red lines, rejecting deletes the green ones; one undo reverts everything.
 */
export class InlineEditSession {
  private blocks: PendingBlocks;
  private applyingOwnEdit = false;
  private finished = false;
  private readonly onFinishedEmitter = new vscode.EventEmitter<void>();
  readonly onFinished = this.onFinishedEmitter.event;

  private constructor(
    readonly document: vscode.TextDocument,
    blocks: PendingBlocks,
    /** For insertions: the original (blank) line text to restore on reject. */
    private readonly replacedLineText: string | undefined,
  ) {
    this.blocks = blocks;
  }

  /** Inserts the proposal into the editor and returns the pending session, or undefined if the edit failed. */
  static async start(editor: vscode.TextEditor, target: vscode.Range, newCode: string): Promise<InlineEditSession | undefined> {
    const newLineCount = newCode.split('\n').length;
    const isInsertion = target.isEmpty;

    if (isInsertion) {
      const line = editor.document.lineAt(target.start.line);
      const ok = await editor.edit((edit) => edit.replace(line.range, newCode), { undoStopBefore: true, undoStopAfter: false });
      if (!ok) return undefined;
      const start = target.start.line;
      return new InlineEditSession(editor.document, { old: { start, end: start - 1 }, proposed: { start, end: start + newLineCount - 1 } }, line.text);
    }

    const endOfOld = editor.document.lineAt(target.end.line).range.end;
    const ok = await editor.edit((edit) => edit.insert(endOfOld, `\n${newCode}`), { undoStopBefore: true, undoStopAfter: false });
    if (!ok) return undefined;
    const old = { start: target.start.line, end: target.end.line };
    return new InlineEditSession(editor.document, { old, proposed: { start: old.end + 1, end: old.end + newLineCount } }, undefined);
  }

  /** Line where the Accept/Reject code lens is shown. */
  get firstLine(): number {
    return this.blocks.old.end >= this.blocks.old.start ? this.blocks.old.start : this.blocks.proposed.start;
  }

  decorate(editor: vscode.TextEditor): void {
    if (editor.document !== this.document) return;
    const lines = (start: number, end: number) => (end >= start ? [new vscode.Range(start, 0, end, 0)] : []);
    editor.setDecorations(removedDecoration, lines(this.blocks.old.start, this.blocks.old.end));
    editor.setDecorations(insertedDecoration, lines(this.blocks.proposed.start, this.blocks.proposed.end));
  }

  async accept(): Promise<void> {
    const { old, proposed } = this.blocks;
    if (old.end >= old.start) {
      await this.replace(new vscode.Range(old.start, 0, proposed.start, 0), '');
    }
    this.finish();
  }

  async reject(): Promise<void> {
    const { old, proposed } = this.blocks;
    const proposedEnd = this.document.lineAt(proposed.end).range.end;
    if (this.replacedLineText !== undefined) {
      await this.replace(new vscode.Range(new vscode.Position(proposed.start, 0), proposedEnd), this.replacedLineText);
    } else {
      const oldEnd = this.document.lineAt(old.end).range.end;
      await this.replace(new vscode.Range(oldEnd, proposedEnd), '');
    }
    this.finish();
  }

  /** Keeps the line numbers right when the user edits the document while the proposal is shown. */
  async handleDocumentChange(event: vscode.TextDocumentChangeEvent): Promise<void> {
    if (this.applyingOwnEdit || this.finished || event.document !== this.document || event.contentChanges.length === 0) {
      return;
    }
    // Undo/redo replays our own edits: just stop tracking.
    if (event.reason === vscode.TextDocumentChangeReason.Undo || event.reason === vscode.TextDocumentChangeReason.Redo) {
      this.finish();
      return;
    }
    for (const change of event.contentChanges) {
      const lineDelta = change.text.split('\n').length - 1 - (change.range.end.line - change.range.start.line);
      const effect = classifyChange(this.blocks, { startLine: change.range.start.line, endLine: change.range.end.line, lineDelta });
      if (effect === 'shifted') {
        this.blocks = shiftBlocks(this.blocks, lineDelta);
      } else if (effect === 'touchesProposed') {
        // The user started editing the proposal: keep it.
        await this.accept();
        return;
      } else if (effect === 'touchesOld') {
        // The user edits the original code: drop the proposal.
        await this.reject();
        return;
      }
    }
  }

  /**
   * Applies our own change without an undo stop before it when possible,
   * so that a single undo reverts both the proposal and its acceptance.
   */
  private async replace(range: vscode.Range, text: string): Promise<void> {
    this.applyingOwnEdit = true;
    try {
      const editor = vscode.window.visibleTextEditors.find((e) => e.document === this.document);
      if (editor) {
        await editor.edit((edit) => edit.replace(range, text), { undoStopBefore: false, undoStopAfter: true });
      } else {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.replace(this.document.uri, range, text);
        await vscode.workspace.applyEdit(workspaceEdit);
      }
    } finally {
      this.applyingOwnEdit = false;
    }
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === this.document) {
        editor.setDecorations(removedDecoration, []);
        editor.setDecorations(insertedDecoration, []);
      }
    }
    this.onFinishedEmitter.fire();
    this.onFinishedEmitter.dispose();
  }
}
