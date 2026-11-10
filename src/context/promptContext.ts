import * as vscode from 'vscode';
import { logger } from '../logger';
import { getServices } from '../services';
import { collectDefinitions, formatDefinitions } from './definitions';

/**
 * Definitions of the symbols used in `range` (functions, types, variables from imports or elsewhere
 * in the file), formatted for a prompt. Empty when disabled in the settings or nothing was found.
 */
export async function definitionsContext(document: vscode.TextDocument, range: vscode.Range, signal: AbortSignal): Promise<string> {
  const { settings } = getServices();
  if (!settings.context.definitions) return '';
  const startedAt = Date.now();
  const snippets = await collectDefinitions(document, range, settings.context.maxDefinitionChars, signal);
  logger.debug(
    `Context: ${snippets.length} definitions in ${Date.now() - startedAt}ms ` +
      `(${snippets.map((s) => `${s.names.join('/')}@${s.path}`).join(', ') || 'none'})`,
  );
  return formatDefinitions(snippets);
}
