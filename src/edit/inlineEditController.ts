import * as vscode from 'vscode';
import { logger } from '../logger';
import { isAbortError } from '../ollama/ollamaClient';
import { getServices } from '../services';
import { StatusBar } from '../statusBar';
import { commonIndentation, extractCode, matchIndentation } from './codeExtraction';
import { buildInlineEditMessages } from './editPrompts';
import { EditTarget, resolveEditTarget } from './editTarget';
import { GenerationIndicator } from './generationIndicator';
import { InlineEditSession } from './inlineEditSession';

/**
 * Cmd+J: asks for an instruction, rewrites the selection (or current line / function),
 * and shows the result as a pending red/green proposal accepted with Tab or rejected with Esc.
 */
export class InlineEditController implements vscode.CodeLensProvider, vscode.Disposable {
  private session: InlineEditSession | undefined;
  private generation: AbortController | undefined;
  private generatingIn: vscode.TextDocument | undefined;
  private readonly codeLensEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.codeLensEmitter.event;
  private readonly disposables: vscode.Disposable[] = [];

  constructor(private readonly statusBar: StatusBar) {
    this.disposables.push(
      vscode.languages.registerCodeLensProvider({ scheme: '*' }, this),
      vscode.workspace.onDidChangeTextDocument(async (event) => {
        if (this.session) {
          await this.session.handleDocumentChange(event);
          this.refreshUi();
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.refreshUi()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.refreshUi()),
    );
  }

  async run(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    if (this.session) {
      await this.session.reject();
    }

    const hint = editor.selection.isEmpty ? 'current line or function' : 'selection';
    const instruction = await vscode.window.showInputBox({
      title: `Local Copilot — edit ${hint}`,
      placeHolder: 'e.g. "Add error handling", "Optimize this function", "Convert to async/await"',
      ignoreFocusOut: true,
    });
    if (!instruction?.trim()) return;

    const { decisions } = getServices();
    const target = await resolveEditTarget(editor, instruction, decisions);
    const originalCode = editor.document.getText(target.range);
    const newCode = await this.generate(editor, target, instruction);
    if (newCode === undefined) return;

    if (editor.document.getText(target.range) !== originalCode) {
      void vscode.window.showWarningMessage('Local Copilot: the code changed while generating, so the edit was discarded.');
      return;
    }
    if (newCode.trim() === originalCode.trim()) {
      void vscode.window.showInformationMessage('Local Copilot: no changes suggested.');
      return;
    }

    const session = await InlineEditSession.start(editor, target.range, newCode);
    if (!session) return;
    this.session = session;
    session.onFinished(() => {
      if (this.session === session) this.session = undefined;
      this.refreshUi();
    });
    this.refreshUi();
  }

  async accept(): Promise<void> {
    await this.session?.accept();
  }

  async reject(): Promise<void> {
    await this.session?.reject();
  }

  /** True while a proposal is pending or being generated in this document. */
  isBusyIn(document: vscode.TextDocument): boolean {
    return this.session?.document === document || this.generatingIn === document;
  }

  cancelGeneration(): void {
    this.generation?.abort();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!this.session || this.session.document !== document) return [];
    const range = new vscode.Range(this.session.firstLine, 0, this.session.firstLine, 0);
    return [
      new vscode.CodeLens(range, { title: '$(check) Accept (Tab)', command: 'localCopilot.acceptInlineEdit' }),
      new vscode.CodeLens(range, { title: '$(close) Reject (Esc)', command: 'localCopilot.rejectInlineEdit' }),
    ];
  }

  dispose(): void {
    this.generation?.abort();
    this.disposables.forEach((d) => d.dispose());
    this.codeLensEmitter.dispose();
  }

  /** Streams the model answer and returns the replacement code, or undefined if cancelled/failed. */
  private async generate(editor: vscode.TextEditor, target: EditTarget, instruction: string): Promise<string | undefined> {
    const { settings, ollama } = getServices();
    const { document } = editor;
    const contextLines = settings.edit.contextLines;
    const beforeStart = Math.max(0, target.range.start.line - contextLines);
    const afterEnd = Math.min(document.lineCount - 1, target.range.end.line + contextLines);
    const targetCode = document.getText(target.range);
    const codeBefore = document.getText(new vscode.Range(beforeStart, 0, target.range.start.line, 0));
    const codeAfter = target.range.end.line + 1 <= afterEnd
      ? document.getText(new vscode.Range(target.range.end.line + 1, 0, afterEnd, document.lineAt(afterEnd).text.length))
      : '';

    const messages = buildInlineEditMessages({
      instruction,
      filePath: vscode.workspace.asRelativePath(document.uri, false),
      languageId: document.languageId,
      codeBefore,
      targetCode,
      codeAfter,
    });

    const indicator = new GenerationIndicator(editor, target.range);
    const finishWork = this.statusBar.startWork();
    this.generation = new AbortController();
    this.generatingIn = document;
    try {
      const result = await ollama.chat({
        model: settings.editModel,
        messages,
        think: settings.edit.enableThinking,
        keepAlive: settings.keepAlive,
        options: { temperature: 0.2, num_ctx: 16384 },
        signal: this.generation.signal,
        onProgress: (_text, tokens) => indicator.update(`Generating… ${tokens} tokens`),
      });
      logger.info(`Inline edit (${target.description}): ${result.tokenCount} tokens in ${result.durationMs}ms`);
      this.statusBar.clearError();

      const code = extractCode(result.text).replace(/\s+$/, '');
      if (target.range.isEmpty) {
        // Insertion: align with the blank line's indentation when it has one, otherwise trust the model.
        const lineIndent = document.lineAt(target.range.start.line).text;
        return lineIndent ? matchIndentation(code, lineIndent) : code;
      }
      return matchIndentation(code, commonIndentation(targetCode.split('\n')));
    } catch (error) {
      if (!isAbortError(error)) {
        logger.error('Inline edit failed', error);
        this.statusBar.showError((error as Error).message);
        void vscode.window.showErrorMessage(`Local Copilot: ${(error as Error).message}`);
      }
      return undefined;
    } finally {
      this.generation = undefined;
      this.generatingIn = undefined;
      indicator.dispose();
      finishWork();
    }
  }

  /** Updates decorations, code lenses and the context key used by the Tab/Esc keybindings. */
  private refreshUi(): void {
    const activeDocument = vscode.window.activeTextEditor?.document;
    const pendingHere = this.session !== undefined && this.session.document === activeDocument;
    void vscode.commands.executeCommand('setContext', 'localCopilot.inlineEditPending', pendingHere);
    if (this.session) {
      for (const editor of vscode.window.visibleTextEditors) {
        this.session.decorate(editor);
      }
    }
    this.codeLensEmitter.fire();
  }
}
