import * as vscode from 'vscode';
import { pickIdentifiers } from './identifiers';

/** A definition used by the target code, extracted from another place in the workspace. */
export interface DefinitionSnippet {
  /** Workspace-relative path. */
  path: string;
  /** The symbol(s) of the target code that resolve here. */
  names: string[];
  startLine: number;
  code: string;
}

const MAX_IDENTIFIERS = 60;
const MAX_SNIPPET_LINES = 80;
const LOOKUP_TIMEOUT_MS = 1500;

const DEFINITION_KINDS = new Set([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Class,
  vscode.SymbolKind.Interface,
  vscode.SymbolKind.Enum,
  vscode.SymbolKind.Struct,
  vscode.SymbolKind.TypeParameter,
  vscode.SymbolKind.Constant,
  vscode.SymbolKind.Variable,
  vscode.SymbolKind.Constructor,
  vscode.SymbolKind.Module,
]);

/**
 * Asks the language server where each symbol used in `range` is defined, and returns the
 * definitions that live outside that range (other files, or elsewhere in the same file),
 * most-used first, until `budgetChars` is reached. Files under node_modules are skipped.
 */
export async function collectDefinitions(
  document: vscode.TextDocument,
  range: vscode.Range,
  budgetChars: number,
  signal?: AbortSignal,
): Promise<DefinitionSnippet[]> {
  const text = document.getText(range);
  const startOffset = document.offsetAt(range.start);
  const identifiers = pickIdentifiers(text, document.languageId).slice(0, MAX_IDENTIFIERS);

  const lookups = identifiers.map(async (identifier) => {
    const position = document.positionAt(startOffset + identifier.offset);
    const location = await resolveDefinition(document.uri, position);
    return { identifier, location };
  });
  const resolved = await Promise.all(lookups);
  if (signal?.aborted) return [];

  // Group names by the snippet they resolve to, keeping the order of first use.
  const snippets = new Map<string, DefinitionSnippet>();
  for (const { identifier, location } of resolved) {
    if (!location || !isUsefulLocation(location, document, range)) continue;
    const snippet = await extractSnippet(location);
    if (!snippet) continue;
    const key = `${snippet.path}:${snippet.startLine}`;
    const existing = snippets.get(key);
    if (existing) {
      if (!existing.names.includes(identifier.name)) existing.names.push(identifier.name);
    } else {
      snippets.set(key, { ...snippet, names: [identifier.name] });
    }
  }

  const selected: DefinitionSnippet[] = [];
  let used = 0;
  for (const snippet of snippets.values()) {
    if (used + snippet.code.length > budgetChars) continue;
    selected.push(snippet);
    used += snippet.code.length;
  }
  return selected;
}

/** Formats definitions as read-only context for a prompt. */
export function formatDefinitions(snippets: DefinitionSnippet[]): string {
  return snippets
    .map((s) => `Definition of ${s.names.join(', ')} (${s.path}, line ${s.startLine + 1}):\n\`\`\`\n${s.code}\n\`\`\``)
    .join('\n\n');
}

const IMPORT_STATEMENT = /^\s*(import\b|from\s+\S+\s+import\b|export\s+.*\bfrom\b|(const|let|var)\s.*\brequire\()/;

/**
 * Where a symbol is declared. When the first answer is an import statement (some language servers
 * stop there, e.g. while still loading), follows it once more to the real declaration.
 */
async function resolveDefinition(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location | undefined> {
  const first = (await withTimeout(definitionsAt(uri, position), LOOKUP_TIMEOUT_MS))?.[0];
  if (!first) return undefined;
  const document = await vscode.workspace.openTextDocument(first.uri).then(
    (d) => d,
    () => undefined,
  );
  if (!document || !IMPORT_STATEMENT.test(document.lineAt(first.range.start.line).text)) return first;
  const next = (await withTimeout(definitionsAt(first.uri, first.range.start), LOOKUP_TIMEOUT_MS))?.[0];
  return next && !(next.uri.toString() === first.uri.toString() && next.range.start.line === first.range.start.line) ? next : undefined;
}

async function definitionsAt(uri: vscode.Uri, position: vscode.Position): Promise<vscode.Location[]> {
  const results = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
    'vscode.executeDefinitionProvider',
    uri,
    position,
  );
  return (results ?? []).map((r) => ('targetUri' in r ? new vscode.Location(r.targetUri, r.targetSelectionRange ?? r.targetRange) : r));
}

function isUsefulLocation(location: vscode.Location, document: vscode.TextDocument, target: vscode.Range): boolean {
  if (location.uri.path.includes('/node_modules/')) return false;
  if (location.uri.scheme !== 'file' && location.uri.scheme !== 'untitled') return false;
  const sameDocument = location.uri.toString() === document.uri.toString();
  return !(sameDocument && target.contains(location.range.start));
}

/** The whole declaration around a definition (function, class, type…), via the file's symbols. */
async function extractSnippet(location: vscode.Location): Promise<Omit<DefinitionSnippet, 'names'> | undefined> {
  let document: vscode.TextDocument;
  try {
    document = await vscode.workspace.openTextDocument(location.uri);
  } catch {
    return undefined;
  }
  const symbols = await withTimeout(
    Promise.resolve(vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', location.uri)),
    LOOKUP_TIMEOUT_MS,
  );
  const symbolRange = innermostDeclaration(symbols ?? [], location.range.start);
  const start = symbolRange?.start.line ?? Math.max(0, location.range.start.line - 2);
  const naturalEnd = symbolRange?.end.line ?? location.range.start.line + 10;
  const end = Math.min(naturalEnd, start + MAX_SNIPPET_LINES - 1, document.lineCount - 1);
  const code = document.getText(new vscode.Range(start, 0, end, document.lineAt(end).text.length));
  const truncated = end < naturalEnd ? '\n// …' : '';
  return { path: vscode.workspace.asRelativePath(location.uri, false), startLine: start, code: code + truncated };
}

function innermostDeclaration(symbols: vscode.DocumentSymbol[], position: vscode.Position): vscode.Range | undefined {
  let found: vscode.Range | undefined;
  const visit = (list: vscode.DocumentSymbol[] | undefined) => {
    for (const symbol of list ?? []) {
      if (!symbol.range?.contains(position)) continue;
      if (DEFINITION_KINDS.has(symbol.kind)) found = symbol.range;
      visit(symbol.children);
    }
  };
  visit(symbols);
  return found;
}

function withTimeout<T>(promise: Thenable<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    Promise.resolve(promise).catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}
