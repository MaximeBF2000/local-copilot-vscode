/** Prompts used when the user asks a question instead of requesting a change. */

import { ChatMessage } from '../ollama/ollamaClient';

export interface ChatPromptInput {
  question: string;
  filePath: string;
  languageId: string;
  /** What the code shown is, e.g. "the selected code" or "the whole file". */
  codeLabel: string;
  code: string;
  /** Optional read-only context, e.g. imported files. */
  extraContext?: string;
  /** Earlier questions and answers in this conversation. */
  history: { role: 'user' | 'assistant'; content: string }[];
}

const CHAT_SYSTEM = `You are an expert software engineer helping a developer inside their code editor.
Answer the developer's question about their code.
- Be concise and concrete: short paragraphs or bullet points, no filler.
- Use markdown. Put code in fenced code blocks with the language.
- Refer to the code shown; do not invent code that is not there.
- Do not rewrite the whole code unless the developer asks for it.`;

export function buildChatMessages(input: ChatPromptInput): ChatMessage[] {
  const context =
    (input.extraContext ? `${input.extraContext}\n\n` : '') +
    `File: ${input.filePath}\nHere is ${input.codeLabel}:\n\`\`\`${input.languageId}\n${input.code}\n\`\`\``;

  // The code goes with the first question; follow-ups rely on the conversation.
  const [first, ...rest] = [...input.history, { role: 'user' as const, content: input.question }];
  return [
    { role: 'system', content: CHAT_SYSTEM },
    { role: 'user', content: `${context}\n\n${first.content}` },
    ...rest,
  ];
}

/** Folds earlier messages into an edit instruction, so "do that" after an explanation still makes sense. */
export function instructionWithHistory(instruction: string, history: { role: 'user' | 'assistant'; content: string }[]): string {
  if (history.length === 0) {
    return instruction;
  }
  const transcript = history.map((m) => `${m.role === 'user' ? 'Developer' : 'Assistant'}: ${m.content}`).join('\n\n');
  return `Earlier conversation about this code:\n${transcript}\n\nNow: ${instruction}`;
}
