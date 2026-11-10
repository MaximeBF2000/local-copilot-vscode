/**
 * Integration tests running inside a real VS Code extension host (and a real Ollama server).
 * Launched by scripts/runIntegrationTests.sh in a hidden, isolated VS Code instance.
 */
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AutocompleteProvider } from '../../src/completion/inlineCompletionProvider';
import { replaceDocument, replaceRange } from '../../src/edit/applyChanges';
import { collectDefinitions } from '../../src/context/definitions';
import { LocalCopilotApi } from '../../src/extension';
import { CommentPromptService } from '../../src/prompt/commentPrompt';
import { PromptView } from '../../src/prompt/promptView';
import { StatusBar } from '../../src/statusBar';

type Test = [name: string, run: () => Promise<void>];

const neverCancelled: vscode.CancellationToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
};
const automatic = { triggerKind: vscode.InlineCompletionTriggerKind.Automatic, selectedCompletionInfo: undefined } as vscode.InlineCompletionContext;
const extensionUri = vscode.Uri.file(path.resolve(__dirname, '../../..'));

async function openEditor(content: string, language = 'typescript'): Promise<vscode.TextEditor> {
  const document = await vscode.workspace.openTextDocument({ content, language });
  return vscode.window.showTextDocument(document);
}

async function waitFor(condition: () => boolean, timeoutMs = 60000): Promise<void> {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function commentTexts(thread: vscode.CommentThread): string[] {
  return thread.comments.map((c) => (typeof c.body === 'string' ? c.body : c.body.value));
}

/** The live extension instances (what the real commands use). */
async function extensionApi(): Promise<LocalCopilotApi> {
  const extension = vscode.extensions.all.find((e) => e.packageJSON.name === 'local-copilot')!;
  return (await extension.activate()) as LocalCopilotApi;
}

/** The prompt the last command opened. */
async function activePrompt(): Promise<PromptView> {
  const { prompts } = await extensionApi();
  await waitFor(() => prompts.active !== undefined, 5000);
  return prompts.active!;
}

/**
 * Runs `change` and asserts it modified the document in exactly one edit, i.e. one Cmd+Z step.
 * (The hidden test window has no keyboard focus, so the real `undo` command can't be exercised here.)
 */
async function expectSingleEdit(document: vscode.TextDocument, change: () => Promise<unknown>): Promise<void> {
  let edits = 0;
  const listener = vscode.workspace.onDidChangeTextDocument((event) => {
    if (event.document === document && event.contentChanges.length > 0) edits++;
  });
  try {
    await change();
  } finally {
    listener.dispose();
  }
  assert.equal(edits, 1, `expected one undoable edit, got ${edits}`);
}


const tests: Test[] = [
  [
    'extension activates and registers its commands',
    async () => {
      const extension = vscode.extensions.all.find((e) => e.packageJSON.name === 'local-copilot');
      assert.ok(extension, 'extension not found');
      await extension.activate();
      const commands = await vscode.commands.getCommands(true);
      for (const id of ['localCopilot.inlineEdit', 'localCopilot.fileEdit', 'localCopilot.submitInlinePrompt', 'localCopilot.configureShortcuts']) {
        assert.ok(commands.includes(id), `missing command ${id}`);
      }
    },
  ],
  [
    'autocomplete completes a call from Ollama',
    async () => {
      const editor = await openEditor('function findByEmail(users, email) {\n  return users.find(\n}\n');
      const provider = new AutocompleteProvider(new StatusBar());
      const items = await provider.provideInlineCompletionItems(editor.document, new vscode.Position(1, 20), automatic, neverCancelled);
      assert.ok(items?.length, 'no suggestion');
      assert.match(String(items![0].insertText), /user.*email/s);
    },
  ],
  [
    'autocomplete implements a comment on the next line',
    async () => {
      const editor = await openEditor('// Create a function that returns the sum of an array of numbers\n\n');
      const provider = new AutocompleteProvider(new StatusBar());
      const items = await provider.provideInlineCompletionItems(editor.document, new vscode.Position(1, 0), automatic, neverCancelled);
      const text = String(items?.[0]?.insertText ?? '');
      assert.ok(text.split('\n').length >= 2, `expected multiline code, got ${JSON.stringify(text)}`);
    },
  ],
  [
    'changes are applied directly, as a single undoable edit',
    async () => {
      const editor = await openEditor('a\nold1\nold2\nz');
      await expectSingleEdit(editor.document, () => replaceRange(editor.document, new vscode.Range(1, 0, 2, 4), 'new1\nnew2\nnew3'));
      assert.equal(editor.document.getText(), 'a\nnew1\nnew2\nnew3\nz');
    },
  ],
  [
    'file changes only touch the changed lines',
    async () => {
      const editor = await openEditor('one\ntwo\nthree\nfour\n');
      let changed = 0;
      await expectSingleEdit(editor.document, async () => (changed = await replaceDocument(editor.document, 'one\nTWO\nthree\nfour\nfive\n')));
      assert.equal(editor.document.getText(), 'one\nTWO\nthree\nfour\nfive\n');
      assert.equal(changed, 4);
    },
  ],
  [
    'the compact embedded prompt is used when VS Code allows it',
    async () => {
      await openEditor('const a = 1;\n');
      const { prompts } = await extensionApi();
      await vscode.commands.executeCommand('localCopilot.inlineEdit');
      const prompt = await activePrompt();
      assert.ok(prompts.usesCompactPrompt, 'expected the editorInsets prompt');
      assert.equal(prompt.constructor.name, 'InsetPrompt');
      prompt.close();
      assert.equal(prompts.active, undefined);
    },
  ],
  [
    'fallback comment prompt: opens below a line and forwards the submitted text',
    async () => {
      const editor = await openEditor('a\nb\nc');
      const service = new CommentPromptService(extensionUri);
      const prompt = service.open(editor, { anchorLine: 1, centered: false, placeholder: '' });
      let received = '';
      prompt.onSubmit((text) => (received = text));
      assert.equal(prompt.thread.range?.start.line, 1);
      service.submit({ thread: prompt.thread, text: '  explain this  ' });
      assert.equal(received, 'explain this');
      prompt.addUserMessage('explain this');
      await prompt.showAnswer('It **does** things.', true);
      assert.deepEqual(commentTexts(prompt.thread), ['explain this', 'It **does** things.']);
      service.close();
      assert.ok(prompt.isClosed);
      service.dispose();
    },
  ],
  [
    'definitions used by the code are resolved across files by the language server',
    async () => {
      const [cartUri] = await vscode.workspace.findFiles('src/cart.ts');
      const document = await vscode.workspace.openTextDocument(cartUri);
      await vscode.window.showTextDocument(document);
      const fn = new vscode.Range(2, 0, 5, 1);
      let snippets: Awaited<ReturnType<typeof collectDefinitions>> = [];
      // The TypeScript server needs a moment to start.
      for (let attempt = 0; attempt < 30 && !snippets.some((s) => s.path.endsWith('pricing.ts')); attempt++) {
        snippets = await collectDefinitions(document, fn, 12000);
        if (!snippets.some((s) => s.path.endsWith('pricing.ts'))) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const fromPricing = snippets.filter((s) => s.path.endsWith('pricing.ts'));
      assert.ok(fromPricing.some((s) => /function formatPrice/.test(s.code)), JSON.stringify(snippets));
      assert.ok(fromPricing.some((s) => /interface Price/.test(s.code)), JSON.stringify(snippets));
    },
  ],
  [
    'Cmd+J end to end: an edit request rewrites the selection directly',
    async () => {
      const editor = await openEditor('function add(a, b) {\n  return a + b;\n}\n', 'javascript');
      editor.selection = new vscode.Selection(0, 0, 2, 1);
      await vscode.commands.executeCommand('localCopilot.inlineEdit');
      const prompt = await activePrompt();
      await expectSingleEdit(editor.document, async () => {
        prompt.submit('rename the function to sum and add a JSDoc comment');
        await waitFor(() => /function sum/.test(editor.document.getText()));
      });
      const text = editor.document.getText();
      assert.doesNotMatch(text, /function add/);
      assert.match(text, /\/\*\*[\s\S]*function sum/);
      assert.ok(prompt.isClosed, 'the prompt closes after an edit');
    },
  ],
  [
    'Cmd+J end to end: a question is answered in the widget, code untouched',
    async () => {
      const source = 'function add(a, b) {\n  return a + b;\n}\n';
      const editor = await openEditor(source, 'javascript');
      editor.selection = new vscode.Selection(0, 0, 2, 1);
      await vscode.commands.executeCommand('localCopilot.inlineEdit');
      const prompt = await activePrompt();
      prompt.submit('explain this function');
      await waitFor(() => prompt.conversation.some((m) => m.role === 'assistant'));
      const answer = prompt.conversation[1].content;
      assert.match(answer, /add|sum/i, `unexpected answer: ${answer}`);
      assert.equal(editor.document.getText(), source);
      assert.ok(!prompt.isClosed, 'the prompt stays open to show the answer');
      prompt.close();
    },
  ],
  [
    'Cmd+Shift+J end to end: an edit request changes the file directly',
    async () => {
      const source = "const fs = require('fs');\n\nfunction read(path, cb) {\n  fs.readFile(path, 'utf8', cb);\n}\n\nmodule.exports = { read };\n";
      const editor = await openEditor(source, 'javascript');
      await vscode.commands.executeCommand('localCopilot.fileEdit');
      const prompt = await activePrompt();
      prompt.submit('convert to async/await using fs/promises (read returns a promise of the text)');
      await waitFor(() => /await/.test(editor.document.getText()));
      assert.match(editor.document.getText(), /async function read|read = async/);
    },
  ],
  [
    'Cmd+Shift+J end to end: a question is answered in the prompt, file untouched',
    async () => {
      const source = 'export const add = (a: number, b: number) => a + b;\n';
      const editor = await openEditor(source);
      await vscode.commands.executeCommand('localCopilot.fileEdit');
      const prompt = await activePrompt();
      prompt.submit('what does this file do?');
      await waitFor(() => prompt.conversation.some((m) => m.role === 'assistant'));
      assert.equal(editor.document.getText(), source);
      prompt.close();
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
