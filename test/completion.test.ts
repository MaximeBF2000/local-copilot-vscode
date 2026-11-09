import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CompletionCache } from '../src/completion/completionCache';
import { buildCompletionContext, pathForModel } from '../src/completion/completionContext';
import { chooseCompletionMode, commentAboveCursor } from '../src/completion/completionMode';
import { getFimTemplate, resolvePromptFormat } from '../src/completion/fimTemplates';
import { cleanCompletion, duplicatesSuffix } from '../src/completion/postProcess';

describe('buildCompletionContext', () => {
  const lines = ['import { a } from "./a";', '', 'function f() {', '  return a', '}', 'f();'];

  it('splits text around the cursor', () => {
    const ctx = buildCompletionContext(
      { lines, cursorLine: 3, cursorCharacter: 9, languageId: 'ts', filePath: 'x.ts', projectName: 'p' },
      { prefixLines: 100, suffixLines: 100 },
    );
    assert.equal(ctx.linePrefix, '  return ');
    assert.equal(ctx.lineSuffix, 'a');
    assert.ok(ctx.prefix.endsWith('function f() {\n  return '));
    assert.ok(ctx.suffix.startsWith('a\n}'));
  });

  it('keeps imports when the window cuts off the top of the file', () => {
    const ctx = buildCompletionContext(
      { lines, cursorLine: 3, cursorCharacter: 9, languageId: 'ts', filePath: 'x.ts', projectName: 'p' },
      { prefixLines: 1, suffixLines: 0 },
    );
    assert.equal(ctx.prefix, 'import { a } from "./a";\n\nfunction f() {\n  return ');
    assert.equal(ctx.suffix, 'a');
  });
});

describe('pathForModel', () => {
  it('names unsaved files after their language', () => {
    assert.equal(pathForModel('Untitled-1', true, 'typescript'), 'untitled.ts');
    assert.equal(pathForModel('src/a.py', false, 'python'), 'src/a.py');
  });
});

describe('completion mode', () => {
  it('finishes the current line when typing mid-line', () => {
    assert.equal(chooseCompletionMode('const x = ', '', false), 'singleLine');
  });

  it('writes a block on an empty line or after a block opener', () => {
    assert.equal(chooseCompletionMode('    ', '', false), 'multiline');
    assert.equal(chooseCompletionMode('function f() {', '', false), 'multiline');
    assert.equal(chooseCompletionMode('def f():', '', false), 'multiline');
  });

  it('implements a comment that requests code', () => {
    assert.equal(chooseCompletionMode('', '', true), 'commentToCode');
  });

  it('finds the comment block above an empty cursor line', () => {
    const prefix = 'const a = 1;\n// Create a function\n// that adds two numbers\n';
    assert.equal(commentAboveCursor(prefix, ''), 'Create a function that adds two numbers');
    assert.equal(commentAboveCursor('const a = 1;\n', ''), undefined);
    assert.equal(commentAboveCursor('# compute the mean\n    ', '    '), 'compute the mean');
  });
});

describe('cleanCompletion', () => {
  it('keeps only the first line in single-line mode', () => {
    assert.equal(cleanCompletion('foo);\nbar();', { mode: 'singleLine', linePrefix: 'x(', suffix: '', stopTokens: [] }), 'foo);');
  });

  it('cuts at stop tokens', () => {
    assert.equal(cleanCompletion('abc<|endoftext|>junk', { mode: 'singleLine', linePrefix: 'x', suffix: '', stopTokens: ['<|endoftext|>'] }), 'abc');
  });

  it('stops a block when the model leaves the current scope', () => {
    const raw = '  const y = 1;\n  return y;\n}\n\nfunction next() {}';
    assert.equal(cleanCompletion(raw, { mode: 'multiline', linePrefix: '  ', suffix: '', stopTokens: [] }), '  const y = 1;\n  return y;');
  });

  it('removes trailing lines that already follow the cursor', () => {
    const raw = '\n  return a + b;\n}';
    assert.equal(cleanCompletion(raw, { mode: 'multiline', linePrefix: 'function add(a, b) {', suffix: '\n}\n', stopTokens: [] }), '\n  return a + b;');
  });

  it('returns empty for whitespace-only output', () => {
    assert.equal(cleanCompletion('   \n  ', { mode: 'multiline', linePrefix: '', suffix: '', stopTokens: [] }), '');
  });

  it('continues on the next line when a single-line answer starts with a line break', () => {
    const raw = '\n    (user) => user.email === email\n  );';
    assert.equal(
      cleanCompletion(raw, { mode: 'singleLine', linePrefix: '  return users.find(', suffix: '\n}', stopTokens: [] }),
      '\n    (user) => user.email === email\n  );',
    );
  });

  it('drops the cut-off last line when the token limit was hit', () => {
    const raw = '\n  const a = 1;\n  const b = comp';
    assert.equal(cleanCompletion(raw, { mode: 'multiline', linePrefix: '{', suffix: '', stopTokens: [], truncated: true }), '\n  const a = 1;');
  });

  it('detects suggestions that repeat the suffix', () => {
    assert.equal(duplicatesSuffix('return x;', '  return x;\n}'), true);
    assert.equal(duplicatesSuffix('return y;', '  return x;\n}'), false);
  });
});

describe('CompletionCache', () => {
  const position = (offset: number, prefix: string) => ({ documentKey: 'doc', offset, prefix, suffix: '\n}' });

  it('returns the same suggestion at the same position', () => {
    const cache = new CompletionCache();
    cache.set(position(10, 'const x = '), 'compute();');
    assert.equal(cache.get(position(10, 'const x = ')), 'compute();');
  });

  it('returns the remaining part while the user types through the suggestion', () => {
    const cache = new CompletionCache();
    cache.set(position(10, 'const x = '), 'compute();');
    assert.equal(cache.get(position(13, 'const x = com')), 'pute();');
    assert.equal(cache.get(position(13, 'const x = abc')), undefined);
  });

  it('ignores other documents and changed suffixes', () => {
    const cache = new CompletionCache();
    cache.set(position(10, 'const x = '), 'compute();');
    assert.equal(cache.get({ ...position(10, 'const x = '), documentKey: 'other' }), undefined);
    assert.equal(cache.get({ ...position(10, 'const x = '), suffix: 'different' }), undefined);
  });
});

describe('FIM templates', () => {
  it('detects the format from the model name', () => {
    assert.equal(resolvePromptFormat('auto', 'qwen3.6:35b-mlx'), 'qwen');
    assert.equal(resolvePromptFormat('auto', 'deepseek-coder-v2:16b'), 'deepseek');
    assert.equal(resolvePromptFormat('auto', 'llama3.2:latest'), 'chat');
    assert.equal(resolvePromptFormat('starcoder', 'qwen'), 'starcoder');
  });

  it('builds a Qwen repo-level FIM prompt', () => {
    const prompt = getFimTemplate('qwen').build({ prefix: 'a', suffix: 'b', filePath: 'src/x.ts', projectName: 'p' });
    assert.equal(prompt, '<|repo_name|>p\n<|file_sep|>src/x.ts\n<|fim_prefix|>a<|fim_suffix|>b<|fim_middle|>');
  });
});
