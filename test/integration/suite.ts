/**
 * Integration tests running inside a real VS Code extension host (and a real Ollama server).
 * Launched by scripts/runIntegrationTests.sh in a hidden, isolated VS Code instance.
 */
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AutocompleteProvider } from '../../src/completion/inlineCompletionProvider';
import { FileEditController } from '../../src/edit/fileEditController';
import { InlineEditController } from '../../src/edit/inlineEditController';
import { InlineEditSession } from '../../src/edit/inlineEditSession';
import { ProposalDiff } from '../../src/edit/proposalDiff';
import { StatusBar } from '../../src/statusBar';

type Test = [name: string, run: () => Promise<void>];

const neverCancelled: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
};

async function openEditor(content: string, language = 'typescript'): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ content, language });
  return vscode.window.showTextDocument(document);
}

/** Answers the next instruction prompt as if the user typed `answer`. */
function stubInputBox(answer: string): void {
  const original = vscode.window.showInputBox;
  (vscode.window as { showInputBox: unknown }).showInputBox = async () => {
    (vscode.window as { showInputBox: unknown }).showInputBox = original;
    return answer;
  };
}

const tests: Test[] = [
  [
    'extension activates and registers its commands',
    async () => {
      const extension = vscode.extensions.all.find((e) => e.packageJSON.name === 'local-copilot');
      assert.ok(extension, 'extension not found');
      await extension.activate();
      const commands = await vscode.commands.getCommands(true);
      for (const id of ['localCopilot.inlineEdit', 'localCopilot.fileEdit', 'localCopilot.selectModel']) {
        assert.ok(commands.includes(id), `missing command ${id}`);
      }
    },
  ],
  [
    'autocomplete completes a call from Ollama',
    async () => {
      const editor = await openEditor('function findByEmail(users, email) {\n  return users.find(\n}\n');
      const provider = new AutocompleteProvider(new StatusBar());
      const items = await provider.provideInlineCompletionItems(
        editor.document,
        new vscode.Position(1, 20),
        { triggerKind: vscode.InlineCompletionTriggerKind.Automatic, selectedCompletionInfo: undefined } as vscode.InlineCompletionContext,
        neverCancelled,
      );
      assert.ok(items?.length, 'no suggestion');
      const text = String(items![0].insertText);
      assert.match(text, /user.*email/s);
      assert.ok(text.split('\n').length <= 3, `expected a short suggestion, got ${JSON.stringify(text)}`);

      // Same position again: served from the cache, instantly.
      const startedAt = Date.now();
      const cached = await provider.provideInlineCompletionItems(
        editor.document,
        new vscode.Position(1, 20),
        { triggerKind: vscode.InlineCompletionTriggerKind.Automatic, selectedCompletionInfo: undefined } as vscode.InlineCompletionContext,
        neverCancelled,
      );
      assert.equal(String(cached![0].insertText), text);
      assert.ok(Date.now() - startedAt < 30, 'cache hit should be instant');
    },
  ],
  [
    'autocomplete implements a comment on the next line',
    async () => {
      const editor = await openEditor('// Create a function that returns the sum of an array of numbers\n\n');
      const provider = new AutocompleteProvider(new StatusBar());
      const items = await provider.provideInlineCompletionItems(
        editor.document,
        new vscode.Position(1, 0),
        { triggerKind: vscode.InlineCompletionTriggerKind.Automatic, selectedCompletionInfo: undefined } as vscode.InlineCompletionContext,
        neverCancelled,
      );
      const text = String(items?.[0]?.insertText ?? '');
      assert.ok(text.split('\n').length >= 2, `expected multiline code, got ${JSON.stringify(text)}`);
    },
  ],
  [
    'inline edit session: accept keeps the proposal',
    async () => {
      const editor = await openEditor('a\nold1\nold2\nz');
      const session = await InlineEditSession.start(editor, new vscode.Range(1, 0, 2, 4), 'new1\nnew2\nnew3');
      assert.equal(editor.document.getText(), 'a\nold1\nold2\nnew1\nnew2\nnew3\nz');
      await session!.accept();
      assert.equal(editor.document.getText(), 'a\nnew1\nnew2\nnew3\nz');
      await vscode.commands.executeCommand('undo');
      assert.equal(editor.document.getText(), 'a\nold1\nold2\nz', 'one undo should restore the original');
    },
  ],
  [
    'inline edit session: reject restores the original',
    async () => {
      const editor = await openEditor('a\nold\nz');
      const session = await InlineEditSession.start(editor, new vscode.Range(1, 0, 1, 3), 'new');
      await session!.reject();
      assert.equal(editor.document.getText(), 'a\nold\nz');
    },
  ],
  [
    'inline edit session: insertion on a blank line',
    async () => {
      const editor = await openEditor('a\n  \nz');
      const session = await InlineEditSession.start(editor, new vscode.Range(1, 0, 1, 0), '  x();\n  y();');
      assert.equal(editor.document.getText(), 'a\n  x();\n  y();\nz');
      await session!.reject();
      assert.equal(editor.document.getText(), 'a\n  \nz');
    },
  ],
  [
    'inline edit session: follows edits made above the proposal',
    async () => {
      const editor = await openEditor('a\nold\nz');
      const session = await InlineEditSession.start(editor, new vscode.Range(1, 0, 1, 3), 'new');
      const listener = vscode.workspace.onDidChangeTextDocument((event) => session!.handleDocumentChange(event));
      await editor.edit((edit) => edit.insert(new vscode.Position(0, 0), 'top\n'));
      await session!.accept();
      listener.dispose();
      assert.equal(editor.document.getText(), 'top\na\nnew\nz');
    },
  ],
  [
    'Cmd+K end to end: rewrites the selection, accept keeps it',
    async () => {
      const editor = await openEditor('function add(a, b) {\n  return a + b;\n}\n', 'javascript');
      editor.selection = new vscode.Selection(0, 0, 2, 1);
      const controller = new InlineEditController(new StatusBar());
      stubInputBox('rename the function to sum and add a JSDoc comment');
      await controller.run();
      const proposed = editor.document.getText();
      assert.match(proposed, /function add\(a, b\)/, 'original stays visible while pending');
      assert.match(proposed, /function sum\(a, b\)/, `no proposal in: ${proposed}`);
      await controller.accept();
      const accepted = editor.document.getText();
      assert.doesNotMatch(accepted, /function add/);
      assert.match(accepted, /\/\*\*[\s\S]*function sum/);
      controller.dispose();
    },
  ],
  [
    'Cmd+Shift+K end to end: proposes a diff and applies it',
    async () => {
      const source = "const fs = require('fs');\n\nfunction read(path, cb) {\n  fs.readFile(path, 'utf8', cb);\n}\n\nmodule.exports = { read };\n";
      const editor = await openEditor(source, 'javascript');
      const controller = new FileEditController(new StatusBar());
      stubInputBox('convert to async/await using fs/promises (read returns a promise of the text)');
      void controller.run();
      // Wait for the diff editor to open with the proposal.
      for (let i = 0; i < 120 && !vscode.window.tabGroups.all.some((g) => g.tabs.some((t) => t.input instanceof vscode.TabInputTextDiff)); i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await controller.accept();
      const text = editor.document.getText();
      assert.match(text, /async function read|read = async/, `not refactored: ${text}`);
      assert.match(text, /await/);
      controller.dispose();
    },
  ],
  [
    'file edit proposal: accept applies the new content',
    async () => {
      const editor = await openEditor('const a = 1;\n');
      const diff = new ProposalDiff();
      void diff.show(editor.document, editor.document.version, 'const a = 2;\n', 'change a');
      await new Promise((resolve) => setTimeout(resolve, 500));
      await diff.accept();
      assert.equal(editor.document.getText(), 'const a = 2;\n');
      diff.dispose();
    },
  ],
];

/** Reverts and closes every open editor, so no "save changes?" dialog blocks the run. */
async function closeAllEditorsWithoutSaving(): Promise<void> {
  for (let i = 0; i < 20 && vscode.window.tabGroups.all.some((group) => group.tabs.length > 0); i++) {
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  }
}

export async function run(): Promise<void> {
  const resultsPath = path.join(__dirname, 'results.txt');
  const lines: string[] = [];
  let failures = 0;
  for (const [name, test] of tests) {
    const startedAt = Date.now();
    try {
      await test();
      lines.push(`✔ ${name} (${Date.now() - startedAt}ms)`);
    } catch (error) {
      failures++;
      lines.push(`✖ ${name}: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
    await closeAllEditorsWithoutSaving();
  }
  lines.push(failures ? `FAILED ${failures}/${tests.length}` : `PASSED ${tests.length}/${tests.length}`);
  fs.writeFileSync(resultsPath, lines.join('\n') + '\n');
  if (failures) {
    throw new Error(`${failures} integration test(s) failed`);
  }
}
