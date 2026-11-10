import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { extractCode, matchIndentation } from '../src/edit/codeExtraction';
import { applyEditBlocks, parseEditBlocks } from '../src/edit/editBlocks';
import { findChangedRegion } from '../src/edit/textRegion';

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

describe('findChangedRegion', () => {
  it('returns undefined for identical texts', () => {
    assert.equal(findChangedRegion('a\nb', 'a\nb'), undefined);
  });

  it('keeps common leading and trailing lines', () => {
    assert.deepEqual(findChangedRegion('a\nb\nc\nd', 'a\nB\nB2\nd'), { startLine: 1, oldLineCount: 2, newLines: ['B', 'B2'] });
  });

  it('describes pure insertions and deletions', () => {
    assert.deepEqual(findChangedRegion('a\nc', 'a\nb\nc'), { startLine: 1, oldLineCount: 0, newLines: ['b'] });
    assert.deepEqual(findChangedRegion('a\nb\nc', 'a\nc'), { startLine: 1, oldLineCount: 1, newLines: [] });
  });
});
