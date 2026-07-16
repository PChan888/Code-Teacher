/**
 * Thin, one-shot HTTP client for a local Ollama instance. No chat/session
 * state — every call is an independent POST to /api/generate. Uses Node's
 * global `fetch`/`AbortController` (no extra dependency).
 */

const OLLAMA_URL = 'http://localhost:11434/api/generate';
const DEFAULT_TIMEOUT_MS = 5000;

export class OllamaError extends Error {}

export interface GenerateOptions {
  model: string;
  prompt: string;
  timeoutMs?: number;
  /** Aborts the request early, e.g. when the cursor moves before it resolves. */
  signal?: AbortSignal;
}

/** POSTs a one-shot (non-streaming) generate request and returns the model's response text. Throws OllamaError on any failure (unreachable, timeout, bad response shape) or DOMException on external abort. */
export async function generate({ model, prompt, timeoutMs = DEFAULT_TIMEOUT_MS, signal }: GenerateOptions): Promise<string> {
  const timeoutController = new AbortController();
  const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
  const onExternalAbort = () => timeoutController.abort();
  signal?.addEventListener('abort', onExternalAbort);

  try {
    const res = await fetch(OLLAMA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: timeoutController.signal,
    });

    if (!res.ok) {
      throw new OllamaError(`Ollama responded with HTTP ${res.status}`);
    }

    const data: unknown = await res.json();
    const responseText = (data as { response?: unknown })?.response;
    if (typeof responseText !== 'string') {
      throw new OllamaError('Unexpected response shape from Ollama');
    }
    return responseText.trim();
  } catch (err) {
    if (err instanceof OllamaError) throw err;
    if (signal?.aborted) throw err; // real cancellation, not a failure - let the caller distinguish it
    throw new OllamaError(`Could not reach Ollama at ${OLLAMA_URL}: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}
