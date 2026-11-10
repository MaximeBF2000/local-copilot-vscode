/**
 * The questions sent to the decision model (e.g. clef-flash). Each one is a multiple-choice
 * question about a "state" (the facts); the option names are the values the engine returns.
 * Pure data, no VS Code or network dependency.
 */

import { ChoiceQuestion } from '../ollama/ollamaClient';

export interface Decision<T extends string> {
  /** Name of the question, also used in logs. */
  name: string;
  state: string;
  question: ChoiceQuestion & { criteria: Record<T, string> };
}

export function intentDecision(instruction: string, target: string): Decision<'edit' | 'chat'> {
  return {
    name: 'intent',
    state: `A developer selected ${target} in their code editor and typed this request:\n"${instruction}"`,
    question: {
      type: 'choice',
      instructions: 'Does the developer want the code changed, or only an answer about it?',
      criteria: {
        edit: 'The request asks to modify, add, remove, fix or rewrite code.',
        chat: 'The request asks a question, an explanation or a review, and the code must not be changed.',
      },
    },
  };
}

export function editScopeDecision(instruction: string, currentLine: string): Decision<'line' | 'function'> {
  return {
    name: 'edit_scope',
    state: `Edit request: "${instruction}"\nThe cursor is on this line, inside a function:\n${currentLine.trim()}`,
    question: {
      type: 'choice',
      instructions: 'Which code does the edit request apply to?',
      criteria: {
        function: 'The whole function or method that contains the cursor line.',
        line: 'Only the line the cursor is on.',
      },
    },
  };
}

export function commentIntentDecision(comment: string): Decision<'implement' | 'note'> {
  return {
    name: 'comment_intent',
    state: `A developer just wrote this code comment and pressed Enter:\n${comment}`,
    question: {
      type: 'choice',
      instructions: 'Does the comment describe code that should be written right below it?',
      criteria: {
        implement: 'It describes code to write next (a function, a computation, a step).',
        note: 'It is an explanation, a note, a TODO for later, a directive, or commented-out code.',
      },
    },
  };
}
