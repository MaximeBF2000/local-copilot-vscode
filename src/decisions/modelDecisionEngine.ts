import { OllamaClient } from '../ollama/ollamaClient';
import { DecisionEngine, RulesDecisionEngine } from './decisionEngine';
import { Decision, editScopeDecision, intentDecision } from './decisionQuestions';
import { EditScope, Intent } from './rules';

export interface ModelDecisionOptions {
  model: string;
  keepAlive: string;
  timeoutMs: number;
  onError: (message: string, error: unknown) => void;
  onDecision?: (name: string, choice: string, probability: number, durationMs: number) => void;
}

/**
 * Asks a local decision model (clef-flash by default) through Ollama's decision API for the prompt
 * decisions: answer vs edit, and edit scope. Any error or timeout falls back to the rules.
 *
 * Autocomplete decisions stay on the rules: they run on every typing pause and must cost ~0 ms.
 */
export class ModelDecisionEngine implements DecisionEngine {
  readonly name: string;
  private readonly rules = new RulesDecisionEngine();

  constructor(private readonly client: OllamaClient, private readonly options: ModelDecisionOptions) {
    this.name = `model (${options.model})`;
  }

  shouldSuggest(input: { linePrefix: string; lineSuffix: string }): Promise<boolean> {
    return this.rules.shouldSuggest(input);
  }

  isImplementationRequest(comment: string): Promise<boolean> {
    return this.rules.isImplementationRequest(comment);
  }

  async chooseIntent(input: { instruction: string; target: string }, signal?: AbortSignal): Promise<Intent> {
    return (await this.ask(intentDecision(input.instruction, input.target), signal)) ?? this.rules.chooseIntent(input);
  }

  async chooseEditScope(input: { instruction: string; currentLine: string; hasEnclosingFunction: boolean }, signal?: AbortSignal): Promise<EditScope> {
    if (!input.hasEnclosingFunction) {
      return 'line';
    }
    return (await this.ask(editScopeDecision(input.instruction, input.currentLine), signal)) ?? this.rules.chooseEditScope(input);
  }

  /** Returns the chosen option, or undefined on error/timeout so callers can fall back to rules. */
  async ask<T extends string>(decision: Decision<T>, signal?: AbortSignal): Promise<T | undefined> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const startedAt = Date.now();
    try {
      const answers = await this.client.decide({
        model: this.options.model,
        state: decision.state,
        questions: { [decision.name]: decision.question },
        keepAlive: this.options.keepAlive,
        signal: combinedSignal,
      });
      const answer = answers[decision.name];
      if (!answer || !(answer.choice in decision.question.criteria)) {
        throw new Error(`unexpected answer ${JSON.stringify(answer)}`);
      }
      this.options.onDecision?.(decision.name, answer.choice, answer.probabilities[answer.choice] ?? 0, Date.now() - startedAt);
      return answer.choice as T;
    } catch (error) {
      if (!signal?.aborted) {
        this.options.onError(`Decision "${decision.name}" fell back to rules`, error);
      }
      return undefined;
    }
  }
}
