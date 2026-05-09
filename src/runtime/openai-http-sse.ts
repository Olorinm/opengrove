export interface OpenAiStreamDelta {
  role?: string;
  content?: string | null;
  tool_calls?: OpenAiStreamToolCallDelta[];
}

export interface OpenAiStreamToolCallDelta {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

export interface OpenAiStreamChunk {
  id: string;
  object: string;
  model: string;
  choices: Array<{
    index: number;
    delta: OpenAiStreamDelta;
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export async function* parseOpenAiSseStream(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncIterable<OpenAiStreamChunk> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data:")) continue;

        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;

        try {
          yield JSON.parse(data) as OpenAiStreamChunk;
        } catch {
          // skip malformed JSON lines
        }
      }
    }

    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) {
        const data = trimmed.slice(5).trim();
        if (data && data !== "[DONE]") {
          try {
            yield JSON.parse(data) as OpenAiStreamChunk;
          } catch {
            // ignore
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
