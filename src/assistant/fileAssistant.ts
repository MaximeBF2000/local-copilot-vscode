import * as path from 'path';
import * as vscode from 'vscode';
import { buildChatMessages, instructionWithHistory } from './chatPrompts';
import { streamAnswer } from './streamAnswer';
import { definitionsContext } from '../context/promptContext';
import { replaceDocument } from '../edit/applyChanges';
import { generateFileEdit } from '../edit/generateEdits';
import { logger } from '../logger';
import { isAbortError } from '../ollama/ollamaClient';
import { PromptFactory } from '../prompt/promptFactory';
import { PromptView } from '../prompt/promptView';
import { getServices } from '../services';
import { StatusBar } from '../statusBar';

/** Lines kept between the prompt and the bottom of the visible code. */
const BOTTOM_MARGIN_LINES = 3;

/**
 * Cmd+Shift+J: opens a compact prompt centered at the bottom of the editor for the whole file.
 * The decision engine then picks:
 * - chat: answer the question about the file inside the prompt;
 * - edit: change the file directly (only the changed lines are touched; Cmd+Z to undo).
 * Prompts include the definitions of the symbols the file uses from other files.
 */
export class FileAssistant implements vscode.Disposable {
  private generation: AbortController | undefined;
  private document: vscode.TextDocument | undefined;

  constructor(private readonly prompts: PromptFactory, private readonly statusBar: StatusBar) {}

  async run(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const visibleEnd = editor.visibleRanges[editor.visibleRanges.length - 1]?.end.line ?? editor.document.lineCount - 1;
    const prompt = this.prompts.open(editor, {
      anchorLine: Math.max(0, visibleEnd - BOTTOM_MARGIN_LINES),
      centered: true,
      placeholder: 'Ask about this file or describe a change…',
      chip: path.basename(editor.document.uri.fsPath),
    });
    prompt.onSubmit((text) => void this.handle(prompt, editor.document, text));
    prompt.onCancel(() => this.cancel());
    prompt.onClosed(() => this.cancel());
  }

  isBusyIn(document: vscode.TextDocument): boolean {
    return this.generation !== undefined && this.document === document;
  }

  cancel(): void {
    this.generation?.abort();
  }

  dispose(): void {
    this.cancel();
  }

  private async handle(prompt: PromptView, document: vscode.TextDocument, text: string): Promise<void> {
    const history = [...prompt.conversation];
    prompt.addUserMessage(text);

    const abort = new AbortController();
    this.generation = abort;
    this.document = document;
    const finishWork = this.statusBar.startWork();
    try {
      const wholeFile = new vscode.Range(0, 0, document.lineCount, 0);
      const [intent, definitions] = await Promise.all([
        getServices().decisions.chooseIntent({ instruction: text, target: 'a whole file' }, abort.signal),
        definitionsContext(document, document.validateRange(wholeFile), abort.signal),
      ]);
      logger.debug(`File prompt intent: ${intent}`);
      if (intent === 'chat') {
        await this.answer(prompt, document, text, history, definitions, abort.signal);
      } else {
        await this.edit(prompt, document, instructionWithHistory(text, history), definitions, abort.signal);
      }
    } catch (error) {
      if (isAbortError(error)) {
        if (!prompt.isClosed) prompt.showError('Stopped.');
      } else if (!prompt.isClosed) {
        logger.error('File prompt failed', error);
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
    document: vscode.TextDocument,
    question: string,
    history: { role: 'user' | 'assistant'; content: string }[],
    definitions: string,
    signal: AbortSignal,
  ): Promise<void> {
    const messages = buildChatMessages({
      question,
      filePath: vscode.workspace.asRelativePath(document.uri, false),
      languageId: document.languageId,
      codeLabel: 'the whole file',
      code: document.getText(),
      extraContext: definitions ? `Definitions used by this file:\n\n${definitions}` : undefined,
      history,
    });
    const answer = await streamAnswer(messages, signal, (markdown) => void prompt.showAnswer(markdown, false));
    await prompt.showAnswer(answer, true);
  }

  private async edit(prompt: PromptView, document: vscode.TextDocument, instruction: string, definitions: string, signal: AbortSignal): Promise<void> {
    prompt.showStatus('Editing…');
    const originalVersion = document.version;
    const newText = await generateFileEdit(document, instruction, definitions, signal, (phase, tokens) =>
      prompt.showStatus(`${phase === 'editing' ? 'Editing' : 'Rewriting file'}… ${tokens} tokens`),
    );

    if (document.version !== originalVersion) {
      prompt.showError('The file changed while generating, so the edit was discarded.');
      return;
    }
    prompt.close();
    const changedLines = await replaceDocument(document, newText);
    if (changedLines === 0) {
      vscode.window.setStatusBarMessage('Local Copilot: no changes needed', 4000);
    }
  }
}
