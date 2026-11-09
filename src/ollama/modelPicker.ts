import * as vscode from 'vscode';
import { updateSetting } from '../config';
import { getServices } from '../services';

export type ModelRole = 'model' | 'editModel' | 'decision.model';

const ROLE_LABELS: Record<ModelRole, string> = {
  model: 'autocomplete (and edits by default)',
  editModel: 'Cmd+J edits',
  'decision.model': 'decisions',
};

/** Lets the user pick any installed Ollama model for a role and saves it to the settings. */
export async function pickModel(role: ModelRole): Promise<void> {
  const { ollama, settings } = getServices();
  const currentByRole: Record<ModelRole, string> = {
    model: settings.model,
    editModel: settings.editModel,
    'decision.model': settings.decision.model,
  };

  let models;
  try {
    models = await ollama.listModels();
  } catch (error) {
    void vscode.window.showErrorMessage(`Local Copilot: cannot list Ollama models (${(error as Error).message})`);
    return;
  }
  if (models.length === 0) {
    void vscode.window.showWarningMessage('Local Copilot: no Ollama models installed. Run `ollama pull <model>` first.');
    return;
  }

  const preferredCapability = role === 'decision.model' ? 'decision' : 'completion';
  const sorted = [...models].sort(
    (a, b) => Number(b.capabilities.includes(preferredCapability)) - Number(a.capabilities.includes(preferredCapability)),
  );

  const items: (vscode.QuickPickItem & { modelName: string })[] = sorted.map((model) => ({
    label: model.name === currentByRole[role] ? `$(check) ${model.name}` : model.name,
    description: [model.parameterSize, model.capabilities.join(', ')].filter(Boolean).join(' · '),
    modelName: model.name,
  }));
  if (role === 'editModel') {
    items.unshift({ label: 'Same as autocomplete model', description: settings.model, modelName: '' });
  }

  const choice = await vscode.window.showQuickPick(items, {
    title: `Local Copilot — model for ${ROLE_LABELS[role]}`,
    placeHolder: `Current: ${currentByRole[role]}`,
    matchOnDescription: true,
  });
  if (choice) {
    await updateSetting(role, choice.modelName);
  }
}
