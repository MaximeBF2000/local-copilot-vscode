import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildDecisionMessages, readChoiceProbabilities } from '../src/decisions/decisionPrompt';
import {
  chooseEditScopeByRules,
  isImplementationRequestByRules,
  needsRelatedFilesByRules,
  shouldSuggestByRules,
} from '../src/decisions/rules';

describe('shouldSuggestByRules', () => {
  it('suggests at the end of a line or before closing characters', () => {
    assert.equal(shouldSuggestByRules('const x = ', ''), true);
    assert.equal(shouldSuggestByRules('foo(', ')'), true);
    assert.equal(shouldSuggestByRules('const s = "', '";'), true);
  });

  it('does not suggest in the middle of existing code', () => {
    assert.equal(shouldSuggestByRules('const x', ' = compute();'), false);
  });

  it('does not suggest after a finished statement', () => {
    assert.equal(shouldSuggestByRules('doSomething();', ''), false);
  });
});

describe('isImplementationRequestByRules', () => {
  const requests = [
    '// Create a function that validates an email',
    '# compute the average of the list and return it',
    '// function to parse the config file',
    '/* Sort users by name */',
    '-- get all orders from last week',
  ];
  const notes = [
    '// TODO: refactor later',
    '// This is a hack because the API is slow',
    '// const x = compute();',
    '// eslint-disable-next-line',
    '// ok',
  ];

  for (const comment of requests) {
    it(`detects a request: ${comment}`, () => assert.equal(isImplementationRequestByRules(comment), true));
  }
  for (const comment of notes) {
    it(`ignores a note: ${comment}`, () => assert.equal(isImplementationRequestByRules(comment), false));
  }
});

describe('chooseEditScopeByRules', () => {
  it('targets the function by default when there is one', () => {
    assert.equal(chooseEditScopeByRules('add error handling', true), 'function');
    assert.equal(chooseEditScopeByRules('add error handling', false), 'line');
    assert.equal(chooseEditScopeByRules('simplify this line', true), 'line');
  });
});

describe('needsRelatedFilesByRules', () => {
  it('includes related files when the instruction mentions them', () => {
    assert.equal(needsRelatedFilesByRules('use the User type correctly', ['models'], ['User']), true);
    assert.equal(needsRelatedFilesByRules('follow the same style as the imported helpers', ['utils'], []), true);
    assert.equal(needsRelatedFilesByRules('add comments', ['models'], ['User']), false);
    assert.equal(needsRelatedFilesByRules('use User', [], []), false);
  });
});

describe('decision prompt', () => {
  const question = {
    field: 'intent',
    question: 'Is it a request?',
    choices: [
      { value: true, description: 'yes' },
      { value: false, description: 'no' },
    ],
    context: '// make it',
  };

  it('labels choices with letters', () => {
    const user = buildDecisionMessages(question)[1].content;
    assert.match(user, /A: true — yes\nB: false — no/);
    assert.match(user, /Requested field: intent/);
  });

  it('normalises letter probabilities', () => {
    const result = readChoiceProbabilities(question, [
      { token: 'B', probability: 0.6 },
      { token: 'A', probability: 0.2 },
      { token: 'The', probability: 0.2 },
    ]);
    assert.equal(result[0].value, false);
    assert.ok(Math.abs(result[0].probability - 0.75) < 1e-9);
  });

  it('throws when no known letter is present', () => {
    assert.throws(() => readChoiceProbabilities(question, [{ token: 'Hello', probability: 1 }]));
  });
});
