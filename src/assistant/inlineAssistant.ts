import * as vscode from 'vscode';
import { buildChatMessages, instructionWithHistory } from './chatPrompts';
import { streamAnswer } from './streamAnswer';
import { definitionsContext } from '../context/promptContext';
import { replaceRange } from '../edit/applyChanges';
import { resolveEditTarget, resolveQuestionContext, selectedLines } from '../edit/editTarget';
import { generateReplacement } from '../edit/generateEdits';
import { TargetHighlight } from '../edit/targetHighlight';
import { logger } from '../logger';
import { isAbortError } from '../ollama/ollamaClient';
import { PromptFactory } from '../prompt/promptFactory';
import { PromptView } from '../prompt/promptView';
import { getServices } from '../services';
import { StatusBar } from '../statusBar';

/**
 * Cmd+J: opens a compact prompt right below the cursor/selection. The decision engine then picks:
 * - chat: answer the question about the code inside the prompt;
 * - edit: rewrite the selection / line / function directly in the document (Cmd+Z to undo).
 * Prompts include the definitions of the symbols the code uses (resolved by the language server).
 */
export class InlineAssistant implements vscode.Disposable {
  private generation: AbortController | undefined;
  private document: vscode.TextDocument | undefined;

  constructor(private readonly prompts: PromptFactory, private readonly statusBar: StatusBar) {}

  async run(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const selection = editor.selection;
    const anchorLine = selection.isEmpty ? selection.active.line : selectedLines(editor.document, selection).end.line;

    const prompt = this.prompts.open(editor, {
      anchorLine,
      centered: false,
      placeholder: selection.isEmpty ? 'Ask about this code or describe a change…' : 'Ask about the selection or describe a change…',
    });
    prompt.onSubmit((text) => void this.handle(prompt, editor, selection, text));
    prompt.onCancel(() => this.cancel());
    prompt.onClosed(() => this.cancel());
    if (!this.prompts.usesCompactPrompt) await focusCommentInput();
  }

  /** True while a request is being generated in this document (autocomplete pauses meanwhile). */
  isBusyIn(document: vscode.TextDocument): boolean {
    return this.generation !== undefined && this.document === document;
  }

  cancel(): void {
    this.generation?.abort();
  }

  dispose(): void {
    this.cancel();
  }

  private async handle(prompt: PromptView, editor: vscode.TextEditor, selection: vscode.Selection, text: string): Promise<void> {
    const history = [...prompt.conversation];
    prompt.addUserMessage(text);

    const abort = new AbortController();
    this.generation = abort;
    this.document = editor.document;
    const finishWork = this.statusBar.startWork();
    try {
      const intent = await getServices().decisions.chooseIntent({ instruction: text, target: 'some code' }, abort.signal);
      logger.debug(`Inline prompt intent: ${intent}`);
      if (intent === 'chat') {
        await this.answer(prompt, editor, text, selection, history, abort.signal);
      } else {
        await this.edit(prompt, editor, instructionWithHistory(text, history), selection, abort.signal);
      }
    } catch (error) {
      if (isAbortError(error)) {
        if (!prompt.isClosed) prompt.showError('Stopped.');
      } else if (!prompt.isClosed) {
        logger.error('Inline prompt failed', error);
        prompt.showError((error as Error).message);
      }
    } finally {
      if (this.generation === abort) {
        this.generation = undefined;
        this.document = undefined;
      }
      finishWork();
    }
  }

  private async answer(
    prompt: PromptView,
    editor: vscode.TextEditor,
    question: string,
    selection: vscode.Selection,
    history: { role: 'user' | 'assistant'; content: string }[],
    signal: AbortSignal,
  ): Promise<void> {
    const { document } = editor;
    const context = await resolveQuestionContext(document, selection);
    const highlight = new TargetHighlight(editor, context.range);
    try {
      prompt.showStatus('Reading context…');
      const definitions = await definitionsContext(document, context.range, signal);
      const messages = buildChatMessages({
        question,
        filePath: vscode.workspace.asRelativePath(document.uri, false),
        languageId: document.languageId,
        codeLabel: context.label,
        code: document.getText(context.range),
        extraContext: definitions ? `Definitions used by this code:\n\n${definitions}` : undefined,
        history,
      });
      const answer = await streamAnswer(messages, signal, (markdown) => void prompt.showAnswer(markdown, false));
      await prompt.showAnswer(answer, true);
    } finally {
      highlight.dispose();
    }
  }

  private async edit(prompt: PromptView, editor: vscode.TextEditor, instruction: string, selection: vscode.Selection, signal: AbortSignal): Promise<void> {
    const { document } = editor;
    prompt.showStatus('Reading context…');
    const target = await resolveEditTarget(document, selection, instruction, getServices().decisions, signal);
    const originalCode = document.getText(target.range);

    const highlight = new TargetHighlight(editor, target.range);
    let newCode: string;
    try {
      const definitions = target.range.isEmpty ? '' : await definitionsContext(document, target.range, signal);
      prompt.showStatus('Editing…');
      newCode = await generateReplacement(document, target, instruction, definitions, signal, (tokens) =>
        prompt.showStatus(`Editing… ${tokens} tokens`),
      );
    } finally {
      highlight.dispose();
    }

    if (document.getText(target.range) !== originalCode) {
      prompt.showError('The code changed while generating, so the edit was discarded.');
      return;
    }
    if (newCode.trim() === originalCode.trim()) {
      prompt.showError('No changes needed.');
      return;
    }

    prompt.close();
    // An insertion replaces the (blank) cursor line itself.
    const range = target.range.isEmpty ? document.lineAt(target.range.start.line).range : target.range;
    await replaceRange(document, range, newCode);
  }
}

/** The comment-widget fallback has no focus API: use the built-in command when available. */
async function focusCommentInput(): Promise<void> {
  const commands = await vscode.commands.getCommands(true);
  for (const id of ['workbench.action.focusCommentOnCurrentLine', 'editor.action.nextCommentThreadAction']) {
    if (commands.includes(id)) {
      await vscode.commands.executeCommand(id);
      return;
    }
  }
}
