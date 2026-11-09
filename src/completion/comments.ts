/** Language-agnostic helpers to recognise code comments. */

const COMMENT_START = /^\s*(\/\/+|#+(?!include|define|if|endif|import|pragma|!)|--|;+|%+|\/\*+|\*(?!\/)|<!--|"""|''')/;
const COMMENT_MARKERS = /^\s*(\/\/+|#+|--|;+|%+|\/\*+|\*+|<!--|"""|''')\s?|\s*(\*\/|-->|"""|''')\s*$/g;

export function isCommentLine(line: string): boolean {
  return COMMENT_START.test(line);
}

export function stripCommentMarkers(line: string): string {
  return line.replace(COMMENT_MARKERS, '').trim();
}

/**
 * Returns the comment block that directly precedes the cursor line
 * (contiguous comment lines, without markers), or undefined if there is none.
 */
export function commentBlockAbove(linesBeforeCursor: string[]): string | undefined {
  const commentLines: string[] = [];
  for (let i = linesBeforeCursor.length - 1; i >= 0; i--) {
    const line = linesBeforeCursor[i];
    if (!isCommentLine(line)) {
      break;
    }
    commentLines.unshift(stripCommentMarkers(line));
  }
  const text = commentLines.filter(Boolean).join(' ').trim();
  return text || undefined;
}
