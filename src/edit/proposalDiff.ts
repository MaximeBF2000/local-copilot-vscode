import * as path from 'path';
import * as vscode from 'vscode';

const SCHEME = 'local-copilot-proposal';

interface PendingProposal {
  document: vscode.TextDocument;
  /** Document version the proposal was generated from; used to refuse stale proposals. */
  baseVersion: number;
  newText: string;
  proposalUri: vscode.Uri;
}

/**
 * Shows a proposed new file content in a diff editor (current file ↔ proposal)
 * with Accept/Reject buttons in the editor title bar and in a notification.
 */
export class ProposalDiff implements vscode.TextDocumentContentProvider, vscode.Disposable {
  private pending: PendingProposal | undefined;
  private readonly contents = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private counter = 0;

  constructor() {
    this.disposables.push(
      vscode.workspace.registerTextDocumentContentProvider(SCHEME, this),
      // Closing the diff tab counts as rejecting the proposal.
      vscode.window.tabGroups.onDidChangeTabs((event) => {
        if (this.pending && event.closed.some((tab) => this.isProposalTab(tab))) {
          this.clear();
        }
      }),
    );
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  async show(document: vscode.TextDocument, baseVersion: number, newText: string, instruction: string): Promise<void> {
    await this.reject();
    const fileName = path.basename(document.uri.fsPath);
    const proposalUri = vscode.Uri.from({ scheme: SCHEME, path: `/${fileName}`, query: String(++this.counter) });
    this.contents.set(proposalUri.toString(), newText);
    this.pending = { document, baseVersion, newText, proposalUri };
    await vscode.commands.executeCommand('setContext', 'localCopilot.fileEditPending', true);

    await vscode.commands.executeCommand('vscode.diff', document.uri, proposalUri, `${fileName} ↔ AI proposal: ${truncate(instruction, 50)}`, {
      preview: false,
    });

    const choice = await vscode.window.showInformationMessage(`Local Copilot: review the proposed changes to ${fileName}.`, 'Accept', 'Reject');
    if (this.pending?.proposalUri !== proposalUri) {
      return; // Already handled from the title bar buttons.
    }
    if (choice === 'Accept') await this.accept();
    if (choice === 'Reject') await this.reject();
  }

  async accept(): Promise<void> {
    const proposal = this.pending;
    if (!proposal) return;
    const { document } = proposal;

    if (document.version !== proposal.baseVersion) {
      const answer = await vscode.window.showWarningMessage(
        'The file was modified after the proposal was generated. Applying it will overwrite those changes.',
        { modal: true },
        'Apply Anyway',
      );
      if (answer !== 'Apply Anyway') return;
    }

    const edit = new vscode.WorkspaceEdit();
    const fullRange = new vscode.Range(0, 0, document.lineCount, 0);
    edit.replace(document.uri, document.validateRange(fullRange), proposal.newText);
    await vscode.workspace.applyEdit(edit);
    await this.closeDiffTab(proposal);
    this.clear();
    await vscode.window.showTextDocument(document);
  }

  async reject(): Promise<void> {
    const proposal = this.pending;
    if (!proposal) return;
    this.clear();
    await this.closeDiffTab(proposal);
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
  }

  private clear(): void {
    if (this.pending) {
      this.contents.delete(this.pending.proposalUri.toString());
    }
    this.pending = undefined;
    void vscode.commands.executeCommand('setContext', 'localCopilot.fileEditPending', false);
  }

  private async closeDiffTab(proposal: PendingProposal): Promise<void> {
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => tab.input instanceof vscode.TabInputTextDiff && tab.input.modified.toString() === proposal.proposalUri.toString());
    if (tabs.length) {
      await vscode.window.tabGroups.close(tabs);
    }
  }

  private isProposalTab(tab: vscode.Tab): boolean {
    return (
      tab.input instanceof vscode.TabInputTextDiff &&
      this.pending !== undefined &&
      tab.input.modified.toString() === this.pending.proposalUri.toString()
    );
  }
}

function truncate(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}
