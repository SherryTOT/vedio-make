/**
 * Tiny retry wrapper for provider adapters. Transient errors (5xx, 429,
 * connection reset, timeout) get up to N retries with exponential backoff
 * + jitter. Non-transient errors (4xx auth, validation) abort immediately.
 *
 * Used by adapters where one call is one API charge — we don't want a
 * blip to torpedo a 16-scene TTS run.
 */

/** Error categories we should retry on. */
function isRetryable(err: unknown): boolean {
  const msg = String((err as Error)?.message || err);
  // HTTP status codes embedded in messages by our adapters
  if (/\b(429|500|502|503|504)\b/.test(msg)) return true;
  // Node fetch / TCP layer
  if (/ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|socket hang up|network|fetch failed/i.test(msg)) return true;
  // Minimax soft-fail business codes (rare — keep narrow)
  if (/status=(1002|1004|1027|1039)\b/.test(msg)) return true; // rate limit / busy
  return false;
}

const DEFAULT_BACKOFF_MS = [500, 1500, 4000]; // 3 retries: 0.5s, 1.5s, 4s

export interface RetryOpts {
  /** Max attempts INCLUDING the first one. Default 4 (1 initial + 3 retries). */
  maxAttempts?: number;
  /** Custom backoff schedule in ms. */
  backoffMs?: number[];
  /** Optional label printed in retry log lines. */
  label?: string;
}

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOpts = {}): Promise<T> {
  const backoff = opts.backoffMs ?? DEFAULT_BACKOFF_MS;
  const maxAttempts = opts.maxAttempts ?? backoff.length + 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const transient = isRetryable(e);
      if (!transient || attempt >= maxAttempts) throw e;
      const delay = (backoff[attempt - 1] ?? backoff.at(-1) ?? 1000) * (0.8 + Math.random() * 0.4);
      const label = opts.label ? `[${opts.label}] ` : "";
      console.warn(
        `${label}attempt ${attempt}/${maxAttempts} failed (${(e as Error).message?.slice(0, 80)}…); retrying in ${(delay / 1000).toFixed(1)}s`
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}
