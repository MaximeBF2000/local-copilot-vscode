/**
 * End-to-end benchmark against a running Ollama server, using the same modules as the extension.
 * Usage: npm run benchmark -- [completionModel] [decisionModel]
 */
import { buildCompletionContext } from '../src/completion/completionContext';
import { CompletionMode, chooseCompletionMode, commentAboveCursor } from '../src/completion/completionMode';
import { generateCompletion } from '../src/completion/completionGenerator';
import { resolvePromptFormat } from '../src/completion/fimTemplates';
import { ModelDecisionEngine } from '../src/decisions/modelDecisionEngine';
import { RulesDecisionEngine } from '../src/decisions/decisionEngine';
import { applyEditBlocks, parseEditBlocks } from '../src/edit/editBlocks';
import { buildFileEditMessages, buildInlineEditMessages } from '../src/edit/editPrompts';
import { extractCode } from '../src/edit/codeExtraction';
import { OllamaClient } from '../src/ollama/ollamaClient';

const MODEL = process.argv[2] ?? 'qwen3.6:35b-mlx';
const DECISION_MODEL = process.argv[3] ?? 'nimble:latest';
const ollama = new OllamaClient('http://localhost:11434');

interface Scenario {
  name: string;
  file: string;
  /** Source code with a `█` marking the cursor. */
  code: string;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'finish a call',
    file: 'src/users.ts',
    code: `export interface User { id: number; name: string; email: string }\n\nexport function findByEmail(users: User[], email: string) {\n  return users.find(█\n}\n`,
  },
  {
    name: 'next statement',
    file: 'app.py',
    code: `import json\n\ndef load_config(path):\n    with open(path) as f:\n        █\n\nconfig = load_config("config.json")\n`,
  },
  {
    name: 'function body',
    file: 'src/math.ts',
    code: `export function clamp(value: number, min: number, max: number): number {█\n}\n`,
  },
  {
    name: 'comment to code (ts)',
    file: 'src/validation.ts',
    code: `// Create a function that validates an email address\n█\n\nexport const MAX_LENGTH = 255;\n`,
  },
  {
    name: 'comment to code (py)',
    file: 'stats.py',
    code: `import math\n\n# compute the standard deviation of a list of numbers\n█\n`,
  },
  {
    name: 'object literal',
    file: 'src/config.js',
    code: `const defaults = {\n  host: 'localhost',\n  port: 8080,\n  █\n};\n`,
  },
];

async function benchmarkAutocomplete(): Promise<void> {
  console.log(`\n## Autocomplete (${MODEL})\n`);
  const rules = new RulesDecisionEngine();
  const format = resolvePromptFormat('auto', MODEL);
  for (const scenario of SCENARIOS) {
    const [before, after] = scenario.code.split('█');
    const lines = (before + after).split('\n');
    const cursorLine = before.split('\n').length - 1;
    const cursorCharacter = before.split('\n').pop()!.length;
    const context = buildCompletionContext(
      { lines, cursorLine, cursorCharacter, languageId: 'code', filePath: scenario.file, projectName: 'bench' },
      { prefixLines: 120, suffixLines: 40 },
    );
    const comment = commentAboveCursor(context.prefix, context.linePrefix);
    const isRequest = comment ? await rules.isImplementationRequest(comment) : false;
    const mode: CompletionMode = chooseCompletionMode(context.linePrefix, context.lineSuffix, isRequest);
    const maxTokens = mode === 'singleLine' ? 48 : mode === 'multiline' ? 200 : 600;

    const timings: number[] = [];
    let text = '';
    for (let run = 0; run < 3; run++) {
      const startedAt = Date.now();
      const result = await generateCompletion(ollama, { model: MODEL, format, context, mode, maxTokens, temperature: 0.1, keepAlive: '30m' });
      timings.push(Date.now() - startedAt);
      text = result.text;
    }
    timings.sort((a, b) => a - b);
    console.log(`### ${scenario.name} — ${mode}, median ${timings[1]}ms (min ${timings[0]}ms)`);
    console.log('```\n' + text + '\n```');
  }
}

const COMMENTS: [string, boolean][] = [
  ['// Create a function that validates an email', true],
  ['# compute the average of the list and return it', true],
  ['// helper to debounce a callback', true],
  ['/* Sort users by last name, then first name */', true],
  ['// Returns true when the cache entry is expired', true],
  ['// fetch the user profile and cache it for 5 minutes', true],
  ['# a dictionary mapping country codes to names', true],
  ['// TODO: refactor later', false],
  ['// This is a hack because the API is slow', false],
  ['// const result = compute(input);', false],
  ['// eslint-disable-next-line no-console', false],
  ['# The values below come from the 2019 survey', false],
  ['// Note: the order of these calls matters', false],
  ['// Copyright 2024 Acme Inc.', false],
];

async function benchmarkDecisions(): Promise<void> {
  console.log(`\n## Comment intent decisions: rules vs ${DECISION_MODEL}\n`);
  const rules = new RulesDecisionEngine();
  const model = new ModelDecisionEngine(ollama, {
    model: DECISION_MODEL,
    keepAlive: '30m',
    timeoutMs: 5000,
    onError: (message, error) => console.log(`  ! ${message}: ${String(error)}`),
  });
  await model.isImplementationRequest('// warm up');

  let rulesCorrect = 0;
  let modelCorrect = 0;
  const modelTimings: number[] = [];
  for (const [comment, expected] of COMMENTS) {
    const byRules = await rules.isImplementationRequest(comment);
    const startedAt = Date.now();
    const byModel = await model.isImplementationRequest(comment);
    modelTimings.push(Date.now() - startedAt);
    rulesCorrect += Number(byRules === expected);
    modelCorrect += Number(byModel === expected);
    const mark = (v: boolean) => (v === expected ? '✓' : '✗');
    console.log(`- ${mark(byRules)} rules  ${mark(byModel)} model  ${comment}`);
  }
  modelTimings.sort((a, b) => a - b);
  console.log(`\nRules: ${rulesCorrect}/${COMMENTS.length} (≈0ms) · Model: ${modelCorrect}/${COMMENTS.length} (median ${modelTimings[Math.floor(modelTimings.length / 2)]}ms)`);
}

/** Does running the decision model at the same time slow down the completion model? */
async function benchmarkContention(): Promise<void> {
  console.log('\n## GPU contention (completion alone vs with a parallel decision)\n');
  const prompt = `<|fim_prefix|>function fibonacci(n: number): number {\n<|fim_suffix|>\n}\n<|fim_middle|>`;
  const run = () => ollama.generateRaw({ model: MODEL, prompt, options: { temperature: 0, num_predict: 60 }, keepAlive: '30m' });
  const decision = () =>
    ollama.nextTokenProbabilities(DECISION_MODEL, [{ role: 'user', content: 'Answer A or B. Is the sky blue? A: yes B: no' }], '30m');

  const alone: number[] = [];
  const parallel: number[] = [];
  for (let i = 0; i < 4; i++) {
    alone.push((await run()).durationMs);
    const [result] = await Promise.all([run(), decision()]);
    parallel.push(result.durationMs);
  }
  const median = (values: number[]) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
  console.log(`Completion alone: median ${median(alone)}ms · with parallel decision: median ${median(parallel)}ms`);
}

const EDIT_FILE = `import { readFile } from 'fs';

export function loadJson(path, callback) {
  readFile(path, 'utf8', (error, text) => {
    if (error) {
      callback(error);
      return;
    }
    callback(null, JSON.parse(text));
  });
}

export function loadAll(paths, callback) {
  const results = [];
  let remaining = paths.length;
  paths.forEach((path, index) => {
    loadJson(path, (error, data) => {
      if (error) return callback(error);
      results[index] = data;
      if (--remaining === 0) callback(null, results);
    });
  });
}
`;

async function benchmarkEdits(): Promise<void> {
  console.log(`\n## Edits (${MODEL})\n`);

  const inline = await ollama.chat({
    model: MODEL,
    messages: buildInlineEditMessages({
      instruction: 'add a guard that throws a TypeError when path is not a string',
      filePath: 'src/load.js',
      languageId: 'javascript',
      codeBefore: "import { readFile } from 'fs';\n\n",
      targetCode: EDIT_FILE.split('\n').slice(2, 11).join('\n'),
      codeAfter: '',
    }),
    options: { temperature: 0.2 },
  });
  console.log(`### Inline edit — ${inline.durationMs}ms, ${inline.tokenCount} tokens`);
  console.log('```js\n' + extractCode(inline.text) + '\n```');

  const file = await ollama.chat({
    model: MODEL,
    messages: buildFileEditMessages({
      instruction: 'Refactor this file to use async/await with fs/promises instead of callbacks',
      filePath: 'src/load.js',
      languageId: 'javascript',
      fileContent: EDIT_FILE,
      relatedFiles: [],
    }),
    options: { temperature: 0.2, num_ctx: 32768 },
  });
  const blocks = parseEditBlocks(file.text);
  const applied = applyEditBlocks(EDIT_FILE, blocks);
  console.log(`### File edit — ${file.durationMs}ms, ${file.tokenCount} tokens, ${blocks.length} blocks, applied: ${applied.ok}`);
  console.log('```js\n' + (applied.ok ? applied.text : file.text) + '\n```');
}

async function main(): Promise<void> {
  const sections = process.env.BENCH_SECTIONS?.split(',') ?? ['autocomplete', 'decisions', 'contention', 'edits'];
  await ollama.warmUp(MODEL, '30m');
  if (sections.includes('autocomplete')) await benchmarkAutocomplete();
  if (sections.includes('decisions')) await benchmarkDecisions();
  if (sections.includes('contention')) await benchmarkContention();
  if (sections.includes('edits')) await benchmarkEdits();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
