import * as vscode from 'vscode';
import { PromptFormat } from './completion/fimTemplates';

/** Strongly-typed snapshot of the extension settings. */
export interface Settings {
  ollamaUrl: string;
  model: string;
  editModel: string;
  keepAlive: string;
  autocomplete: {
    enabled: boolean;
    debounceMs: number;
    prefixLines: number;
    suffixLines: number;
    maxTokensSingleLine: number;
    maxTokensMultiline: number;
    maxTokensCommentToCode: number;
    temperature: number;
    promptFormat: PromptFormat | 'auto';
    disabledLanguages: string[];
  };
  decision: {
    engine: 'rules' | 'model';
    model: string;
    timeoutMs: number;
  };
  edit: {
    enableThinking: boolean;
    contextLines: number;
    includeRelatedFiles: boolean;
    maxRelatedFiles: number;
  };
  debugLogging: boolean;
}

const SECTION = 'localCopilot';

/** Reads the current settings. Cheap enough to call on every request. */
export function getSettings(): Settings {
  const config = vscode.workspace.getConfiguration(SECTION);
  const read = <T>(key: string, fallback: T): T => config.get<T>(key, fallback);

  const model = read('model', 'qwen3.6:35b-mlx');
  return {
    ollamaUrl: read('ollamaUrl', 'http://localhost:11434').replace(/\/+$/, ''),
    model,
    editModel: read('editModel', '') || model,
    keepAlive: read('keepAlive', '30m'),
    autocomplete: {
      enabled: read('autocomplete.enabled', true),
      debounceMs: read('autocomplete.debounceMs', 75),
      prefixLines: read('autocomplete.prefixLines', 120),
      suffixLines: read('autocomplete.suffixLines', 40),
      maxTokensSingleLine: read('autocomplete.maxTokensSingleLine', 48),
      maxTokensMultiline: read('autocomplete.maxTokensMultiline', 200),
      maxTokensCommentToCode: read('autocomplete.maxTokensCommentToCode', 600),
      temperature: read('autocomplete.temperature', 0.1),
      promptFormat: read('autocomplete.promptFormat', 'auto'),
      disabledLanguages: read('autocomplete.disabledLanguages', ['plaintext', 'scminput']),
    },
    decision: {
      engine: read('decision.engine', 'rules'),
      model: read('decision.model', 'nimble:latest'),
      timeoutMs: read('decision.timeoutMs', 400),
    },
    edit: {
      enableThinking: read('edit.enableThinking', false),
      contextLines: read('edit.contextLines', 60),
      includeRelatedFiles: read('edit.includeRelatedFiles', true),
      maxRelatedFiles: read('edit.maxRelatedFiles', 4),
    },
    debugLogging: read('debugLogging', false),
  };
}

/** Writes a single setting to the user (global) configuration. */
export async function updateSetting(key: string, value: unknown): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update(key, value, vscode.ConfigurationTarget.Global);
}

/** True when the given settings change affects this extension. */
export function affectsSettings(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(SECTION);
}
