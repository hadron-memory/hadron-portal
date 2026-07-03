/**
 * #441 — minimal in-memory rate limiter for the LLM-invoking tester endpoints.
 *
 * adapter-node runs single-process / single-replica, so a process-local Map is
 * sufficient for v1. When the portal scales horizontally this MUST move to a
 * shared store (e.g. Redis) — a per-process limiter under N replicas allows Nx
 * the intended rate. Keyed per user (see callers), fixed-window.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
let lastSweep = 0;

/** Drop expired windows so the Map can't grow unbounded across many keys. */
function sweep(now: number): void {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, w] of windows) {
    if (now >= w.resetAt) windows.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets; 0 when allowed. */
  retryAfterSec: number;
}

/**
 * Fixed-window check: allow up to `limit` calls per `windowMs` for `key`.
 * `now` is injectable for tests.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  sweep(now);
  const w = windows.get(key);
  if (!w || now >= w.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  if (w.count >= limit) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  }
  w.count++;
  return { ok: true, retryAfterSec: 0 };
}

/**
 * Convenience for API route handlers: returns a 429 `Response` when the caller
 * is over the limit, or `null` when the call is allowed.
 */
export function rateLimitResponse(
  userId: string | null | undefined,
  bucket: string,
  limit: number,
  windowMs: number,
): Response | null {
  const key = `${bucket}:${userId ?? 'unknown'}`;
  const { ok, retryAfterSec } = rateLimit(key, limit, windowMs);
  if (ok) return null;
  return new Response(
    JSON.stringify({ error: 'Rate limit exceeded. Please wait before retrying.' }),
    {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Retry-After': String(retryAfterSec) },
    },
  );
}

/** Test-only: clear all windows between cases. */
export function __resetRateLimit(): void {
  windows.clear();
  lastSweep = 0;
}
