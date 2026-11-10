/** Pure helpers to describe text changes. */

export interface ChangedRegion {
  /** First line that differs (0-based). */
  startLine: number;
  /** Number of lines of the old text that are replaced. */
  oldLineCount: number;
  /** The lines that replace them. */
  newLines: string[];
}

/**
 * The smallest block of whole lines to replace to turn `oldText` into `newText`
 * (common leading and trailing lines are kept). Undefined when the texts are equal.
 */
export function findChangedRegion(oldText: string, newText: string): ChangedRegion | undefined {
  if (oldText === newText) {
    return undefined;
  }
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) {
    start++;
  }
  let oldEnd = oldLines.length;
  let newEnd = newLines.length;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  return { startLine: start, oldLineCount: oldEnd - start, newLines: newLines.slice(start, newEnd) };
}
