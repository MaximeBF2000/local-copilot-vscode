/**
 * SEARCH/REPLACE edit blocks: the model only writes the parts of the file that change,
 * which is much faster than regenerating the whole file.
 *
 * <<<<<<< SEARCH
 * old lines
 * =======
 * new lines
 * >>>>>>> REPLACE
 */

export interface EditBlock {
  search: string;
  replace: string;
}

const SEARCH_MARKER = /^<{5,9} ?SEARCH\s*$/;
const DIVIDER_MARKER = /^={5,9}\s*$/;
const REPLACE_MARKER = /^>{5,9} ?REPLACE\s*$/;

export function parseEditBlocks(answer: string): EditBlock[] {
  const blocks: EditBlock[] = [];
  let section: 'outside' | 'search' | 'replace' = 'outside';
  let search: string[] = [];
  let replace: string[] = [];

  for (const line of answer.split('\n')) {
    if (SEARCH_MARKER.test(line)) {
      section = 'search';
      search = [];
      replace = [];
    } else if (DIVIDER_MARKER.test(line) && section === 'search') {
      section = 'replace';
    } else if (REPLACE_MARKER.test(line) && section === 'replace') {
      blocks.push({ search: search.join('\n'), replace: replace.join('\n') });
      section = 'outside';
    } else if (section === 'search') {
      search.push(line);
    } else if (section === 'replace') {
      replace.push(line);
    }
  }
  return blocks;
}

export type ApplyResult = { ok: true; text: string } | { ok: false; failedBlock: EditBlock };

/** Applies blocks in order. Fails if any SEARCH part can't be found in the file. */
export function applyEditBlocks(original: string, blocks: EditBlock[]): ApplyResult {
  let text = original;
  for (const block of blocks) {
    const updated = applyBlock(text, block);
    if (updated === undefined) {
      return { ok: false, failedBlock: block };
    }
    text = updated;
  }
  return { ok: true, text };
}

function applyBlock(text: string, block: EditBlock): string | undefined {
  if (block.search.trim() === '') {
    // Only meaningful for an empty file: the replacement becomes the content.
    return text.trim() === '' ? block.replace : undefined;
  }

  const exactIndex = text.indexOf(block.search);
  const startsAtLineStart = exactIndex === 0 || text[exactIndex - 1] === '\n';
  if (exactIndex >= 0 && startsAtLineStart) {
    return text.slice(0, exactIndex) + block.replace + text.slice(exactIndex + block.search.length);
  }
  return applyIgnoringIndentation(text, block);
}

/** Matches lines while ignoring leading/trailing whitespace, then re-indents the replacement. */
function applyIgnoringIndentation(text: string, block: EditBlock): string | undefined {
  const lines = text.split('\n');
  const searchLines = trimBlankEdges(block.search.split('\n'));
  if (searchLines.length === 0) {
    return undefined;
  }
  const wanted = searchLines.map((line) => line.trim());

  for (let start = 0; start + wanted.length <= lines.length; start++) {
    const matches = wanted.every((line, i) => lines[start + i].trim() === line);
    if (!matches) continue;

    const fileIndent = leadingWhitespace(lines[start]);
    const searchIndent = leadingWhitespace(searchLines[0]);
    const replacement = trimBlankEdges(block.replace.split('\n')).map((line) => reindent(line, searchIndent, fileIndent));
    return [...lines.slice(0, start), ...replacement, ...lines.slice(start + wanted.length)].join('\n');
  }
  return undefined;
}

function leadingWhitespace(line: string): string {
  return line.match(/^[ \t]*/)![0];
}

function reindent(line: string, fromIndent: string, toIndent: string): string {
  if (line.trim() === '') return '';
  return line.startsWith(fromIndent) ? toIndent + line.slice(fromIndent.length) : toIndent + line.trimStart();
}

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start++;
  while (end > start && lines[end - 1].trim() === '') end--;
  return lines.slice(start, end);
}
