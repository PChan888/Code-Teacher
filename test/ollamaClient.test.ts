import { describe, it, expect, vi, afterEach } from 'vitest';
import { generate, OllamaError } from '../src/ai/ollamaClient';

describe('generate', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('POSTs to the local Ollama endpoint with the model, prompt, and stream:false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ response: '  Because it stores the sum.  ' }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await generate({ model: 'llama3.2', prompt: 'why?' });

    expect(result).toBe('Because it stores the sum.'); // trimmed
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:11434/api/generate');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ model: 'llama3.2', prompt: 'why?', stream: false });
  });

  it('throws OllamaError on a non-OK HTTP response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(generate({ model: 'llama3.2', prompt: 'why?' })).rejects.toThrow(OllamaError);
  });

  it('throws OllamaError when the response has no "response" string field', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ done: true }) }) as unknown as typeof fetch;
    await expect(generate({ model: 'llama3.2', prompt: 'why?' })).rejects.toThrow(OllamaError);
  });

  it('throws OllamaError when the connection itself fails (e.g. Ollama not running)', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    await expect(generate({ model: 'llama3.2', prompt: 'why?' })).rejects.toThrow(OllamaError);
  });

  it('aborts the request when the timeout elapses', async () => {
    vi.useFakeTimers();
    let capturedSignal: AbortSignal | undefined;
    global.fetch = vi.fn((_url: string, options: RequestInit) => {
      capturedSignal = options.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;

    const promise = generate({ model: 'llama3.2', prompt: 'why?', timeoutMs: 5000 });
    // Attach a rejection handler immediately so the timer-driven rejection
    // (fired synchronously by vi.advanceTimersByTimeAsync below) is never
    // briefly unhandled between the abort firing and this await.
    const assertion = expect(promise).rejects.toThrow(OllamaError);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
    expect(capturedSignal?.aborted).toBe(true);
    vi.useRealTimers();
  });

  it('respects an externally-supplied abort signal (cursor-move cancellation)', async () => {
    const controller = new AbortController();
    global.fetch = vi.fn((_url: string, options: RequestInit) => {
      return new Promise((_resolve, reject) => {
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as unknown as typeof fetch;

    const promise = generate({ model: 'llama3.2', prompt: 'why?', signal: controller.signal });
    const assertion = expect(promise).rejects.toThrow();
    controller.abort();
    await assertion;
  });
});
