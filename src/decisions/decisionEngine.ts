import {
  EditScope,
  Intent,
  chooseEditScopeByRules,
  chooseIntentByRules,
  isImplementationRequestByRules,
  shouldSuggestByRules,
} from './rules';

/**
 * The small "decision" questions the orchestrator asks while working.
 * Implemented either by plain rules or by a small local decision model (clef-flash).
 */
export interface DecisionEngine {
  readonly name: string;

  /** Would an inline suggestion at the cursor be useful? `codeAroundCursor` contains a `<CURSOR>` marker. */
  shouldSuggest(input: { linePrefix: string; lineSuffix: string; codeAroundCursor: string }, signal?: AbortSignal): Promise<boolean>;

  /** Does this comment ask for an implementation to be written below it? */
  isImplementationRequest(comment: string, signal?: AbortSignal): Promise<boolean>;

  /** Does the prompt ask to change code ("refactor this") or for an answer ("explain this")? */
  chooseIntent(input: { instruction: string; target: string }, signal?: AbortSignal): Promise<Intent>;

  /** Without a selection: should an inline instruction target the current line or the enclosing function? */
  chooseEditScope(input: { instruction: string; currentLine: string; hasEnclosingFunction: boolean }, signal?: AbortSignal): Promise<EditScope>;
}

export class RulesDecisionEngine implements DecisionEngine {
  readonly name = 'rules';

  async shouldSuggest(input: { linePrefix: string; lineSuffix: string }): Promise<boolean> {
    return shouldSuggestByRules(input.linePrefix, input.lineSuffix);
  }

  async isImplementationRequest(comment: string): Promise<boolean> {
    return isImplementationRequestByRules(comment);
  }

  async chooseIntent(input: { instruction: string }): Promise<Intent> {
    return chooseIntentByRules(input.instruction);
  }

  async chooseEditScope(input: { instruction: string; hasEnclosingFunction: boolean }): Promise<EditScope> {
    return chooseEditScopeByRules(input.instruction, input.hasEnclosingFunction);
  }
}
