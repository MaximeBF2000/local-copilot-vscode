import * as vscode from 'vscode';
import { logger } from '../logger';
import { isAbortError } from '../ollama/ollamaClient';
import { getServices } from '../services';
import { StatusBar } from '../statusBar';
import { CompletionCache } from './completionCache';
import { CompletionContext, buildCompletionContext, pathForModel } from './completionContext';
import { CompletionMode, chooseCompletionMode, commentAboveCursor } from './completionMode';
import { generateCompletion } from './completionGenerator';
import { resolvePromptFormat } from './fimTemplates';

/**
 * Shows AI suggestions as ghost text. VS Code calls this on every keystroke and cancels
 * the previous call, so outdated requests are dropped automatically through the token.
 */
export class AutocompleteProvider implements vscode.InlineCompletionItemProvider {
  private readonly cache = new CompletionCache();

  /**
   * @param isPaused returns true while another feature owns the document (e.g. an inline prompt rewriting this file),
   *                 so ghost text never appears on top of it.
   */
  constructor(
    private readonly statusBar: StatusBar,
    private readonly isPaused: (document: vscode.TextDocument) => boolean = () => false,
  ) {}

  async provideInlineCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.InlineCompletionContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[] | undefined> {
    const { settings, ollama, decisions } = getServices();
    if (
      !settings.autocomplete.enabled ||
      settings.autocomplete.disabledLanguages.includes(document.languageId) ||
      this.isPaused(document)
    ) {
      return undefined;
    }
    // Don't compete with the IntelliSense suggestion widget.
    if (context.selectedCompletionInfo) {
      return undefined;
    }

    const isExplicit = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    const completionContext = this.readContext(document, position);
    const cachePosition = {
      documentKey: document.uri.toString(),
      offset: document.offsetAt(position),
      prefix: completionContext.prefix,
      suffix: completionContext.suffix,
    };

    const cached = this.cache.get(cachePosition);
    if (cached !== undefined) {
      logger.debug('completion: cache hit');
      return this.toItems(cached, completionContext, position);
    }

    if (!isExplicit && !(await waitForTypingPause(settings.autocomplete.debounceMs, token))) {
      return undefined;
    }

    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => abort.abort());
    const finishWork = this.statusBar.startWork();
    const startedAt = Date.now();
    try {
      // The "should we suggest?" decision runs in parallel with generation and cancels it when negative.
      const decision = isExplicit
        ? Promise.resolve(true)
        : decisions.shouldSuggest(
            {
              linePrefix: completionContext.linePrefix,
              lineSuffix: completionContext.lineSuffix,
              codeAroundCursor: codeAroundCursor(completionContext),
            },
            abort.signal,
          );
      decision.then((useful) => !useful && abort.abort()).catch(() => undefined);

      const mode = await this.chooseMode(completionContext, abort.signal);
      const format = resolvePromptFormat(settings.autocomplete.promptFormat, settings.model);
      const result = await generateCompletion(ollama, {
        model: settings.model,
        format,
        context: completionContext,
        mode,
        maxTokens: maxTokensFor(mode, settings.autocomplete),
        temperature: settings.autocomplete.temperature,
        keepAlive: settings.keepAlive,
        signal: abort.signal,
      });
      if (!(await decision) || token.isCancellationRequested) {
        return undefined;
      }

      this.statusBar.clearError();
      logger.debug(
        `completion: ${mode}, ${result.tokenCount} tokens, model ${result.durationMs}ms, total ${Date.now() - startedAt}ms` +
          (result.text ? '' : ' (empty)'),
      );
      if (!result.text) {
        return undefined;
      }
      this.cache.set(cachePosition, result.text);
      return this.toItems(result.text, completionContext, position);
    } catch (error) {
      if (!isAbortError(error) && !abort.signal.aborted) {
        logger.error('Autocomplete failed', error);
        this.statusBar.showError((error as Error).message);
      }
      return undefined;
    } finally {
      finishWork();
      cancellation.dispose();
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  private readContext(document: vscode.TextDocument, position: vscode.Position): CompletionContext {
    const { settings } = getServices();
    const lastLine = Math.min(document.lineCount - 1, position.line + settings.autocomplete.suffixLines + 1);
    const text = document.getText(new vscode.Range(0, 0, lastLine, document.lineAt(lastLine).text.length));
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    return buildCompletionContext(
      {
        lines: text.split(/\r?\n/),
        cursorLine: position.line,
        cursorCharacter: position.character,
        languageId: document.languageId,
        filePath: pathForModel(vscode.workspace.asRelativePath(document.uri, false), document.isUntitled, document.languageId),
        projectName: folder?.name ?? 'project',
      },
      { prefixLines: settings.autocomplete.prefixLines, suffixLines: settings.autocomplete.suffixLines },
    );
  }

  private async chooseMode(context: CompletionContext, signal: AbortSignal): Promise<CompletionMode> {
    const comment = commentAboveCursor(context.prefix, context.linePrefix);
    const isRequest = comment ? await getServices().decisions.isImplementationRequest(comment, signal) : false;
    return chooseCompletionMode(context.linePrefix, context.lineSuffix, isRequest);
  }

  /**
   * When the suggestion ends with the closing characters already after the cursor
   * (e.g. `)` auto-inserted by the editor), replace them instead of duplicating them.
   */
  private toItems(text: string, context: CompletionContext, position: vscode.Position): vscode.InlineCompletionItem[] {
    const closing = context.lineSuffix.trimEnd();
    const replacesClosing = closing !== '' && !text.includes('\n') && text.trimEnd().endsWith(closing);
    const range = replacesClosing
      ? new vscode.Range(position, position.translate(0, context.lineSuffix.length))
      : new vscode.Range(position, position);
    return [new vscode.InlineCompletionItem(text, range)];
  }
}

function maxTokensFor(
  mode: CompletionMode,
  limits: { maxTokensSingleLine: number; maxTokensMultiline: number; maxTokensCommentToCode: number },
): number {
  switch (mode) {
    case 'singleLine':
      return limits.maxTokensSingleLine;
    case 'multiline':
      return limits.maxTokensMultiline;
    case 'commentToCode':
      return limits.maxTokensCommentToCode;
  }
}

/** Resolves true after `ms` unless the user typed again (the token is cancelled) in the meantime. */
function waitForTypingPause(ms: number, token: vscode.CancellationToken): Promise<boolean> {
  if (ms <= 0) {
    return Promise.resolve(!token.isCancellationRequested);
  }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      listener.dispose();
      resolve(!token.isCancellationRequested);
    }, ms);
    const listener = token.onCancellationRequested(() => {
      clearTimeout(timer);
      listener.dispose();
      resolve(false);
    });
  });
}

/** A short excerpt around the cursor, for decision models. */
function codeAroundCursor(context: CompletionContext): string {
  const before = context.prefix.split('\n').slice(-15).join('\n');
  const after = context.suffix.split('\n').slice(0, 5).join('\n');
  return `${before}<CURSOR>${after}`;
}
