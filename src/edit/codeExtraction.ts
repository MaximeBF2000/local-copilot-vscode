/** Helpers to turn chat model answers into plain code. */

/**
 * Returns the content of the first fenced code block (``` ... ```), or the whole text
 * when the answer has no fences. A missing closing fence (truncated answer) is tolerated.
 */
export function extractCode(answer: string): string {
  const withoutThinking = answer.replace(/<think>[\s\S]*?<\/think>/g, '');
  const fence = withoutThinking.match(/```[^\n`]*\n([\s\S]*?)(\n```|$)/);
  if (fence) {
    return fence[1];
  }
  return withoutThinking.replace(/^\n+|\s+$/g, '');
}

function indentationOf(line: string): string {
  return line.match(/^[ \t]*/)![0];
}

/** The smallest indentation among non-empty lines. */
export function commonIndentation(lines: string[]): string {
  const indents = lines.filter((line) => line.trim() !== '').map(indentationOf);
  if (indents.length === 0) {
    return '';
  }
  return indents.reduce((shortest, indent) => (indent.length < shortest.length ? indent : shortest));
}

/**
 * Models often drop the original indentation of a snippet. Re-indent the generated code
 * so its least-indented lines line up with the original code's least-indented lines.
 */
export function matchIndentation(generated: string, originalIndent: string): string {
  const lines = generated.split('\n');
  const currentIndent = commonIndentation(lines);
  if (currentIndent === originalIndent) {
    return generated;
  }
  return lines
    .map((line) => (line.trim() === '' ? '' : originalIndent + line.slice(currentIndent.length)))
    .join('\n');
}
