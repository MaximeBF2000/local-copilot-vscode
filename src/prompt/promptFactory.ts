import * as vscode from 'vscode';
import { CommentPromptService } from './commentPrompt';
import { InsetPrompt } from './insetPrompt';
import { PromptOptions, PromptView } from './promptView';

/**
 * Opens the compact embedded prompt when VS Code allows it, otherwise VS Code's comment widget.
 * Only one prompt is open at a time.
 */
export class PromptFactory implements vscode.Disposable {
  private readonly comments: CommentPromptService;
  private current: PromptView | undefined;
  /** Remembered so we don't retry (and fail) on every open. */
  private insetsAvailable = true;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.comments = new CommentPromptService(extensionUri);
  }

  get commentPrompts(): CommentPromptService {
    return this.comments;
  }

  /** The prompt currently open, if any. */
  get active(): PromptView | undefined {
    return this.current?.isClosed ? undefined : this.current;
  }

  get usesCompactPrompt(): boolean {
    return this.insetsAvailable;
  }

  open(editor: vscode.TextEditor, options: PromptOptions): PromptView {
    this.current?.close();
    let prompt: PromptView | undefined = this.insetsAvailable ? InsetPrompt.open(editor, options, this.extensionUri) : undefined;
    if (!prompt) {
      this.insetsAvailable = false;
      prompt = this.comments.open(editor, options);
    }
    this.current = prompt;
    return prompt;
  }

  dispose(): void {
    this.current?.close();
    this.comments.dispose();
  }
}
