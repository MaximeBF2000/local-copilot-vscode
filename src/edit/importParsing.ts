/** Finds local (relative) imports in a source file. Pure, no VS Code dependency. */

export interface LocalImport {
  /** The module path as written, e.g. `./utils` or `.models`. */
  specifier: string;
  /** Names imported from it, e.g. `formatDate`. */
  symbols: string[];
}

// The import clause can't contain quotes or semicolons, so a match never spans several statements.
const JS_IMPORT = /import\s+(?:type\s+)?([^;'"]*?)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g;
const JS_REQUIRE = /(?:const|let|var)\s+([^;'"=]*?)\s*=\s*require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
const PY_FROM_IMPORT = /^from\s+(\.+[\w.]*)\s+import\s+(.+)$/gm;

export function findLocalImports(source: string, languageId: string): LocalImport[] {
  if (languageId === 'python') {
    return [...source.matchAll(PY_FROM_IMPORT)].map((m) => ({ specifier: m[1], symbols: splitNames(m[2]) }));
  }
  const imports = [...source.matchAll(JS_IMPORT), ...source.matchAll(JS_REQUIRE)];
  return imports.map((m) => ({ specifier: m[2], symbols: splitNames(m[1]) }));
}

/** `{ a, b as c }, d` → ['a', 'b', 'd'] */
function splitNames(clause: string): string[] {
  return clause
    .replace(/[{}()*]/g, ' ')
    .split(/[,\s]+/)
    .filter((word, index, words) => /^[A-Za-z_$][\w$]*$/.test(word) && word !== 'as' && word !== 'type' && words[index - 1] !== 'as');
}

/** Candidate relative file paths for an import specifier (without the base directory). */
export function candidatePaths(specifier: string, languageId: string): string[] {
  if (languageId === 'python') {
    const dots = specifier.match(/^\.+/)![0].length;
    const rest = specifier.slice(dots).replace(/\./g, '/');
    const up = dots > 1 ? '../'.repeat(dots - 1) : './';
    return rest ? [`${up}${rest}.py`, `${up}${rest}/__init__.py`] : [];
  }
  const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'];
  const base = specifier.replace(/\.js$/, '');
  return [
    ...extensions.map((ext) => specifier + ext),
    ...extensions.slice(1).map((ext) => base + ext),
    ...extensions.slice(1).map((ext) => `${specifier}/index${ext}`),
  ];
}
