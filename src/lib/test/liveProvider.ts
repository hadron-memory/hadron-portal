/**
 * #1979 (live-provider test slice): the opt-in harness around ONE bounded live
 * Anthropic run of the real `callAgentChatLlm`.
 *
 * Nothing here is imported by production code. A retained copy of this file
 * does NOT create standing paid authority: every run needs a fresh grant.
 *
 * Inputs (environment only; values are never echoed anywhere):
 *   HADRON_LIVE_PROVIDER_TEST=1        explicit opt-in. Anything else: SKIPPED.
 *   HADRON_LIVE_ANTHROPIC_KEY          the test key. Missing: SKIPPED.
 *   HADRON_LIVE_ANTHROPIC_MODEL        model id from the test AI config.
 *   HADRON_LIVE_WINDOW_START           ISO-8601 UTC instant the one-hour window opened.
 *   CI                                 any non-empty value forces SKIPPED.
 *
 * Meanings:
 *   SKIPPED  zero requests; never a pass and never reproduction evidence.
 *   REFUSED  enabled but unsafe/unauthorised (no model, no/expired window,
 *            request cap spent); zero requests; a setup blocker.
 *   READY    the matrix may run: at most MAX_REQUESTS outbound HTTP requests
 *            TOTAL (SDK retries included), inside WINDOW_MS, counted in a local
 *            ledger. A local run-claim file stops a second matrix in the same
 *            window and working directory. This is an operator-cooperation
 *            brake, not a lock: a new window value, another directory, or
 *            deleting .live-provider/ starts fresh, so it never replaces the
 *            per-run grant.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const MAX_REQUESTS = 12;
export const WINDOW_MS = 60 * 60 * 1000;

export const LIVE_ENV = {
  flag: 'HADRON_LIVE_PROVIDER_TEST',
  key: 'HADRON_LIVE_ANTHROPIC_KEY',
  model: 'HADRON_LIVE_ANTHROPIC_MODEL',
  windowStart: 'HADRON_LIVE_WINDOW_START',
} as const;

/** Local, gitignored output directory (ledger, summary, redacted local diagnostic). */
export const LIVE_DIR = '.live-provider';
export const LEDGER_PATH = `${LIVE_DIR}/ledger.json`;

export type SkipReason = 'ci' | 'flag-off' | 'no-key';
export type RefuseReason =
  | 'no-model' | 'no-window' | 'bad-window' | 'window-in-future' | 'window-expired' | 'cap-exhausted'
  | 'matrix-already-run' | 'ledger-corrupt';

export type GateDecision =
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'refused'; reason: RefuseReason }
  | { status: 'ready'; apiKey: string; model: string; windowStartMs: number; windowEndMs: number };

type Env = Record<string, string | undefined>;

/** Pure: decides from env, the clock and the ledger count. Never reads or echoes a value's content. */
export function resolveGate(env: Env, nowMs: number, usedRequests: number, max = MAX_REQUESTS): GateDecision {
  if ((env.CI ?? '') !== '') return { status: 'skipped', reason: 'ci' };
  if (env[LIVE_ENV.flag] !== '1') return { status: 'skipped', reason: 'flag-off' };
  const apiKey = env[LIVE_ENV.key] ?? '';
  if (apiKey.trim() === '') return { status: 'skipped', reason: 'no-key' };
  const model = (env[LIVE_ENV.model] ?? '').trim();
  if (model === '') return { status: 'refused', reason: 'no-model' };
  const rawStart = (env[LIVE_ENV.windowStart] ?? '').trim();
  if (rawStart === '') return { status: 'refused', reason: 'no-window' };
  const windowStartMs = /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(rawStart) ? Date.parse(rawStart) : NaN;
  if (!Number.isFinite(windowStartMs)) return { status: 'refused', reason: 'bad-window' };
  if (windowStartMs > nowMs) return { status: 'refused', reason: 'window-in-future' };
  const windowEndMs = windowStartMs + WINDOW_MS;
  if (nowMs >= windowEndMs) return { status: 'refused', reason: 'window-expired' };
  if (usedRequests >= max) return { status: 'refused', reason: 'cap-exhausted' };
  return { status: 'ready', apiKey, model, windowStartMs, windowEndMs };
}

// ── The request ledger: one count per window, persisted before every request ──

export interface Ledger { count(): number; bump(): void }

/** An existing ledger that cannot be trusted: unknown prior usage, so no request may be made. */
export class LedgerCorruptError extends Error {
  constructor() { super('ledger-corrupt'); this.name = 'LedgerCorruptError'; }
}

export function fileLedger(path: string, windowStartMs: number): Ledger {
  const read = (): number => {
    let raw: string;
    try {
      raw = readFileSync(path, 'utf8');
    } catch (e) {
      // No ledger yet is a fresh window; anything else (unreadable) is unknown usage.
      if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') return 0;
      throw new LedgerCorruptError();
    }
    let parsed: { windowStartMs?: unknown; requests?: unknown } | null;
    try { parsed = JSON.parse(raw) as typeof parsed; } catch { throw new LedgerCorruptError(); }
    if (parsed === null || typeof parsed !== 'object' || !Number.isInteger(parsed.windowStartMs)
      || !Number.isInteger(parsed.requests) || (parsed.requests as number) < 0) throw new LedgerCorruptError();
    // A well-formed ledger for another window is that window's usage, not this one's.
    return parsed.windowStartMs === windowStartMs ? (parsed.requests as number) : 0;
  };
  return {
    count: read,
    bump() {
      const next = read() + 1;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ windowStartMs, requests: next }));
    },
  };
}

/**
 * The one-matrix marker: created exclusively (`wx`) before the first request, so
 * a second invocation in the same window and directory is refused whether the
 * first run finished, stopped partway, or is still running. Returns false when
 * the marker already exists.
 */
export function claimMatrixRun(ledgerPath: string, windowStartMs: number): boolean {
  mkdirSync(dirname(ledgerPath), { recursive: true });
  try {
    writeFileSync(`${ledgerPath}.run-${windowStartMs}`, '1', { flag: 'wx' });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code === 'EEXIST') return false;
    throw e;
  }
}

export function memoryLedger(initial = 0): Ledger {
  let n = initial;
  return { count: () => n, bump: () => { n += 1; } };
}

/** Read the count without a window (used to decide the gate before the window is parsed). */
export function ledgerCountFor(path: string, windowStartMs: number): number {
  return fileLedger(path, windowStartMs).count();
}

// ── Redaction of the one place a provider message may be looked at (local diagnostic only) ──

const CREDENTIAL_SHAPES: RegExp[] = [
  /sk-[A-Za-z0-9_-]{6,}/g,
  /\bBearer\s+\S+/gi,
  /\b(?:x-api-key|authorization|api[_-]?key)\b["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
  /\b[A-Za-z0-9_-]{32,}\b/g,
];
const MIN_KEY_FRAGMENT = 6;

/**
 * Removes the exact key, any fragment of it at least MIN_KEY_FRAGMENT long (a
 * provider may truncate or split a key mid-message), and credential-shaped
 * runs. Over-redacts rather than under-redacts.
 */
export function redactDiagnostic(text: string, apiKey: string, opts: { shapes?: boolean } = {}): string {
  let out = String(text);
  if (apiKey.length >= MIN_KEY_FRAGMENT) {
    const mask = new Array<boolean>(out.length).fill(false);
    for (let i = 0; i < out.length; i += 1) {
      let len = 0;
      while (i + len < out.length && len < apiKey.length && apiKey.includes(out.slice(i, i + len + 1))) len += 1;
      if (len >= MIN_KEY_FRAGMENT) for (let k = i; k < i + len; k += 1) mask[k] = true;
    }
    // Index by UTF-16 unit, like the mask: spreading would index by code point and drift after any non-BMP char.
    out = out.split('').map((c, i) => (mask[i] ? '\u0000' : c)).join('').replace(/\u0000+/g, '[redacted]');
  }
  if (opts.shapes === false) return out;
  for (const shape of CREDENTIAL_SHAPES) out = out.replace(shape, '[redacted]');
  return out;
}

// ── The guarded transport: counts and bounds EVERY outbound request, retries included ──

const PROVIDER_ERROR_TYPES = [
  'invalid_request_error', 'authentication_error', 'permission_error', 'not_found_error',
  'rate_limit_error', 'api_error', 'overloaded_error',
] as const;
export type ProviderErrorType = (typeof PROVIDER_ERROR_TYPES)[number];

export interface Observation {
  /** Closed fields: safe for public records. */
  status: number;
  type: ProviderErrorType | 'other' | null;
  /** Redacted provider message: LOCAL diagnostic only, never public, never a logger argument. */
  localMessage: string | null;
}

export interface Guard {
  fetch: typeof fetch;
  observations: Observation[];
  /** Outbound requests this guard let through (this run). */
  sent(): number;
  /** Set when the guard itself stopped a request (window over or cap spent). */
  stoppedBy(): 'window-expired' | 'cap-exhausted' | null;
}

export class LiveGateStop extends Error {
  constructor(public readonly reason: 'window-expired' | 'cap-exhausted') {
    super(`live gate stopped the request: ${reason}`);
    this.name = 'LiveGateStop';
  }
}

/**
 * Wraps the real fetch. Before EVERY request (SDK retries are requests too) the
 * window and the ledger cap are checked, and the count is persisted; the
 * request itself (url, headers, body) is forwarded untouched. A failed
 * response is read from a clone for the local diagnostic and the original is
 * returned to the SDK unchanged.
 */
export function createGuard(opts: {
  realFetch: typeof fetch;
  now: () => number;
  windowEndMs: number;
  ledger: Ledger;
  apiKey: string;
  max?: number;
}): Guard {
  const max = opts.max ?? MAX_REQUESTS;
  const observations: Observation[] = [];
  let sent = 0;
  let stopped: 'window-expired' | 'cap-exhausted' | null = null;
  const guarded = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (opts.now() >= opts.windowEndMs) { stopped = 'window-expired'; throw new LiveGateStop('window-expired'); }
    if (opts.ledger.count() >= max) { stopped = 'cap-exhausted'; throw new LiveGateStop('cap-exhausted'); }
    opts.ledger.bump();
    sent += 1;
    const response = await opts.realFetch(input, init);
    observations.push(await observe(response, opts.apiKey));
    return response;
  };
  return { fetch: guarded as typeof fetch, observations, sent: () => sent, stoppedBy: () => stopped };
}

async function observe(response: Response, apiKey: string): Promise<Observation> {
  if (response.ok) return { status: response.status, type: null, localMessage: null };
  let type: Observation['type'] = 'other';
  let localMessage: string | null = null;
  try {
    const body = (await response.clone().json()) as { error?: { type?: unknown; message?: unknown } };
    const raw: unknown = body?.error?.type;
    const i = typeof raw === 'string' ? (PROVIDER_ERROR_TYPES as readonly string[]).indexOf(raw) : -1;
    type = i >= 0 ? PROVIDER_ERROR_TYPES[i] : 'other';
    const message: unknown = body?.error?.message;
    if (typeof message === 'string') localMessage = redactDiagnostic(message, apiKey);
  } catch {
    // An unreadable body only loses the local diagnostic.
  }
  return { status: response.status, type, localMessage };
}
