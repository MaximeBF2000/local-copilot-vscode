import * as vscode from 'vscode';
import { getSettings, updateSetting } from './config';

/** Quick menu opened from the status bar item. */
export async function showMenu(): Promise<void> {
  const settings = getSettings();
  const usesDecisionModel = settings.decision.engine === 'model';

  const actions: (vscode.QuickPickItem & { run: () => Thenable<unknown> })[] = [
    {
      label: settings.autocomplete.enabled ? '$(circle-slash) Disable autocomplete' : '$(sparkle) Enable autocomplete',
      run: () => vscode.commands.executeCommand('localCopilot.toggleAutocomplete'),
    },
    {
      label: '$(server-process) Select model',
      description: settings.model,
      run: () => vscode.commands.executeCommand('localCopilot.selectModel'),
    },
    {
      label: '$(edit) Select edit model',
      description: settings.editModel,
      run: () => vscode.commands.executeCommand('localCopilot.selectEditModel'),
    },
    {
      label: usesDecisionModel ? '$(symbol-ruler) Use rules for decisions' : '$(lightbulb) Use a decision model',
      description: usesDecisionModel ? `currently ${settings.decision.model}` : 'currently rules',
      run: () => updateSetting('decision.engine', usesDecisionModel ? 'rules' : 'model'),
    },
    {
      label: '$(lightbulb) Select decision model',
      description: settings.decision.model,
      run: () => vscode.commands.executeCommand('localCopilot.selectDecisionModel'),
    },
    {
      label: '$(keyboard) Change keyboard shortcuts',
      description: 'Edit Selection / Edit File',
      run: () => vscode.commands.executeCommand('localCopilot.configureShortcuts'),
    },
    {
      label: '$(output) Show logs',
      run: () => vscode.commands.executeCommand('localCopilot.showLogs'),
    },
    {
      label: '$(gear) Open settings',
      run: () => vscode.commands.executeCommand('workbench.action.openSettings', 'localCopilot'),
    },
  ];

  const choice = await vscode.window.showQuickPick(actions, { title: 'Local Copilot' });
  await choice?.run();
}
