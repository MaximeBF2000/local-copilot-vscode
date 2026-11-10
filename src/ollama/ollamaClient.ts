/**
 * Minimal client for the local Ollama HTTP API.
 * Has no VS Code dependency so it can also be used from tests and benchmarks.
 */

export interface GenerateOptions {
  temperature?: number;
  num_predict?: number;
  stop?: string[];
  num_ctx?: number;
}

export interface RawGenerateRequest {
  model: string;
  prompt: string;
  options: GenerateOptions;
  keepAlive?: string;
  signal?: AbortSignal;
}

export interface GenerateResult {
  text: string;
  /** Number of generated tokens. */
  tokenCount: number;
  /** Wall-clock duration of the request in milliseconds. */
  durationMs: number;
  /** True when generation stopped because it hit the token limit. */
  truncated: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  options?: GenerateOptions;
  think?: boolean;
  keepAlive?: string;
  signal?: AbortSignal;
  /** Called with the full text generated so far, each time a chunk arrives. */
  onProgress?: (textSoFar: string, tokenCount: number) => void;
}

/** A multiple-choice question: option name → description (null when the name says it all). */
export interface ChoiceQuestion {
  type: 'choice';
  instructions: string;
  criteria: Record<string, string | null>;
}

export interface DecisionRequest {
  model: string;
  /** The facts the questions are about. */
  state: string;
  questions: Record<string, ChoiceQuestion>;
  keepAlive?: string;
  signal?: AbortSignal;
}

export interface DecisionAnswer {
  /** The most likely option name. */
  choice: string;
  /** Probability of each option (they sum to 1). */
  probabilities: Record<string, number>;
  /** How concentrated the probabilities are (0 = uniform, 1 = certain). */
  confidence: number;
}

export interface InstalledModel {
  name: string;
  parameterSize: string;
  capabilities: string[];
}

export class OllamaClient {
  constructor(private readonly baseUrl: string) {}

  /**
   * Sends a prompt as-is (no chat template). Used for fill-in-the-middle completion,
   * where we build the special-token prompt ourselves.
   */
  async generateRaw(request: RawGenerateRequest): Promise<GenerateResult> {
    const startedAt = Date.now();
    const response = await this.post(
      '/api/generate',
      {
        model: request.model,
        prompt: request.prompt,
        raw: true,
        stream: false,
        keep_alive: request.keepAlive,
        options: request.options,
      },
      request.signal,
    );
    const body = (await response.json()) as { response: string; eval_count?: number; done_reason?: string };
    return {
      text: body.response,
      tokenCount: body.eval_count ?? 0,
      durationMs: Date.now() - startedAt,
      truncated: body.done_reason === 'length',
    };
  }

  /** Streams a chat completion and returns the final answer text (thinking excluded). */
  async chat(request: ChatRequest): Promise<GenerateResult> {
    const startedAt = Date.now();
    const response = await this.post(
      '/api/chat',
      {
        model: request.model,
        messages: request.messages,
        stream: true,
        think: request.think ?? false,
        keep_alive: request.keepAlive,
        options: request.options,
      },
      request.signal,
    );

    let text = '';
    let tokenCount = 0;
    let truncated = false;
    for await (const chunk of readJsonLines(response)) {
      const content = (chunk.message as { content?: string } | undefined)?.content ?? '';
      text += content;
      tokenCount++;
      request.onProgress?.(text, tokenCount);
      if (chunk.done) {
        tokenCount = (chunk.eval_count as number | undefined) ?? tokenCount;
        truncated = chunk.done_reason === 'length';
      }
    }
    return { text, tokenCount, durationMs: Date.now() - startedAt, truncated };
  }

  /**
   * Asks a decision model (Ollama `decision` capability, e.g. clef-flash) multiple-choice questions
   * about a state, through Ollama's native decision endpoint. Answers are keyed by question name.
   */
  async decide(request: DecisionRequest): Promise<Record<string, DecisionAnswer>> {
    const response = await this.post(
      '/v1/systemone',
      { model: request.model, state: request.state, questions: request.questions, keep_alive: request.keepAlive },
      request.signal,
    );
    const body = (await response.json()) as { answers: Record<string, DecisionAnswer> };
    return body.answers;
  }

  async listModels(signal?: AbortSignal): Promise<InstalledModel[]> {
    const response = await fetch(`${this.baseUrl}/api/tags`, { signal });
    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }
    const body = (await response.json()) as {
      models: { name: string; details?: { parameter_size?: string }; capabilities?: string[] }[];
    };
    return body.models.map((m) => ({
      name: m.name,
      parameterSize: m.details?.parameter_size ?? '',
      capabilities: m.capabilities ?? [],
    }));
  }

  /** Loads a model into memory so the first real request is fast. */
  async warmUp(model: string, keepAlive: string): Promise<void> {
    await this.post('/api/generate', { model, keep_alive: keepAlive, stream: false });
  }

  private async post(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      throw new Error(`Cannot reach Ollama at ${this.baseUrl}. Is it running? (${(error as Error).message})`);
    }
    if (!response.ok) {
      const details = await response.text().catch(() => '');
      throw new Error(`Ollama returned ${response.status}: ${details.slice(0, 300)}`);
    }
    return response;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

/** Parses an NDJSON (one JSON object per line) streaming response. */
async function* readJsonLines(response: Response): AsyncGenerator<Record<string, unknown>> {
  if (!response.body) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const bytes of response.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (line) {
        yield parseChunk(line);
      }
    }
  }
  if (buffer.trim()) {
    yield parseChunk(buffer.trim());
  }
}

function parseChunk(line: string): Record<string, unknown> {
  const chunk = JSON.parse(line) as Record<string, unknown>;
  if (typeof chunk.error === 'string') {
    throw new Error(`Ollama error: ${chunk.error}`);
  }
  return chunk;
}
