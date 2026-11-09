import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractCode, matchIndentation } from '../src/edit/codeExtraction';
import { applyEditBlocks, parseEditBlocks } from '../src/edit/editBlocks';
import { candidatePaths, findLocalImports } from '../src/edit/importParsing';
import { classifyChange, shiftBlocks } from '../src/edit/lineBlocks';

describe('extractCode', () => {
  it('reads the first fenced block', () => {
    assert.equal(extractCode('Here:\n```ts\nconst a = 1;\n```\nDone'), 'const a = 1;');
  });

  it('tolerates a missing closing fence and missing fences', () => {
    assert.equal(extractCode('```py\nx = 1'), 'x = 1');
    assert.equal(extractCode('\nx = 1\n'), 'x = 1');
  });

  it('drops thinking sections', () => {
    assert.equal(extractCode('<think>hmm</think>```js\nf()\n```'), 'f()');
  });
});

describe('matchIndentation', () => {
  it('re-indents code that lost its indentation', () => {
    assert.equal(matchIndentation('if (a) {\n  b();\n}', '    '), '    if (a) {\n      b();\n    }');
  });

  it('keeps already-correct code untouched', () => {
    assert.equal(matchIndentation('  x();', '  '), '  x();');
  });
});

describe('edit blocks', () => {
  const file = 'function a() {\n  return 1;\n}\n\nfunction b() {\n  return 2;\n}\n';

  it('parses blocks, including empty replacements', () => {
    const answer = '<<<<<<< SEARCH\n  return 1;\n=======\n  return 10;\n>>>>>>> REPLACE\n\n<<<<<<< SEARCH\nfunction b() {\n=======\n>>>>>>> REPLACE';
    assert.deepEqual(parseEditBlocks(answer), [
      { search: '  return 1;', replace: '  return 10;' },
      { search: 'function b() {', replace: '' },
    ]);
  });

  it('applies exact matches', () => {
    const result = applyEditBlocks(file, [{ search: '  return 2;', replace: '  return 20;' }]);
    assert.deepEqual(result, { ok: true, text: file.replace('return 2;', 'return 20;') });
  });

  it('applies blocks whose indentation differs from the file', () => {
    const result = applyEditBlocks(file, [{ search: 'return 1;', replace: 'const x = 1;\nreturn x;' }]);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.text, 'function a() {\n  const x = 1;\n  return x;\n}\n\nfunction b() {\n  return 2;\n}\n');
  });

  it('fails when a block does not match', () => {
    const result = applyEditBlocks(file, [{ search: 'nothing like this', replace: 'x' }]);
    assert.equal(result.ok, false);
  });
});

describe('import parsing', () => {
  it('finds relative JS/TS imports and their symbols', () => {
    const source = "import { a, b as c } from './utils';\nimport React from 'react';\nconst d = require('../d');\nimport type { T } from './types';";
    assert.deepEqual(findLocalImports(source, 'typescript'), [
      { specifier: './utils', symbols: ['a', 'b'] },
      { specifier: './types', symbols: ['T'] },
      { specifier: '../d', symbols: ['d'] },
    ]);
  });

  it('finds relative Python imports', () => {
    assert.deepEqual(findLocalImports('from .models import User, Order\nimport os', 'python'), [
      { specifier: '.models', symbols: ['User', 'Order'] },
    ]);
    assert.deepEqual(candidatePaths('..core.db', 'python'), ['../core/db.py', '../core/db/__init__.py']);
  });

  it('lists candidate file paths for a JS specifier', () => {
    const paths = candidatePaths('./utils', 'typescript');
    assert.ok(paths.includes('./utils.ts'));
    assert.ok(paths.includes('./utils/index.ts'));
  });
});

describe('pending inline edit line tracking', () => {
  const blocks = { old: { start: 10, end: 12 }, proposed: { start: 13, end: 16 } };

  it('shifts when the user edits above', () => {
    assert.equal(classifyChange(blocks, { startLine: 2, endLine: 2, lineDelta: 1 }), 'shifted');
    assert.deepEqual(shiftBlocks(blocks, 1), { old: { start: 11, end: 13 }, proposed: { start: 14, end: 17 } });
  });

  it('detects edits inside each block and below', () => {
    assert.equal(classifyChange(blocks, { startLine: 11, endLine: 11, lineDelta: 0 }), 'touchesOld');
    assert.equal(classifyChange(blocks, { startLine: 14, endLine: 14, lineDelta: 0 }), 'touchesProposed');
    assert.equal(classifyChange(blocks, { startLine: 30, endLine: 30, lineDelta: 0 }), 'unaffected');
  });

  it('handles insertions (no old block)', () => {
    const insertion = { old: { start: 5, end: 4 }, proposed: { start: 5, end: 7 } };
    assert.equal(classifyChange(insertion, { startLine: 1, endLine: 1, lineDelta: 0 }), 'shifted');
    assert.equal(classifyChange(insertion, { startLine: 6, endLine: 6, lineDelta: 0 }), 'touchesProposed');
  });
});
