import { CompletionMode } from './completionMode';

export interface CleanOptions {
  mode: CompletionMode;
  /** Text on the cursor line before the cursor. */
  linePrefix: string;
  /** Code after the cursor. */
  suffix: string;
  stopTokens: string[];
  /** The model hit its token limit, so the last line is probably cut off. */
  truncated?: boolean;
}

/**
 * Cleans raw model output into a suggestion that fits the cursor position.
 * Returns an empty string when there is nothing worth showing.
 */
export function cleanCompletion(raw: string, options: CleanOptions): string {
  let text = cutAtStopTokens(raw, options.stopTokens);
  const lines = text.split('\n');

  // Single line: keep the first line. If the model started with a line break, it wants to
  // continue on the next line (e.g. arguments on their own line): treat it as a block instead.
  if (options.mode === 'singleLine' && lines[0].trim() !== '') {
    return lines[0].trimEnd();
  }

  if (options.truncated && lines.length > 1) {
    text = lines.slice(0, -1).join('\n');
  }
  text = text.replace(/\s+$/, '');
  text = cutAtEndOfBlock(text, options.linePrefix);
  text = removeOverlapWithSuffix(text, options.suffix);
  return text.trim() === '' ? '' : text;
}

function cutAtStopTokens(text: string, stopTokens: string[]): string {
  let end = text.length;
  for (const token of stopTokens) {
    const index = text.indexOf(token);
    if (index >= 0 && index < end) {
      end = index;
    }
  }
  return text.slice(0, end);
}

function indentationOf(line: string): number {
  return line.match(/^[ \t]*/)![0].replace(/\t/g, '    ').length;
}

/**
 * Stops a multiline suggestion when it leaves the block the cursor is in
 * (a line indented less than the cursor line), e.g. when the model starts writing the next function.
 */
function cutAtEndOfBlock(text: string, linePrefix: string): string {
  const lines = text.split('\n');
  // On an empty line the cursor's column is the block indentation; after code, nested lines are deeper.
  const cursorIndent = indentationOf(linePrefix);
  const baseIndent = linePrefix.trim() === '' ? cursorIndent : cursorIndent + 1;
  const kept: string[] = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() !== '' && indentationOf(line) < baseIndent) {
      // Keep a closing bracket at the cursor line's level (e.g. `);` closing the call being completed).
      const closesCurrentLine = linePrefix.trim() !== '' && indentationOf(line) === cursorIndent && /^\s*[)\]}]/.test(line);
      if (closesCurrentLine) kept.push(line);
      break;
    }
    kept.push(line);
  }
  return kept.join('\n').replace(/\s+$/, '');
}

/** Drops trailing lines that already exist right after the cursor (e.g. a closing brace). */
function removeOverlapWithSuffix(text: string, suffix: string): string {
  const suffixLines = suffix
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (suffixLines.length === 0) {
    return text;
  }
  const lines = text.split('\n');
  for (let overlap = Math.min(lines.length - 1, suffixLines.length); overlap > 0; overlap--) {
    const tail = lines.slice(lines.length - overlap).map((line) => line.trim());
    if (tail.every((line, index) => line === suffixLines[index])) {
      return lines.slice(0, lines.length - overlap).join('\n').replace(/\s+$/, '');
    }
  }
  return text;
}

/** True when the suggestion would only repeat code that is already right after the cursor. */
export function duplicatesSuffix(text: string, suffix: string): boolean {
  const normalized = text.trim();
  return normalized.length > 0 && suffix.trimStart().startsWith(normalized);
}
