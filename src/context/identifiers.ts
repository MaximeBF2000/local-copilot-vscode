/** Picks the identifiers worth resolving in a piece of code. Pure, no VS Code dependency. */

export interface Identifier {
  name: string;
  /** Offset of its first use within the code. */
  offset: number;
}

const KEYWORDS = new Set(
  (
    'abstract and as async await break case catch class const continue debugger def default del delete do elif else enum ' +
    'except export extends false finally for from function get global if implements import in instanceof interface is ' +
    'lambda let new nil none not null of or package pass private protected public raise readonly return self set static ' +
    'super switch this throw true try type typeof undefined var void while with yield True False None ' +
    'string number boolean any unknown never object symbol bigint int float str bool dict list tuple ' +
    'console window document Math JSON Object Array String Number Boolean Promise Error Map Set Date RegExp Symbol ' +
    'parseInt parseFloat setTimeout clearTimeout setInterval clearInterval require module exports print len range'
  ).split(' '),
);

/** Strips string literals and comments so their words aren't mistaken for symbols. */
function withoutStringsAndComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*|(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, (match) => ' '.repeat(match.length));
}

/**
 * Unique identifiers in order of first use, skipping keywords, built-ins, very short names
 * and property names after a dot (`obj.prop`: `obj` is resolved, its type brings `prop`).
 */
export function pickIdentifiers(code: string, languageId: string): Identifier[] {
  const cleaned = languageId === 'markdown' ? code : withoutStringsAndComments(code);
  const seen = new Set<string>();
  const identifiers: Identifier[] = [];
  for (const match of cleaned.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = match[0];
    const offset = match.index!;
    const previous = cleaned[offset - 1];
    if (name.length < 3 || KEYWORDS.has(name) || seen.has(name) || previous === '.') continue;
    seen.add(name);
    identifiers.push({ name, offset });
  }
  return identifiers;
}
