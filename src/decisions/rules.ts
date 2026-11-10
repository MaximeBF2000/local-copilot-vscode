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

export type Intent = 'edit' | 'chat';

/** Polite openings that don't tell us anything: "please", "can you", "could you"… */
const POLITE_PREFIX = /^(please|pls|hey|ok|okay|so|now|then|also|and|can you|could you|would you|will you|i want you to|i'd like you to|i would like you to|let's|lets|try to|go ahead and)\b[\s,]*/i;

const EDIT_VERB =
  /^(add|apply|change|clean|convert|create|delete|document|extract|fix|format|generate|handle|implement|improve|inline|insert|make|migrate|move|optimi[sz]e|port|refactor|remove|rename|reorder|replace|restructure|rewrite|simplify|sort|split|swap|translate|turn|update|upgrade|use|wrap|write|annotate|type|memoi[sz]e|parallelize|cache|validate|log|comment|uncomment|enable|disable|support|switch|reduce|increase|decrease|limit|merge|combine|modernize|harden|guard)\b/i;

const QUESTION_START =
  /^(explain|what|what's|whats|why|how|where|when|who|which|is|are|was|were|does|do|did|can|could|should|would|will|describe|summari[sz]e|tell me|walk me through|help me understand|review|analy[sz]e|compare|list|give me an overview|any idea|is there|are there|i don't understand|i dont understand)\b/i;

/**
 * Should the instruction change code ("refactor this") or get an answer ("explain this")?
 * Imperative edit verbs win, then questions; when unclear we edit, as Cmd+K does.
 */
export function chooseIntentByRules(instruction: string): Intent {
  let text = instruction.trim();
  while (POLITE_PREFIX.test(text)) {
    text = text.replace(POLITE_PREFIX, '');
  }
  if (EDIT_VERB.test(text)) {
    return 'edit';
  }
  if (QUESTION_START.test(text) || text.endsWith('?')) {
    return 'chat';
  }
  return 'edit';
}
