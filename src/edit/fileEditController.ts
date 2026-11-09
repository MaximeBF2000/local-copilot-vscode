import * as path from 'path';
import * as vscode from 'vscode';
import { logger } from '../logger';
import { isAbortError } from '../ollama/ollamaClient';
import { getServices } from '../services';
import { StatusBar } from '../statusBar';
import { extractCode } from './codeExtraction';
import { applyEditBlocks, parseEditBlocks } from './editBlocks';
import { FileEditPromptInput, RelatedFile, buildFileEditMessages, buildFullFileMessages } from './editPrompts';
import { ProposalDiff } from './proposalDiff';
import { findImportedFiles, readRelatedFiles } from './relatedFiles';

/**
 * Cmd+Shift+J: asks for an instruction, rewrites the whole file (optionally using imported
 * files as context) and opens a diff to review the changes before accepting them.
 */
export class FileEditController implements vscode.Disposable {
  private readonly diff = new ProposalDiff();

  constructor(private readonly statusBar: StatusBar) {}

  async run(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const { document } = editor;

    const instruction = await vscode.window.showInputBox({
      title: `Local Copilot — edit ${path.basename(document.uri.fsPath)}`,
      placeHolder: 'e.g. "Refactor this file to use async/await", "Add JSDoc to exported functions"',
      ignoreFocusOut: true,
    });
    if (!instruction?.trim()) return;

    const originalText = document.getText();
    const originalVersion = document.version;
    const newText = await this.generateWithProgress(document, instruction, originalText);
    if (newText === undefined) return;

    if (document.version !== originalVersion) {
      void vscode.window.showWarningMessage('Local Copilot: the file changed while generating, so the edit was discarded.');
      return;
    }
    if (newText === originalText) {
      void vscode.window.showInformationMessage('Local Copilot: no changes suggested.');
      return;
    }
    await this.diff.show(document, originalVersion, newText, instruction);
  }

  accept(): Promise<void> {
    return this.diff.accept();
  }

  reject(): Promise<void> {
    return this.diff.reject();
  }

  dispose(): void {
    this.diff.dispose();
  }

  private generateWithProgress(document: vscode.TextDocument, instruction: string, originalText: string): Promise<string | undefined> {
    return Promise.resolve(
      vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Local Copilot', cancellable: true },
        async (progress, token) => {
          const abort = new AbortController();
          token.onCancellationRequested(() => abort.abort());
          const finishWork = this.statusBar.startWork();
          try {
            return await this.generate(document, instruction, originalText, abort.signal, (message) => progress.report({ message }));
          } catch (error) {
            if (!isAbortError(error)) {
              logger.error('File edit failed', error);
              this.statusBar.showError((error as Error).message);
              void vscode.window.showErrorMessage(`Local Copilot: ${(error as Error).message}`);
            }
            return undefined;
          } finally {
            finishWork();
          }
        },
      ),
    );
  }

  /** Asks for SEARCH/REPLACE blocks first (fast), and falls back to a full rewrite if they don't apply. */
  private async generate(
    document: vscode.TextDocument,
    instruction: string,
    originalText: string,
    signal: AbortSignal,
    report: (message: string) => void,
  ): Promise<string> {
    const { settings, ollama } = getServices();
    report('Reading context…');
    const relatedFiles = await this.gatherRelatedFiles(document, instruction, signal);
    const input: FileEditPromptInput = {
      instruction,
      filePath: vscode.workspace.asRelativePath(document.uri, false),
      languageId: document.languageId,
      fileContent: originalText,
      relatedFiles,
    };
    const chatOptions = {
      model: settings.editModel,
      think: settings.edit.enableThinking,
      keepAlive: settings.keepAlive,
      options: { temperature: 0.2, num_ctx: 32768 },
      signal,
    };
    const contextNote = relatedFiles.length ? ` (+${relatedFiles.length} related file${relatedFiles.length > 1 ? 's' : ''})` : '';

    const blocksAnswer = await ollama.chat({
      ...chatOptions,
      messages: buildFileEditMessages(input),
      onProgress: (_text, tokens) => report(`Editing${contextNote}… ${tokens} tokens`),
    });
    logger.info(`File edit: ${blocksAnswer.tokenCount} tokens in ${blocksAnswer.durationMs}ms`);
    const blocks = parseEditBlocks(blocksAnswer.text);
    if (blocks.length > 0) {
      const applied = applyEditBlocks(originalText, blocks);
      if (applied.ok) {
        return applied.text;
      }
      logger.info(`Edit block did not match the file, falling back to a full rewrite:\n${applied.failedBlock.search}`);
    } else {
      logger.info('No edit blocks in the answer, falling back to a full rewrite');
    }

    const fullAnswer = await ollama.chat({
      ...chatOptions,
      messages: buildFullFileMessages(input),
      onProgress: (_text, tokens) => report(`Rewriting file${contextNote}… ${tokens} tokens`),
    });
    logger.info(`File rewrite: ${fullAnswer.tokenCount} tokens in ${fullAnswer.durationMs}ms`);
    const code = extractCode(fullAnswer.text);
    return originalText.endsWith('\n') && !code.endsWith('\n') ? `${code}\n` : code;
  }

  private async gatherRelatedFiles(document: vscode.TextDocument, instruction: string, signal: AbortSignal): Promise<RelatedFile[]> {
    const { settings, decisions } = getServices();
    if (!settings.edit.includeRelatedFiles) return [];

    const imported = await findImportedFiles(document);
    const needed = await decisions.needsRelatedFiles(
      {
        instruction,
        relatedFileNames: imported.map((file) => path.parse(file.path).name),
        importedSymbols: imported.flatMap((file) => file.symbols),
      },
      signal,
    );
    logger.debug(`File edit: ${imported.length} imported files, include them: ${needed}`);
    return needed ? readRelatedFiles(imported.slice(0, settings.edit.maxRelatedFiles)) : [];
  }
}
