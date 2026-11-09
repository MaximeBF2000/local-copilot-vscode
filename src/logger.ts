import * as vscode from 'vscode';
import { getSettings } from './config';

/** Thin wrapper around the "Local Copilot" output channel. */
class Logger {
  private channel: vscode.OutputChannel | undefined;

  init(context: vscode.ExtensionContext): void {
    this.channel = vscode.window.createOutputChannel('Local Copilot');
    context.subscriptions.push(this.channel);
  }

  info(message: string): void {
    this.write('info', message);
  }

  error(message: string, error?: unknown): void {
    const details = error instanceof Error ? `: ${error.message}` : error ? `: ${String(error)}` : '';
    this.write('error', message + details);
  }

  /** Only written when `localCopilot.debugLogging` is enabled. */
  debug(message: string): void {
    if (getSettings().debugLogging) {
      this.write('debug', message);
    }
  }

  show(): void {
    this.channel?.show(true);
  }

  private write(level: string, message: string): void {
    const time = new Date().toISOString().slice(11, 23);
    this.channel?.appendLine(`[${time}] [${level}] ${message}`);
  }
}

export const logger = new Logger();
