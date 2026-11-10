import * as vscode from 'vscode';
import { FileAssistant } from './assistant/fileAssistant';
import { InlineAssistant } from './assistant/inlineAssistant';
import { AutocompleteProvider } from './completion/inlineCompletionProvider';
import { affectsSettings, getSettings, updateSetting } from './config';
import { logger } from './logger';
import { showMenu } from './menu';
import { pickModel } from './ollama/modelPicker';
import { PromptFactory } from './prompt/promptFactory';
import { getServices, resetServices } from './services';
import { StatusBar } from './statusBar';

/** Returned by activate(); used by the integration tests to reach the live instances. */
export interface LocalCopilotApi {
  prompts: PromptFactory;
  inlineAssistant: InlineAssistant;
  fileAssistant: FileAssistant;
}

export function activate(context: vscode.ExtensionContext): LocalCopilotApi {
  logger.init(context);
  const statusBar = new StatusBar();
  const prompts = new PromptFactory(context.extensionUri);
  const inlineAssistant = new InlineAssistant(prompts, statusBar);
  const fileAssistant = new FileAssistant(prompts, statusBar);
  // No ghost text while the assistant is rewriting the same document.
  const autocomplete = new AutocompleteProvider(
    statusBar,
    (document) => inlineAssistant.isBusyIn(document) || fileAssistant.isBusyIn(document),
  );

  const command = (id: string, handler: (...args: never[]) => unknown) => vscode.commands.registerCommand(id, handler);

  context.subscriptions.push(
    statusBar,
    prompts,
    inlineAssistant,
    fileAssistant,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, autocomplete),

    command('localCopilot.inlineEdit', () => inlineAssistant.run()),
    command('localCopilot.fileEdit', () => fileAssistant.run()),
    command('localCopilot.submitInlinePrompt', (reply: vscode.CommentReply) => prompts.commentPrompts.submit(reply)),
    command('localCopilot.closeInlinePrompt', (thread?: vscode.CommentThread) => prompts.commentPrompts.close(thread)),
    command('localCopilot.selectModel', () => pickModel('model')),
    command('localCopilot.selectEditModel', () => pickModel('editModel')),
    command('localCopilot.selectDecisionModel', () => pickModel('decision.model')),
    command('localCopilot.toggleAutocomplete', () => updateSetting('autocomplete.enabled', !getSettings().autocomplete.enabled)),
    command('localCopilot.showMenu', () => showMenu()),
    command('localCopilot.showLogs', () => logger.show()),
    command('localCopilot.configureShortcuts', () =>
      vscode.commands.executeCommand('workbench.action.openGlobalKeybindings', 'localCopilot.'),
    ),

    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!affectsSettings(event)) return;
      resetServices();
      autocomplete.clearCache();
      statusBar.clearError();
      statusBar.setDecisionModelMissing(false);
      if (event.affectsConfiguration('localCopilot.model') || event.affectsConfiguration('localCopilot.decision')) {
        void warmUpModels(statusBar);
      }
    }),
  );

  logger.info(`Activated with model ${getSettings().model}`);
  void warmUpModels(statusBar);
  return { prompts, inlineAssistant, fileAssistant };
}

export function deactivate(): void {
  // Nothing to clean up: everything is registered in context.subscriptions.
}

/** Loads the models into memory in the background so the first request is fast. */
async function warmUpModels(statusBar: StatusBar): Promise<void> {
  const { settings, ollama } = getServices();
  const usesDecisionModel = settings.decision.engine === 'model';
  const models = usesDecisionModel ? [settings.model, settings.decision.model] : [settings.model];
  for (const model of models) {
    try {
      const startedAt = Date.now();
      if (model === settings.decision.model && usesDecisionModel) {
        // Decision models only answer decision requests, so warm them up with a tiny one.
        await ollama.decide({
          model,
          state: 'warm-up',
          questions: { ready: { type: 'choice', instructions: 'Is this a warm-up?', criteria: { yes: null, no: null } } },
          keepAlive: settings.keepAlive,
        });
      } else {
        await ollama.warmUp(model, settings.keepAlive);
      }
      logger.info(`Model ${model} ready in ${Date.now() - startedAt}ms`);
    } catch (error) {
      logger.error(`Could not load model ${model}`, error);
      if (model === settings.decision.model && usesDecisionModel) {
        statusBar.setDecisionModelMissing(true);
      }
    }
  }
}
