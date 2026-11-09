import { OllamaClient } from '../ollama/ollamaClient';
import { DecisionEngine, RulesDecisionEngine } from './decisionEngine';
import { DecisionQuestion, buildDecisionMessages, readChoiceProbabilities } from './decisionPrompt';
import { EditScope } from './rules';

export interface ModelDecisionOptions {
  model: string;
  keepAlive: string;
  timeoutMs: number;
  onError: (message: string, error: unknown) => void;
}

/**
 * Asks a small local decision model. Cheap rules run first and veto obvious cases;
 * the model only refines the remaining ones. Any error or timeout falls back to the rules.
 */
export class ModelDecisionEngine implements DecisionEngine {
  readonly name: string;
  private readonly rules = new RulesDecisionEngine();

  constructor(private readonly client: OllamaClient, private readonly options: ModelDecisionOptions) {
    this.name = `model (${options.model})`;
  }

  async shouldSuggest(input: { linePrefix: string; lineSuffix: string; codeAroundCursor: string }, signal?: AbortSignal): Promise<boolean> {
    if (!(await this.rules.shouldSuggest(input))) {
      return false;
    }
    const answer = await this.ask(
      {
        field: 'suggest',
        question: 'Would an inline code completion inserted at <CURSOR> help the developer right now?',
        choices: [
          { value: true, description: 'yes: the developer is about to write more code at the cursor' },
          { value: false, description: 'no: the code at the cursor is complete or the developer is not writing code there' },
        ],
        context: input.codeAroundCursor,
      },
      signal,
    );
    // Only skip when the model is confident: a missed suggestion costs more than an ignored one.
    return answer ? !(answer.value === false && answer.probability > 0.8) : true;
  }

  async isImplementationRequest(comment: string, signal?: AbortSignal): Promise<boolean> {
    const answer = await this.ask(
      {
        field: 'comment_intent',
        question: 'Does the comment ask for code to be implemented right after it?',
        choices: [
          { value: true, description: 'implement: the comment describes code that should be written next' },
          { value: false, description: 'note: the comment is an explanation, a note, a TODO for later, or commented-out code' },
        ],
        context: comment,
      },
      signal,
    );
    return answer ? answer.value : this.rules.isImplementationRequest(comment);
  }

  async chooseEditScope(input: { instruction: string; currentLine: string; hasEnclosingFunction: boolean }, signal?: AbortSignal): Promise<EditScope> {
    if (!input.hasEnclosingFunction) {
      return 'line';
    }
    const answer = await this.ask<EditScope>(
      {
        field: 'edit_scope',
        question: 'Which code does the edit instruction apply to?',
        choices: [
          { value: 'line', description: 'only the current line of code' },
          { value: 'function', description: 'the whole function or method containing the current line' },
        ],
        context: `Instruction: ${input.instruction}\nCurrent line: ${input.currentLine.trim()}`,
      },
      signal,
    );
    return answer ? answer.value : this.rules.chooseEditScope(input);
  }

  async needsRelatedFiles(
    input: { instruction: string; relatedFileNames: string[]; importedSymbols: string[] },
    signal?: AbortSignal,
  ): Promise<boolean> {
    if (input.relatedFileNames.length === 0) {
      return false;
    }
    const answer = await this.ask(
      {
        field: 'needs_related_files',
        question: 'To follow the instruction, does the developer need to see code defined in the imported files?',
        choices: [
          { value: true, description: 'yes: the instruction depends on types, functions or conventions from the imported files' },
          { value: false, description: 'no: the current file alone is enough' },
        ],
        context:
          `Instruction: ${input.instruction}\nImported files: ${input.relatedFileNames.join(', ')}\n` +
          `Imported symbols: ${input.importedSymbols.slice(0, 40).join(', ')}`,
      },
      signal,
    );
    return answer ? answer.value : this.rules.needsRelatedFiles(input);
  }

  /** Returns the most likely choice, or undefined on error/timeout so callers can fall back to rules. */
  private async ask<T>(question: DecisionQuestion<T>, signal?: AbortSignal): Promise<{ value: T; probability: number } | undefined> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      const tokens = await this.client.nextTokenProbabilities(
        this.options.model,
        buildDecisionMessages(question),
        this.options.keepAlive,
        combinedSignal,
      );
      return readChoiceProbabilities(question, tokens)[0];
    } catch (error) {
      if (!signal?.aborted) {
        this.options.onError(`Decision "${question.field}" fell back to rules`, error);
      }
      return undefined;
    }
  }
}
