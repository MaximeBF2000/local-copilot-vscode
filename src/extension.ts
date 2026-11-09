import * as vscode from 'vscode';
import { affectsSettings, getSettings, updateSetting } from './config';
import { AutocompleteProvider } from './completion/inlineCompletionProvider';
import { FileEditController } from './edit/fileEditController';
import { InlineEditController } from './edit/inlineEditController';
import { logger } from './logger';
import { showMenu } from './menu';
import { pickModel } from './ollama/modelPicker';
import { getServices, resetServices } from './services';
import { StatusBar } from './statusBar';

export function activate(context: vscode.ExtensionContext): void {
  logger.init(context);
  const statusBar = new StatusBar();
  const inlineEdit = new InlineEditController(statusBar);
  const autocomplete = new AutocompleteProvider(statusBar, (document) => inlineEdit.isBusyIn(document));
  const fileEdit = new FileEditController(statusBar);

  const command = (id: string, handler: () => unknown) => vscode.commands.registerCommand(id, handler);

  context.subscriptions.push(
    statusBar,
    inlineEdit,
    fileEdit,
    vscode.languages.registerInlineCompletionItemProvider({ pattern: '**' }, autocomplete),

    command('localCopilot.inlineEdit', () => inlineEdit.run()),
    command('localCopilot.acceptInlineEdit', () => inlineEdit.accept()),
    command('localCopilot.rejectInlineEdit', () => inlineEdit.reject()),
    command('localCopilot.cancelGeneration', () => inlineEdit.cancelGeneration()),
    command('localCopilot.fileEdit', () => fileEdit.run()),
    command('localCopilot.acceptFileEdit', () => fileEdit.accept()),
    command('localCopilot.rejectFileEdit', () => fileEdit.reject()),
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
      statusBar.render();
      if (event.affectsConfiguration('localCopilot.model') || event.affectsConfiguration('localCopilot.decision')) {
        void warmUpModels();
      }
    }),
  );

  logger.info(`Activated with model ${getSettings().model}`);
  void warmUpModels();
}

export function deactivate(): void {
  // Nothing to clean up: everything is registered in context.subscriptions.
}

/** Loads the models into memory in the background so the first suggestion is fast. */
async function warmUpModels(): Promise<void> {
  const { settings, ollama } = getServices();
  const models = new Set([settings.model]);
  if (settings.decision.engine === 'model') {
    models.add(settings.decision.model);
  }
  for (const model of models) {
    try {
      const startedAt = Date.now();
      await ollama.warmUp(model, settings.keepAlive);
      logger.info(`Model ${model} ready in ${Date.now() - startedAt}ms`);
    } catch (error) {
      logger.error(`Could not load model ${model}`, error);
    }
  }
}
