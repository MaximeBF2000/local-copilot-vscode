import { OllamaClient } from '../ollama/ollamaClient';
import { extractCode } from '../edit/codeExtraction';
import { CompletionContext } from './completionContext';
import { CompletionMode } from './completionMode';
import { PromptFormat, getFimTemplate } from './fimTemplates';
import { cleanCompletion, duplicatesSuffix } from './postProcess';

export interface CompletionRequest {
  model: string;
  format: PromptFormat;
  context: CompletionContext;
  mode: CompletionMode;
  maxTokens: number;
  temperature: number;
  keepAlive: string;
  signal?: AbortSignal;
}

export interface CompletionResult {
  /** Cleaned suggestion text, empty when nothing should be shown. */
  text: string;
  tokenCount: number;
  durationMs: number;
}

/** Asks the model for the code missing at the cursor and cleans the answer. */
export async function generateCompletion(client: OllamaClient, request: CompletionRequest): Promise<CompletionResult> {
  const { context, mode } = request;
  const { prompt, stopTokens, usesChat } = buildPrompt(request);
  // No newline stop for single-line mode: models sometimes start with a line break and continue on the next line.
  const options = { temperature: request.temperature, num_predict: request.maxTokens, stop: stopTokens };

  const result = usesChat
    ? await client.chat({ model: request.model, messages: prompt as ChatPrompt, options, keepAlive: request.keepAlive, signal: request.signal })
    : await client.generateRaw({ model: request.model, prompt: prompt as string, options, keepAlive: request.keepAlive, signal: request.signal });

  const rawText = usesChat ? extractCode(result.text) : result.text;
  let text = cleanCompletion(rawText, {
    mode,
    linePrefix: context.linePrefix,
    suffix: context.suffix,
    stopTokens,
    truncated: result.truncated,
  });
  if (duplicatesSuffix(text, context.suffix)) {
    text = '';
  }
  return { text, tokenCount: result.tokenCount, durationMs: result.durationMs };
}

type ChatPrompt = { role: 'system' | 'user'; content: string }[];

function buildPrompt(request: CompletionRequest): { prompt: string | ChatPrompt; stopTokens: string[]; usesChat: boolean } {
  const { context } = request;
  if (request.format !== 'chat') {
    const template = getFimTemplate(request.format);
    return { prompt: template.build(context), stopTokens: template.stopTokens, usesChat: false };
  }
  return { prompt: buildChatCompletionPrompt(context, request.mode), stopTokens: [], usesChat: true };
}

/** Fallback for models without fill-in-the-middle training: ask in plain language. */
function buildChatCompletionPrompt(context: CompletionContext, mode: CompletionMode): ChatPrompt {
  const scope =
    mode === 'singleLine'
      ? 'Complete only the current line.'
      : mode === 'commentToCode'
        ? 'Implement what the comment right above <CURSOR> asks for.'
        : 'Write the next few lines of code.';
  return [
    {
      role: 'system',
      content:
        'You are a code completion engine. Reply with ONLY the exact code to insert at <CURSOR>, ' +
        'without repeating code before or after it, without explanations, in a single markdown code block.',
    },
    {
      role: 'user',
      content: `File: ${context.filePath}\n${scope}\n\n\`\`\`${context.languageId}\n${context.prefix}<CURSOR>${context.suffix}\n\`\`\``,
    },
  ];
}
