/**
 * The code around the cursor that is sent to the model.
 * Built from plain strings so it can be unit tested without VS Code.
 */
export interface CompletionContext {
  /** Code before the cursor (limited window, with file imports prepended when cut off). */
  prefix: string;
  /** Code after the cursor (limited window). */
  suffix: string;
  /** Text on the cursor line, before the cursor. */
  linePrefix: string;
  /** Text on the cursor line, after the cursor. */
  lineSuffix: string;
  languageId: string;
  filePath: string;
  projectName: string;
}

export interface DocumentSnapshot {
  lines: string[];
  cursorLine: number;
  cursorCharacter: number;
  languageId: string;
  filePath: string;
  projectName: string;
}

export interface ContextWindow {
  prefixLines: number;
  suffixLines: number;
}

const IMPORT_LINE =
  /^\s*(import\s|from\s+\S+\s+import\s|export\s+.*\s+from\s|#include\s|using\s+[\w.]+;|package\s|use\s+[\w:]+|require\s|(const|let|var)\s+.*=\s*require\()/;

export function buildCompletionContext(doc: DocumentSnapshot, window: ContextWindow): CompletionContext {
  const { lines, cursorLine, cursorCharacter } = doc;
  const currentLine = lines[cursorLine] ?? '';
  const linePrefix = currentLine.slice(0, cursorCharacter);
  const lineSuffix = currentLine.slice(cursorCharacter);

  const firstPrefixLine = Math.max(0, cursorLine - window.prefixLines);
  const prefixBody = [...lines.slice(firstPrefixLine, cursorLine), linePrefix].join('\n');
  const skippedImports = collectImportLines(lines.slice(0, firstPrefixLine));
  const prefix = skippedImports.length ? `${skippedImports.join('\n')}\n\n${prefixBody}` : prefixBody;

  const lastSuffixLine = Math.min(lines.length, cursorLine + 1 + window.suffixLines);
  const suffix = [lineSuffix, ...lines.slice(cursorLine + 1, lastSuffixLine)].join('\n');

  return {
    prefix,
    suffix,
    linePrefix,
    lineSuffix,
    languageId: doc.languageId,
    filePath: doc.filePath,
    projectName: doc.projectName,
  };
}

/** Import/include statements, so the model knows available symbols even when the top of the file is cut off. */
export function collectImportLines(lines: string[]): string[] {
  return lines.filter((line) => IMPORT_LINE.test(line)).slice(0, 40);
}

const EXTENSIONS: Record<string, string> = {
  typescript: 'ts',
  typescriptreact: 'tsx',
  javascript: 'js',
  javascriptreact: 'jsx',
  python: 'py',
  rust: 'rs',
  go: 'go',
  java: 'java',
  kotlin: 'kt',
  swift: 'swift',
  ruby: 'rb',
  php: 'php',
  csharp: 'cs',
  cpp: 'cpp',
  c: 'c',
  shellscript: 'sh',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  markdown: 'md',
  sql: 'sql',
  vue: 'vue',
  svelte: 'svelte',
  dart: 'dart',
  lua: 'lua',
};

/**
 * The path shown to the model. Unsaved files get a name with the right extension
 * ("untitled.ts" instead of "Untitled-1"), because the extension tells the model the language.
 */
export function pathForModel(relativePath: string, isUntitled: boolean, languageId: string): string {
  if (!isUntitled) {
    return relativePath;
  }
  const extension = EXTENSIONS[languageId] ?? languageId;
  return `untitled.${extension}`;
}
