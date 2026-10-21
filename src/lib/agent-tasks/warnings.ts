import { t } from '$lib/i18n/t';
import { isFlatV2, parseUrnV2 } from '$lib/urn/parse-urn';

/**
 * portal#1214 — the warnings a task write's response carries
 * (hadron-server#2198, shipped in #2207 at eb2cb49a).
 *
 * On success, createAgentTask, assignAgentTask and reassignAgentTask may
 * answer `extensions.warnings`: `{ path, code, text, register? }`, where
 * `path` is the mutation's response key and `register` says where the App's
 * register maps the code (absent for a caller with no Agent). The server
 * files a warning only after its write committed, and drops every warning
 * under a path that errored.
 *
 * The code and text are shown verbatim, never reworded; codes are a closed
 * list per server release and an unknown one passes through. Decoding is
 * tolerant: a malformed or oversized entry is skipped, never thrown.
 */
export type TaskWarningRegister =
  | { state: 'mapped'; taskLoc: string; taskUrn: string }
  | { state: 'unmapped' }
  | { state: 'unresolved' };

export type TaskWarning = { code: string; text: string; register?: TaskWarningRegister };

/** What one write's response said: the warnings to show, how many were cut, and whether the write committed. */
export type TaskWarnings = { warnings: TaskWarning[]; more: number; committed: boolean };

/** The server's own cap per operation; anything past it is counted, not shown. */
export const MAX_SHOWN_WARNINGS = 5;
const MAX_CODE = 128;
const MAX_TEXT = 1024;

const str = (x: unknown, max: number): string | null => (typeof x === 'string' && x.length > 0 && x.length <= max ? x : null);

/** A mapped task's URN is shown only when it is a canonical v2 node URN. */
function nodeUrn(x: unknown): string | null {
  if (typeof x !== 'string' || !x.startsWith('hrn:node:') || !isFlatV2(x)) return null;
  try {
    return parseUrnV2(x).type === 'node' ? x : null;
  } catch {
    return null;
  }
}

function register(x: unknown): TaskWarningRegister | undefined {
  if (!x || typeof x !== 'object') return undefined;
  const r = x as Record<string, unknown>;
  switch (r.state) {
    case 'mapped': {
      const taskUrn = nodeUrn(r.taskUrn);
      const taskLoc = str(r.taskLoc, MAX_TEXT);
      return taskUrn && taskLoc ? { state: 'mapped', taskLoc, taskUrn } : undefined;
    }
    case 'unmapped':
    case 'unresolved':
      return { state: r.state };
    default:
      return undefined;
  }
}

/**
 * The warnings under `path` in a response's `extensions`, in server order.
 *
 * `committed` is provenance, decided before any decoding: it is true when ANY
 * entry names this path, valid or not, because the server files one only
 * after the write committed. A malformed or cut entry changes what is shown,
 * never whether the write is reported as saved.
 */
export function readTaskWarnings(extensions: unknown, path: string): TaskWarnings {
  const raw = extensions && typeof extensions === 'object' ? (extensions as { warnings?: unknown }).warnings : undefined;
  if (!Array.isArray(raw)) return { warnings: [], more: 0, committed: false };
  const ours = raw.filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && (e as { path?: unknown }).path === path);
  const valid: TaskWarning[] = [];
  for (const e of ours) {
    const code = str(e.code, MAX_CODE);
    const text = str(e.text, MAX_TEXT);
    if (!code || !text) continue;
    const reg = register(e.register);
    valid.push(reg ? { code, text, register: reg } : { code, text });
  }
  return {
    warnings: valid.slice(0, MAX_SHOWN_WARNINGS),
    more: Math.max(0, valid.length - MAX_SHOWN_WARNINGS),
    committed: ours.length > 0,
  };
}

/**
 * The sentence a result line adds so a screen reader hears that warnings
 * follow (Uma's P2 on #1216): the list itself mounts with its content, which a
 * live region doesn't announce. Null when there are none.
 */
export function warningsBelow(n: number): string | null {
  if (n <= 0) return null;
  return n === 1 ? t('app.tasks.warnings.below-one', '1 warning below.') : t('app.tasks.warnings.below', '{n} warnings below.', { n });
}
