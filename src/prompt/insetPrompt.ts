import * as vscode from 'vscode';
import { ConversationMessage, PromptOptions, PromptView } from './promptView';

/**
 * The `editorInsets` proposed API: embeds a webview between two lines of an editor.
 * It is only available when VS Code is started with the proposal enabled
 * (see README → "Enable the compact prompt").
 */
interface WebviewEditorInset {
  readonly webview: vscode.Webview;
  readonly onDidDispose: vscode.Event<void>;
  dispose(): void;
}
type CreateInset = (editor: vscode.TextEditor, line: number, height: number, options?: vscode.WebviewOptions) => WebviewEditorInset;

const MIN_LINES = 2;
const MAX_LINES = 26;

type FromWebview =
  | { type: 'ready' }
  | { type: 'submit'; text: string }
  | { type: 'draft'; text: string }
  | { type: 'height'; px: number }
  | { type: 'cancel' }
  | { type: 'close' };

/**
 * Compact prompt card embedded in the editor. The extension owns the state (messages, status)
 * and re-sends it whole, so the embedded area can be recreated at a new height at any time.
 */
export class InsetPrompt implements PromptView {
  readonly conversation: ConversationMessage[] = [];
  private readonly renderedMessages: { role: string; html: string }[] = [];
  private status: { text: string; kind: 'progress' | 'error' } | undefined;
  private draft = '';
  /** True while an answer is streaming into the last message. */
  private answering = false;
  private inset: WebviewEditorInset | undefined;
  private heightLines = MIN_LINES + 1;
  private closed = false;
  private resizeTimer: NodeJS.Timeout | undefined;

  private readonly submitEmitter = new vscode.EventEmitter<string>();
  private readonly cancelEmitter = new vscode.EventEmitter<void>();
  private readonly closedEmitter = new vscode.EventEmitter<void>();
  readonly onSubmit = this.submitEmitter.event;
  readonly onCancel = this.cancelEmitter.event;
  readonly onClosed = this.closedEmitter.event;

  private constructor(
    private readonly editor: vscode.TextEditor,
    private readonly options: PromptOptions,
    private readonly extensionUri: vscode.Uri,
    private readonly createInset: CreateInset,
  ) {}

  /** Opens the prompt, or returns undefined when the editorInsets API isn't enabled. */
  static open(editor: vscode.TextEditor, options: PromptOptions, extensionUri: vscode.Uri): InsetPrompt | undefined {
    const createInset = (vscode.window as unknown as { createWebviewTextEditorInset?: CreateInset }).createWebviewTextEditorInset;
    if (!createInset) return undefined;
    const prompt = new InsetPrompt(editor, options, extensionUri, createInset);
    try {
      prompt.mount();
    } catch {
      return undefined; // The proposal is declared but not enabled for this VS Code instance.
    }
    return prompt;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  submit(text: string): void {
    this.draft = '';
    this.submitEmitter.fire(text);
  }

  addUserMessage(text: string): void {
    this.conversation.push({ role: 'user', content: text });
    this.renderedMessages.push({ role: 'user', html: escapeHtml(text) });
    this.status = { text: 'Thinking…', kind: 'progress' };
    this.sync();
  }

  showStatus(text: string): void {
    this.status = { text, kind: 'progress' };
    this.sync();
  }

  async showAnswer(markdown: string, done: boolean): Promise<void> {
    const html = await renderMarkdown(markdown);
    if (this.answering) {
      this.renderedMessages[this.renderedMessages.length - 1].html = html;
    } else {
      this.renderedMessages.push({ role: 'assistant', html });
      this.answering = true;
    }
    if (done) {
      this.answering = false;
      this.conversation.push({ role: 'assistant', content: markdown });
      this.status = undefined;
    } else {
      this.status = { text: 'Answering…', kind: 'progress' };
    }
    this.sync(done);
  }

  showError(text: string): void {
    this.status = { text, kind: 'error' };
    this.sync(true);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.resizeTimer);
    this.inset?.dispose();
    this.closedEmitter.fire();
    [this.submitEmitter, this.cancelEmitter, this.closedEmitter].forEach((e) => e.dispose());
  }

  /** Creates (or recreates, after a height change) the embedded webview. */
  private mount(): void {
    const previous = this.inset;
    this.inset = undefined;
    previous?.dispose();

    const inset = this.createInset(this.editor, this.options.anchorLine, this.heightLines, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    });
    this.inset = inset;
    inset.webview.html = this.html(inset.webview);
    inset.webview.onDidReceiveMessage((message: FromWebview) => this.handleMessage(message));
    inset.onDidDispose(() => {
      // Disposed by VS Code (e.g. the editor was closed), not by a recreation.
      if (this.inset === inset) this.close();
    });
  }

  private handleMessage(message: FromWebview): void {
    switch (message.type) {
      case 'ready':
        this.sync(true);
        break;
      case 'draft':
        this.draft = message.text;
        break;
      case 'submit':
        this.submit(message.text);
        break;
      case 'height':
        this.scheduleResize(message.px);
        break;
      case 'cancel':
        this.cancelEmitter.fire();
        break;
      case 'close':
        this.close();
        void vscode.window.showTextDocument(this.editor.document, this.editor.viewColumn);
        break;
    }
  }

  /** Grows or shrinks the embedded area to fit the card (debounced: recreating it is not free). */
  private scheduleResize(px: number): void {
    clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      const lines = Math.max(MIN_LINES, Math.min(MAX_LINES, Math.ceil(px / editorLineHeight())));
      if (lines !== this.heightLines && !this.closed) {
        this.heightLines = lines;
        this.mount();
      }
    }, 60);
  }

  private sync(focus = false): void {
    void this.inset?.webview.postMessage({
      type: 'state',
      state: {
        centered: this.options.centered,
        placeholder: this.options.placeholder,
        chip: this.options.chip,
        messages: this.renderedMessages,
        status: this.status,
        busy: this.status?.kind === 'progress',
        draft: this.draft,
        focus,
      },
    });
  }

  private html(webview: vscode.Webview): string {
    const media = (file: string) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', file));
    const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; img-src ${webview.cspSource} data:; script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${media('prompt.css')}">
</head>
<body class="${this.options.centered ? 'centered' : ''}">
  <div class="card">
    <div id="messages"></div>
    <div class="input-row">
      <span id="chip" class="chip" hidden></span>
      <textarea id="input" rows="1" aria-label="Prompt"></textarea>
      <div id="status" class="status" hidden><span id="spinner" class="spinner"></span><span id="status-text"></span></div>
      <span id="hint" class="hint">⏎ send · ⇧⏎ new line · esc</span>
      <button id="stop" title="Stop (Esc)" aria-label="Stop" hidden><svg viewBox="0 0 16 16"><rect x="4" y="4" width="8" height="8" rx="1"/></svg></button>
      <button id="close" title="Close (Esc)" aria-label="Close"><svg viewBox="0 0 16 16"><path d="M8 7.3l3.6-3.6.7.7L8.7 8l3.6 3.6-.7.7L8 8.7l-3.6 3.6-.7-.7L7.3 8 3.7 4.4l.7-.7z"/></svg></button>
    </div>
  </div>
  <script nonce="${nonce}" src="${media('prompt.js')}"></script>
</body>
</html>`;
  }
}

/** Editor line height in pixels, as VS Code computes it from the settings. */
function editorLineHeight(): number {
  const config = vscode.workspace.getConfiguration('editor');
  const fontSize = config.get<number>('fontSize', 14);
  const lineHeight = config.get<number>('lineHeight', 0);
  if (lineHeight <= 0) return Math.round(fontSize * 1.5);
  return lineHeight < 8 ? Math.round(fontSize * lineHeight) : lineHeight;
}

async function renderMarkdown(markdown: string): Promise<string> {
  try {
    return await vscode.commands.executeCommand<string>('markdown.api.render', markdown);
  } catch {
    return `<pre>${escapeHtml(markdown)}</pre>`;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
