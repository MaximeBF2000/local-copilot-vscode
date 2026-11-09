/**
 * Fast, deterministic decision rules. They are the default decision engine
 * and the fallback whenever a decision model is unavailable or too slow.
 */

import { stripCommentMarkers } from '../completion/comments';

/** Characters that may follow the cursor without blocking a suggestion (closing brackets, quotes, separators). */
const CLOSING_CHARACTERS_ONLY = /^[\s)\]}>'"`;,.:]*$/;

/**
 * Suggest only when the cursor is at the end of the meaningful text on its line.
 * Typing in the middle of existing code rarely benefits from a suggestion.
 */
export function shouldSuggestByRules(linePrefix: string, lineSuffix: string): boolean {
  if (!CLOSING_CHARACTERS_ONLY.test(lineSuffix)) {
    return false;
  }
  // Right after a closing statement on an otherwise complete line: nothing useful to add inline.
  if (/;\s*$/.test(linePrefix) && lineSuffix.trim() === '') {
    return false;
  }
  return true;
}

const NON_REQUEST_PREFIX = /^(todo|fixme|hack|xxx|note|nb|bug|deprecated|eslint|prettier|ts-|@|noqa|type:|pylint|region|endregion|copyright|license|see |http)/i;

const IMPERATIVE_VERB =
  /^(please\s+)?(create|implement|write|add|make|build|return|returns|compute|calculate|generate|define|declare|parse|validate|check|convert|transform|fetch|get|load|read|save|store|write|sort|filter|find|search|count|sum|merge|split|handle|initialize|init|setup|set up|update|delete|remove|insert|send|render|format|print|log|loop|iterate|map|call|test|open|close|connect|download|upload|encode|decode|hash|encrypt|decrypt|compare|reverse|group|extract|replace|normalize|clamp|debounce|throttle|retry|wait|start|stop|run|execute|apply|register|export|import|throw|raise|ensure|use)\b/i;

const DESCRIBES_CODE = /\b(function|method|class|helper|endpoint|component|hook|test|loop|query|regex|struct|interface|enum|type)\s+(that|to|which|for)\b/i;

/** Looks like disabled code rather than prose, e.g. `// const x = foo();`. */
const LOOKS_LIKE_CODE = /[;{}]\s*$|^\w+(\.\w+)*\(.*\)\s*;?$|^(const|let|var|if|for|while|return)\s.*[=(;]/;

/** Does the comment ask for code to be written right below it? */
export function isImplementationRequestByRules(comment: string): boolean {
  const text = stripCommentMarkers(comment);
  if (text.length < 8 || NON_REQUEST_PREFIX.test(text) || LOOKS_LIKE_CODE.test(text)) {
    return false;
  }
  return IMPERATIVE_VERB.test(text) || DESCRIBES_CODE.test(text);
}

export type EditScope = 'line' | 'function';

const LINE_SCOPED_INSTRUCTION = /\b(this line|the line|one-liner|rename (this|the) variable)\b/i;

/** Without a selection, decide how much code an instruction targets. */
export function chooseEditScopeByRules(instruction: string, hasEnclosingFunction: boolean): EditScope {
  if (!hasEnclosingFunction || LINE_SCOPED_INSTRUCTION.test(instruction)) {
    return 'line';
  }
  return 'function';
}

const MENTIONS_OTHER_FILES =
  /\b(other files?|imported|imports|types? from|interface from|same (way|style|pattern) as|consistent with|like in|defined in|from the (module|file)|across|existing (helpers?|utils?|types?))\b/i;

/**
 * Decide whether a file-level edit should see the files imported by the current file.
 * True when the instruction mentions them or refers to code that lives elsewhere.
 */
export function needsRelatedFilesByRules(instruction: string, relatedFileNames: string[], importedSymbols: string[]): boolean {
  if (relatedFileNames.length === 0) {
    return false;
  }
  if (MENTIONS_OTHER_FILES.test(instruction)) {
    return true;
  }
  const words = new Set(instruction.toLowerCase().match(/[\w$]+/g) ?? []);
  const mentionsFile = relatedFileNames.some((name) => words.has(name.toLowerCase()));
  const mentionsSymbol = importedSymbols.some((symbol) => symbol.length > 2 && words.has(symbol.toLowerCase()));
  return mentionsFile || mentionsSymbol;
}
