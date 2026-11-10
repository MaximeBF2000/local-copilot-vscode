import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { commentIntentDecision, editScopeDecision, intentDecision } from '../src/decisions/decisionQuestions';
import {
  chooseEditScopeByRules,
  chooseIntentByRules,
  isImplementationRequestByRules,
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

describe('decision questions', () => {
  it('asks multiple-choice questions whose option names are the engine values', () => {
    assert.deepEqual(Object.keys(intentDecision('explain this', 'a function').question.criteria).sort(), ['chat', 'edit']);
    assert.deepEqual(Object.keys(editScopeDecision('fix it', 'x++').question.criteria).sort(), ['function', 'line']);
    assert.deepEqual(Object.keys(commentIntentDecision('// sort users').question.criteria).sort(), ['implement', 'note']);
  });

  it('puts the request in the state', () => {
    const decision = intentDecision('explain this function', 'a function');
    assert.equal(decision.question.type, 'choice');
    assert.match(decision.state, /explain this function/);
  });
});

describe('chooseIntentByRules', () => {
  const chat = [
    'explain this function',
    'what does this regex match?',
    'why is this slow?',
    'is there a bug in this loop',
    'summarize what this file does',
    'how could I make this more readable?',
    'review this code for security issues',
    'walk me through the algorithm',
  ];
  const edits = [
    'refactor this function to make it easier to understand',
    'add error handling',
    'make it faster',
    'fix the off-by-one bug in this loop',
    'can you convert this to async/await',
    'please rename x to userCount',
    'translate the error messages to French',
    'use a map instead of the loop',
  ];
  for (const text of chat) {
    it(`answers: ${text}`, () => assert.equal(chooseIntentByRules(text), 'chat'));
  }
  for (const text of edits) {
    it(`edits: ${text}`, () => assert.equal(chooseIntentByRules(text), 'edit'));
  }
});
