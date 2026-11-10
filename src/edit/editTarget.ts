import * as vscode from 'vscode';
import { DecisionEngine } from '../decisions/decisionEngine';

/** The lines an inline (Cmd+J) edit rewrites. An empty range on a blank line means "insert code here". */
export interface EditTarget {
  range: vscode.Range;
  description: string;
}

const FUNCTION_KINDS = new Set([
  vscode.SymbolKind.Function,
  vscode.SymbolKind.Method,
  vscode.SymbolKind.Constructor,
]);

/**
 * - With a selection: the selected lines (extended to whole lines).
 * - On a blank line: insert at the cursor.
 * - Otherwise: the current line or the enclosing function, as decided by the decision engine.
 */
export async function resolveEditTarget(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  instruction: string,
  decisions: DecisionEngine,
  signal?: AbortSignal,
): Promise<EditTarget> {
  if (!selection.isEmpty) {
    return { range: selectedLines(document, selection), description: 'selection' };
  }

  const line = document.lineAt(selection.active.line);
  if (line.isEmptyOrWhitespace) {
    return { range: new vscode.Range(line.range.start, line.range.start), description: 'insertion' };
  }

  const enclosingFunction = await findEnclosingFunction(document, selection.active);
  const scope = await decisions.chooseEditScope(
    { instruction, currentLine: line.text, hasEnclosingFunction: enclosingFunction !== undefined },
    signal,
  );
  if (scope === 'function' && enclosingFunction) {
    return { range: fullLines(document, enclosingFunction.start.line, enclosingFunction.end.line), description: 'function' };
  }
  return { range: fullLines(document, line.lineNumber, line.lineNumber), description: 'line' };
}

/** The code a question is about: the selection, else the enclosing function, else the lines around the cursor. */
export async function resolveQuestionContext(document: vscode.TextDocument, selection: vscode.Selection): Promise<{ range: vscode.Range; label: string }> {
  if (!selection.isEmpty) {
    return { range: selectedLines(document, selection), label: 'the selected code' };
  }
  const enclosingFunction = await findEnclosingFunction(document, selection.active);
  if (enclosingFunction) {
    return { range: fullLines(document, enclosingFunction.start.line, enclosingFunction.end.line), label: 'the function around the cursor' };
  }
  const start = Math.max(0, selection.active.line - 30);
  const end = Math.min(document.lineCount - 1, selection.active.line + 30);
  return { range: fullLines(document, start, end), label: 'the code around the cursor' };
}

/** Whole lines covered by a selection (a selection ending at column 0 doesn't include that line). */
export function selectedLines(document: vscode.TextDocument, selection: vscode.Selection): vscode.Range {
  const endLine = selection.end.character === 0 && selection.end.line > selection.start.line ? selection.end.line - 1 : selection.end.line;
  return fullLines(document, selection.start.line, endLine);
}

function fullLines(document: vscode.TextDocument, startLine: number, endLine: number): vscode.Range {
  return new vscode.Range(startLine, 0, endLine, document.lineAt(endLine).text.length);
}

/** Innermost function/method around the position, using the language's symbol provider. */
async function findEnclosingFunction(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Range | undefined> {
  let symbols: vscode.DocumentSymbol[] | undefined;
  try {
    symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', document.uri);
  } catch {
    return undefined;
  }
  let found: vscode.Range | undefined;
  const visit = (list: vscode.DocumentSymbol[] | undefined) => {
    for (const symbol of list ?? []) {
      if (!symbol.range?.contains(position)) {
        continue;
      }
      // `const handler = () => { ... }` is reported as a variable spanning several lines.
      const isMultilineVariable = symbol.kind === vscode.SymbolKind.Variable && !symbol.range.isSingleLine;
      if (FUNCTION_KINDS.has(symbol.kind) || isMultilineVariable) {
        found = symbol.range;
      }
      visit(symbol.children);
    }
  };
  visit(symbols);
  return found;
}
