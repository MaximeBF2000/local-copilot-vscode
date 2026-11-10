import * as vscode from 'vscode';
import { ConversationMessage, PromptOptions, PromptView } from './promptView';

/** Must match `commentController == localCopilot` in package.json when-clauses. */
const CONTROLLER_ID = 'localCopilot';

/**
 * Fallback prompt, used when the compact embedded prompt isn't available: VS Code's native
 * comment widget, shown right below a line. Answers are rendered as markdown in the thread.
 */
export class CommentPrompt implements PromptView {
  readonly conversation: ConversationMessage[] = [];
  private closed = false;
  private answering = false;
  private readonly submitEmitter = new vscode.EventEmitter<string>();
  private readonly cancelEmitter = new vscode.EventEmitter<void>();
  private readonly closedEmitter = new vscode.EventEmitter<void>();
  readonly onSubmit = this.submitEmitter.event;
  readonly onCancel = this.cancelEmitter.event;
  readonly onClosed = this.closedEmitter.event;

  constructor(readonly thread: vscode.CommentThread, private readonly assistantIcon: vscode.Uri) {}

  get isClosed(): boolean {
    return this.closed;
  }

  submit(text: string): void {
    this.submitEmitter.fire(text);
  }

  addUserMessage(text: string): void {
    this.conversation.push({ role: 'user', content: text });
    this.thread.canReply = false;
    this.render('$(loading~spin) Thinking…');
  }

  showStatus(text: string): void {
    this.render(`$(loading~spin) ${text}`);
  }

  async showAnswer(markdown: string, done: boolean): Promise<void> {
    this.answering = !done;
    if (done) {
      this.conversation.push({ role: 'assistant', content: markdown });
      this.render();
      this.thread.canReply = true;
    } else {
      this.render(markdown || '…');
    }
  }

  showError(text: string): void {
    this.render(`$(error) ${text}`);
    this.thread.canReply = true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.answering) this.cancelEmitter.fire();
    this.thread.dispose();
    this.closedEmitter.fire();
    [this.submitEmitter, this.cancelEmitter, this.closedEmitter].forEach((e) => e.dispose());
  }

  private render(pendingReply?: string): void {
    const comments: vscode.Comment[] = this.conversation.map((message) =>
      message.role === 'user'
        ? { body: message.content, mode: vscode.CommentMode.Preview, author: { name: 'You' } }
        : this.assistantComment(message.content),
    );
    if (pendingReply !== undefined) comments.push(this.assistantComment(pendingReply));
    this.thread.comments = comments;
  }

  private assistantComment(markdown: string): vscode.Comment {
    return {
      body: new vscode.MarkdownString(markdown, true),
      mode: vscode.CommentMode.Preview,
      author: { name: 'Local Copilot', iconPath: this.assistantIcon },
    };
  }
}

/** Owns the comment controller behind CommentPrompt (one open prompt at a time). */
export class CommentPromptService implements vscode.Disposable {
  private readonly controller = vscode.comments.createCommentController(CONTROLLER_ID, 'Local Copilot');
  private current: CommentPrompt | undefined;

  constructor(private readonly extensionUri: vscode.Uri) {
    this.controller.options = { prompt: 'Ask Local Copilot…', placeHolder: 'Ask a question or describe a change' };
  }

  open(editor: vscode.TextEditor, options: PromptOptions): CommentPrompt {
    this.current?.close();
    const line = options.anchorLine;
    const thread = this.controller.createCommentThread(editor.document.uri, new vscode.Range(line, 0, line, 0), []);
    thread.label = options.chip ? `Local Copilot · ${options.chip}` : 'Local Copilot';
    thread.canReply = true;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    const prompt = new CommentPrompt(thread, vscode.Uri.joinPath(this.extensionUri, 'media', 'assistant.svg'));
    prompt.onClosed(() => {
      if (this.current === prompt) this.current = undefined;
    });
    this.current = prompt;
    return prompt;
  }

  /** Called by the Send button and Cmd+Enter (VS Code passes the reply box content). */
  submit(reply: vscode.CommentReply): void {
    const text = reply.text.trim();
    if (this.current && this.current.thread === reply.thread && text) {
      this.current.submit(text);
    }
  }

  close(thread?: vscode.CommentThread): void {
    if (!thread || this.current?.thread === thread) this.current?.close();
  }

  dispose(): void {
    this.current?.close();
    this.controller.dispose();
  }
}
