import { commentBlockAbove } from './comments';

/**
 * How much code a suggestion should contain:
 * - singleLine: finish the current line
 * - multiline: write a block (cursor on an empty line or right after a block opener)
 * - commentToCode: implement the comment directly above the cursor
 */
export type CompletionMode = 'singleLine' | 'multiline' | 'commentToCode';

/** Line endings after which the next code is a new block (an open parenthesis usually just needs arguments). */
const BLOCK_OPENER = /([{[:]|=>|\bthen|\bdo)\s*$/;

/** The comment the cursor sits below, when the cursor is on an empty line. */
export function commentAboveCursor(prefix: string, linePrefix: string): string | undefined {
  if (linePrefix.trim() !== '') {
    return undefined;
  }
  const linesAbove = prefix.split('\n').slice(0, -1);
  return commentBlockAbove(linesAbove);
}

/** Chooses the mode from the cursor position. `isImplementationRequest` is the decision for the comment above, if any. */
export function chooseCompletionMode(linePrefix: string, lineSuffix: string, isImplementationRequest: boolean): CompletionMode {
  if (linePrefix.trim() === '') {
    return isImplementationRequest ? 'commentToCode' : 'multiline';
  }
  if (lineSuffix.trim() === '' && BLOCK_OPENER.test(linePrefix)) {
    return 'multiline';
  }
  return 'singleLine';
}
