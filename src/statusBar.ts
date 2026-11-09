import * as vscode from 'vscode';
import { getSettings } from './config';

type State = 'idle' | 'busy' | 'error';

/** Status bar item showing the active model and whether the AI is working. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  private busyCount = 0;
  private errorMessage: string | undefined;

  constructor() {
    this.item.command = 'localCopilot.showMenu';
    this.render();
    this.item.show();
  }

  /** Marks the AI as busy until the returned function is called. */
  startWork(): () => void {
    this.busyCount++;
    this.render();
    let finished = false;
    return () => {
      if (!finished) {
        finished = true;
        this.busyCount--;
        this.render();
      }
    };
  }

  showError(message: string): void {
    this.errorMessage = message;
    this.render();
  }

  clearError(): void {
    if (this.errorMessage) {
      this.errorMessage = undefined;
      this.render();
    }
  }

  /** Re-reads settings (model name, enabled state). */
  render(): void {
    const settings = getSettings();
    const state: State = this.errorMessage ? 'error' : this.busyCount > 0 ? 'busy' : 'idle';
    const icon = state === 'busy' ? '$(loading~spin)' : state === 'error' ? '$(warning)' : settings.autocomplete.enabled ? '$(sparkle)' : '$(circle-slash)';
    this.item.text = `${icon} ${shortModelName(settings.model)}`;
    this.item.tooltip = new vscode.MarkdownString(
      [
        '**Local Copilot**',
        `Autocomplete: ${settings.autocomplete.enabled ? 'on' : 'off'}`,
        `Model: \`${settings.model}\``,
        `Edit model: \`${settings.editModel}\``,
        `Decisions: ${settings.decision.engine === 'model' ? `\`${settings.decision.model}\`` : 'rules'}`,
        this.errorMessage ? `\n$(warning) ${this.errorMessage}` : '',
        '\nClick for options',
      ].join('  \n'),
      true,
    );
    this.item.backgroundColor = state === 'error' ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  }

  dispose(): void {
    this.item.dispose();
  }
}

function shortModelName(model: string): string {
  return model.replace(/:latest$/, '');
}
