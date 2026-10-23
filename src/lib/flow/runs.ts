/**
 * AppRun display helpers for the runs audit surface (#478 phase 3).
 * Pure functions — the pages stay thin and this stays testable.
 */

export type AppRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'CANCELLED';

export interface AppRun {
  id: string;
  organizationId: string;
  appId: string;
  agentId: string | null;
  userId: string | null;
  triggerKind: 'SCHEDULE' | 'WEBHOOK' | 'MANUAL' | 'INTEGRATION';
  triggerId: string | null;
  entryNodeUrn: string;
  eventData: Record<string, unknown> | null;
  /** The run envelope (requires hadron-server#534; absent on older servers). */
  data?: Record<string, unknown> | null;
  policy: unknown;
  budgetTokens: number | null;
  budgetActions: number | null;
  status: AppRunStatus;
  curNodeUrn: string | null;
  parentRunId: string | null;
  failure: Record<string, unknown> | null;
  timeoutMs: number | null;
  attempts: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  createdBy: string | null;
}

export const RUN_STATUSES: ReadonlyArray<AppRunStatus> = [
  'PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED',
];

/** A run the kill switch can still stop. */
export function isCancellable(status: AppRunStatus): boolean {
  return status === 'PENDING' || status === 'RUNNING';
}

/**
 * API dates are ISO 8601 as of hadron-server#205 (PR #834), which retyped
 * every date-valued OUTPUT field to a `DateTime` scalar; the spec-040
 * surfaces previously emitted epoch-millis strings. The numeric branch is
 * kept as tolerance for a portal running ahead of its server during a
 * deploy — it can go once no pre-#834 server is reachable.
 */
export function parseApiDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = /^\d+$/.test(s) ? new Date(Number(s)) : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Pinned locale (SSR/client hydration parity) with time — runs are recent. */
export function fmtRunTime(s: string | null | undefined): string {
  const d = parseApiDate(s);
  return d
    ? d.toLocaleString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
      })
    : '—';
}

/** "3s" / "2m 10s" between start and finish; em-dash when either is missing. */
export function runDuration(run: Pick<AppRun, 'startedAt' | 'finishedAt'>): string {
  const start = parseApiDate(run.startedAt);
  const end = parseApiDate(run.finishedAt);
  if (!start || !end) return '—';
  const ms = end.getTime() - start.getTime();
  if (ms < 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** Status chip Tailwind classes — green/red/amber/zinc family per outcome. */
export function statusChipClass(status: AppRunStatus): string {
  switch (status) {
    case 'COMPLETED':
      return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
    case 'FAILED':
    case 'TIMED_OUT':
      return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
    case 'RUNNING':
      return 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300';
    case 'CANCELLED':
      return 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400';
    case 'PENDING':
    default:
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  }
}

/** "Schedule · morning-digest" / "Manual" — trigger kind + name when known. */
export function describeTrigger(run: Pick<AppRun, 'triggerKind' | 'eventData'>): string {
  const kind = run.triggerKind.charAt(0) + run.triggerKind.slice(1).toLowerCase();
  const name =
    run.eventData && typeof run.eventData === 'object'
      ? (run.eventData as Record<string, unknown>).scheduleName ??
        (run.eventData as Record<string, unknown>).webhookName
      : null;
  return typeof name === 'string' && name !== '' ? `${kind} · ${name}` : kind;
}

/**
 * Entry-node display label: the node's loc, with the memory prefix dropped
 * (the full URN belongs in a title/<Urn> chip). Returns the input unchanged
 * when there's no memory separator to strip.
 */
export function entryNodeLabel(urn: string): string {
  const sep = urn.lastIndexOf('::');
  return sep >= 0 ? urn.slice(sep + 2) : urn;
}

/** The failure code (EDGE_CONDITION_ERROR, MAX_HOPS_EXCEEDED, …), if any. */
export function failureCode(run: Pick<AppRun, 'failure'>): string | null {
  const code = run.failure && typeof run.failure === 'object' ? (run.failure as Record<string, unknown>).code : null;
  return typeof code === 'string' ? code : null;
}

export function failureMessage(run: Pick<AppRun, 'failure'>): string | null {
  const msg = run.failure && typeof run.failure === 'object' ? (run.failure as Record<string, unknown>).message : null;
  return typeof msg === 'string' ? msg : null;
}

/**
 * Best-effort URN of the default run record: `runs:<runId>` in the ENTRY
 * node's memory. Only correct when the flow's last node had no output
 * spec and the flow stayed in the entry memory — the common case for
 * manual test runs; callers should label it "may not exist".
 */
export function defaultRunRecordUrn(run: Pick<AppRun, 'id' | 'entryNodeUrn'>): string | null {
  const sep = run.entryNodeUrn.lastIndexOf('::');
  if (sep <= 0) return null;
  return `${run.entryNodeUrn.slice(0, sep)}::runs:${run.id}`;
}

/**
 * Envelope keys the UI shows — `__`-prefixed keys are runner plumbing
 * (invisible to conditions/templates) and never author-relevant.
 */
export function visibleEnvelope(data: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!data || typeof data !== 'object') return null;
  const entries = Object.entries(data).filter(([k]) => !k.startsWith('__'));
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

/**
 * One COMPLETED hop of AppRun.hops (#482 / hadron-server#538). `edgeOut` is the
 * routing edge taken FROM this hop (null on the last); a hop that failed
 * mid-execution has no element, so the failed/current step is never in the
 * trail — it is `curNodeUrn` plus `failure`.
 */
export interface RunHop {
  node: string;
  /** The routing edge NAME taken from this hop (the producer's edgeName) — not a URN. */
  edgeOut: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** null = unknown (the server recorded nothing); 0 is a real zero. */
  tokensSpent: number | null;
}

export type RunTrail = { state: 'ready'; hops: RunHop[] } | { state: 'unavailable' };

const UNAVAILABLE: RunTrail = { state: 'unavailable' };

/**
 * Validate the untyped `hops` JSON. Absent, non-array, or ANY malformed element
 * makes the whole trail unavailable: a partial trail would silently drop steps,
 * and an invented zero-hop trail reads as "the run did nothing".
 */
export function parseHops(raw: unknown): RunTrail {
  if (!Array.isArray(raw)) return UNAVAILABLE;
  const hops: RunHop[] = [];
  for (const el of raw) {
    if (!el || typeof el !== 'object' || Array.isArray(el)) return UNAVAILABLE;
    const o = el as Record<string, unknown>;
    if (typeof o.node !== 'string' || o.node === '') return UNAVAILABLE;
    const edgeOut = o.edgeOut ?? null;
    if (edgeOut !== null && typeof edgeOut !== 'string') return UNAVAILABLE;
    const times: Array<string | null> = [];
    for (const key of ['startedAt', 'finishedAt'] as const) {
      const v = o[key] ?? null;
      if (v === null) {
        times.push(null);
        continue;
      }
      // The producer (hadron-server jobs/appRuns.ts) writes Date.now() — JSON
      // NUMBERS, not Date-scalar strings, since `hops` is untyped JSON. ISO strings
      // are accepted too. Normalised to ISO so every consumer sees one shape.
      const d = typeof v === 'number' ? (Number.isFinite(v) && v >= 0 ? new Date(v) : null)
        : typeof v === 'string' ? parseApiDate(v) : null;
      if (!d || isNaN(d.getTime())) return UNAVAILABLE;
      times.push(d.toISOString());
    }
    const tokens = o.tokensSpent ?? null;
    if (tokens !== null && (typeof tokens !== 'number' || !Number.isFinite(tokens) || tokens < 0)) {
      return UNAVAILABLE;
    }
    hops.push({ node: o.node, edgeOut: edgeOut as string | null, startedAt: times[0], finishedAt: times[1], tokensSpent: tokens });
  }
  return { state: 'ready', hops };
}

/** Token count with thousands separators (pinned locale); em-dash when unknown. */
export function fmtHopTokens(n: number | null): string {
  return n === null ? '—' : n.toLocaleString('en-US');
}

/** Duration of one hop; em-dash when either time is missing or the order is impossible. */
export function fmtHopDuration(startedAt: string | null, finishedAt: string | null): string {
  return runDuration({ startedAt, finishedAt });
}
