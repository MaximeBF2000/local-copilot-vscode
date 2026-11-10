import * as vscode from 'vscode';
import { logger } from '../logger';
import { getServices } from '../services';
import { commonIndentation, extractCode, matchIndentation } from './codeExtraction';
import { applyEditBlocks, parseEditBlocks } from './editBlocks';
import { FileEditPromptInput, buildFileEditMessages, buildFullFileMessages, buildInlineEditMessages } from './editPrompts';
import { EditTarget } from './editTarget';

type Progress = (tokens: number) => void;

/** Asks the edit model to rewrite the target lines; returns the replacement code (indentation fixed). */
export async function generateReplacement(
  document: vscode.TextDocument,
  target: EditTarget,
  instruction: string,
  definitions: string,
  signal: AbortSignal,
  onProgress: Progress,
): Promise<string> {
  const { settings, ollama } = getServices();
  const contextLines = settings.edit.contextLines;
  const { range } = target;
  const beforeStart = Math.max(0, range.start.line - contextLines);
  const afterEnd = Math.min(document.lineCount - 1, range.end.line + contextLines);
  const targetCode = document.getText(range);
  const codeBefore = document.getText(new vscode.Range(beforeStart, 0, range.start.line, 0));
  const codeAfter =
    range.end.line + 1 <= afterEnd
      ? document.getText(new vscode.Range(range.end.line + 1, 0, afterEnd, document.lineAt(afterEnd).text.length))
      : '';

  const result = await ollama.chat({
    model: settings.editModel,
    messages: buildInlineEditMessages({
      instruction,
      filePath: vscode.workspace.asRelativePath(document.uri, false),
      languageId: document.languageId,
      codeBefore,
      targetCode,
      codeAfter,
      definitions,
    }),
    think: settings.edit.enableThinking,
    keepAlive: settings.keepAlive,
    options: { temperature: 0.2, num_ctx: 16384 },
    signal,
    onProgress: (_text, tokens) => onProgress(tokens),
  });
  logger.info(`Inline edit (${target.description}): ${result.tokenCount} tokens in ${result.durationMs}ms`);

  const code = extractCode(result.text).replace(/\s+$/, '');
  if (range.isEmpty) {
    // Insertion: align with the blank line's indentation when it has one, otherwise trust the model.
    const lineIndent = document.lineAt(range.start.line).text;
    return lineIndent ? matchIndentation(code, lineIndent) : code;
  }
  return matchIndentation(code, commonIndentation(targetCode.split('\n')));
}

/**
 * Asks for SEARCH/REPLACE blocks first (fast: only changed parts are generated) and falls back
 * to a full rewrite when they don't apply. Returns the new file content.
 */
export async function generateFileEdit(
  document: vscode.TextDocument,
  instruction: string,
  definitions: string,
  signal: AbortSignal,
  onProgress: (phase: 'editing' | 'rewriting', tokens: number) => void,
): Promise<string> {
  const { settings, ollama } = getServices();
  const originalText = document.getText();
  const input: FileEditPromptInput = {
    instruction,
    filePath: vscode.workspace.asRelativePath(document.uri, false),
    languageId: document.languageId,
    fileContent: originalText,
    definitions,
  };
  const chatOptions = {
    model: settings.editModel,
    think: settings.edit.enableThinking,
    keepAlive: settings.keepAlive,
    options: { temperature: 0.2, num_ctx: 32768 },
    signal,
  };

  const blocksAnswer = await ollama.chat({
    ...chatOptions,
    messages: buildFileEditMessages(input),
    onProgress: (_text, tokens) => onProgress('editing', tokens),
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
    onProgress: (_text, tokens) => onProgress('rewriting', tokens),
  });
  logger.info(`File rewrite: ${fullAnswer.tokenCount} tokens in ${fullAnswer.durationMs}ms`);
  const code = extractCode(fullAnswer.text);
  return originalText.endsWith('\n') && !code.endsWith('\n') ? `${code}\n` : code;
}
