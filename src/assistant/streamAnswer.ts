import { ChatMessage } from '../ollama/ollamaClient';
import { getServices } from '../services';

const UPDATE_INTERVAL_MS = 80;

/**
 * Streams a chat answer from the edit model, calling `onUpdate` with the markdown so far
 * (throttled so the UI isn't re-rendered for every token). Resolves with the full answer.
 */
export async function streamAnswer(
  messages: ChatMessage[],
  signal: AbortSignal,
  onUpdate: (markdown: string) => void,
): Promise<string> {
  const { settings, ollama } = getServices();
  let lastUpdate = 0;
  const result = await ollama.chat({
    model: settings.editModel,
    messages,
    think: settings.edit.enableThinking,
    keepAlive: settings.keepAlive,
    options: { temperature: 0.3, num_ctx: 32768 },
    signal,
    onProgress: (text) => {
      const now = Date.now();
      if (now - lastUpdate >= UPDATE_INTERVAL_MS) {
        lastUpdate = now;
        onUpdate(text);
      }
    },
  });
  return result.text.trim();
}
