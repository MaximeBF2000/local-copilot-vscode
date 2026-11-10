import * as vscode from 'vscode';

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * A prompt shown in the editor: the user types a request, the assistant shows progress,
 * answers (markdown) or a final result line. Implemented by InsetPrompt (compact card embedded
 * in the editor) and CommentPrompt (VS Code's comment widget, used as a fallback).
 */
export interface PromptView {
  readonly conversation: ConversationMessage[];
  readonly isClosed: boolean;
  /** The user sent a message. */
  readonly onSubmit: vscode.Event<string>;
  /** The user asked to stop the current generation (Esc / stop button while busy). */
  readonly onCancel: vscode.Event<void>;
  /** The prompt was closed (Esc while idle, close button, editor closed). */
  readonly onClosed: vscode.Event<void>;

  /** Sends a message as if the user typed it and pressed Enter. */
  submit(text: string): void;
  addUserMessage(text: string): void;
  /** Progress line, e.g. "Editing… 42 tokens". Hides the input until a result or answer arrives. */
  showStatus(text: string): void;
  /** Shows (or updates, while streaming) a markdown answer. */
  showAnswer(markdown: string, done: boolean): Promise<void>;
  /** Final line for a request that produced no answer (e.g. an error). Re-enables the input. */
  showError(text: string): void;
  close(): void;
}

export interface PromptOptions {
  /** The prompt appears right below this line. */
  anchorLine: number;
  /** Center the card horizontally (file prompt) instead of aligning it with the code. */
  centered: boolean;
  placeholder: string;
  /** Small label shown next to the input, e.g. the file name. */
  chip?: string;
}
