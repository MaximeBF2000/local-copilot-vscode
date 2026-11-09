import {
  EditScope,
  chooseEditScopeByRules,
  isImplementationRequestByRules,
  needsRelatedFilesByRules,
  shouldSuggestByRules,
} from './rules';

/**
 * The small "decision" questions the orchestrator asks while working.
 * Implemented either by plain rules or by a small local decision model.
 */
export interface DecisionEngine {
  readonly name: string;

  /** Would an inline suggestion at the cursor be useful? `codeAroundCursor` contains a `<CURSOR>` marker. */
  shouldSuggest(input: { linePrefix: string; lineSuffix: string; codeAroundCursor: string }, signal?: AbortSignal): Promise<boolean>;

  /** Does this comment ask for an implementation to be written below it? */
  isImplementationRequest(comment: string, signal?: AbortSignal): Promise<boolean>;

  /** Without a selection: should a Cmd+J instruction target the current line or the enclosing function? */
  chooseEditScope(input: { instruction: string; currentLine: string; hasEnclosingFunction: boolean }, signal?: AbortSignal): Promise<EditScope>;

  /** Should a file-level edit also read the files imported by this file? */
  needsRelatedFiles(
    input: { instruction: string; relatedFileNames: string[]; importedSymbols: string[] },
    signal?: AbortSignal,
  ): Promise<boolean>;
}

export class RulesDecisionEngine implements DecisionEngine {
  readonly name = 'rules';

  async shouldSuggest(input: { linePrefix: string; lineSuffix: string }): Promise<boolean> {
    return shouldSuggestByRules(input.linePrefix, input.lineSuffix);
  }

  async isImplementationRequest(comment: string): Promise<boolean> {
    return isImplementationRequestByRules(comment);
  }

  async chooseEditScope(input: { instruction: string; hasEnclosingFunction: boolean }): Promise<EditScope> {
    return chooseEditScopeByRules(input.instruction, input.hasEnclosingFunction);
  }

  async needsRelatedFiles(input: { instruction: string; relatedFileNames: string[]; importedSymbols: string[] }): Promise<boolean> {
    return needsRelatedFilesByRules(input.instruction, input.relatedFileNames, input.importedSymbols);
  }
}
