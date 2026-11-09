import { Settings, getSettings } from './config';
import { DecisionEngine, RulesDecisionEngine } from './decisions/decisionEngine';
import { ModelDecisionEngine } from './decisions/modelDecisionEngine';
import { logger } from './logger';
import { OllamaClient } from './ollama/ollamaClient';

/** Objects shared by all features, rebuilt whenever the settings change. */
export interface Services {
  settings: Settings;
  ollama: OllamaClient;
  decisions: DecisionEngine;
}

let current: Services | undefined;

export function getServices(): Services {
  current ??= createServices(getSettings());
  return current;
}

/** Call when settings change so the next request uses the new configuration. */
export function resetServices(): void {
  current = undefined;
}

function createServices(settings: Settings): Services {
  const ollama = new OllamaClient(settings.ollamaUrl);
  const decisions =
    settings.decision.engine === 'model'
      ? new ModelDecisionEngine(ollama, {
          model: settings.decision.model,
          keepAlive: settings.keepAlive,
          timeoutMs: settings.decision.timeoutMs,
          onError: (message, error) => logger.debug(`${message}: ${error instanceof Error ? error.message : String(error)}`),
        })
      : new RulesDecisionEngine();
  return { settings, ollama, decisions };
}
