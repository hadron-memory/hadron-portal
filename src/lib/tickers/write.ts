import { t } from '$lib/i18n/t';

/**
 * portal#1151 (Tickers S7b) — what the create and edit forms send.
 *
 * The reasons this build can offer are the ones `TickerReason` carries today.
 * A create always sends an explicit set (the server's omitted-create default
 * is Proposed, hrn:node:hadronmemory.com:specs:cor:agt:080:01, and "New team chat" is only a UI preselection).
 * An edit sends only the fields the reader changed, so an omitted `reasons`
 * leaves them as they are; the form never sends `enabled`, channels, quiet
 * hours or relevance (no activation control, and those are not edited here).
 *
 * Nothing here decides whether a cadence or a reason is allowed: the server's
 * refusals are the answer, shown as they come.
 */
export const WRITABLE_REASONS = ['READ_TEAM_CHANNEL', 'EVERY_TICK', 'LIVE_CHECK'] as const;
export type WritableReason = (typeof WRITABLE_REASONS)[number];

export type TickerInvalid = { invalid: { field: 'name' | 'cadenceSeconds' | 'reasons' | 'enabled' | 'worker' | 'form'; message: string } };

const GRAPHQL_INT_MAX = 2_147_483_647;

const isWritable = (r: string): r is WritableReason => (WRITABLE_REASONS as readonly string[]).includes(r);

/** The chosen reasons, in the order the form lists them, known values only. */
function chosenReasons(fd: FormData): WritableReason[] {
  const picked = new Set(fd.getAll('reasons').filter((v): v is string => typeof v === 'string'));
  return WRITABLE_REASONS.filter((r) => picked.has(r));
}

const noReasonsMessage = () =>
  t('app.tickers.write.reasons-required', 'Choose at least one reason. A ticker with none never fires.');
const nameMessage = () => t('app.tickers.write.name-required', 'Enter a name.');
const cadenceMessage = () => t('app.tickers.write.cadence-whole', 'Enter a whole number of seconds.');

function parseCadence(raw: string): number | null {
  return /^\d+$/.test(raw) && Number(raw) <= GRAPHQL_INT_MAX ? Number(raw) : null;
}

export function buildCreateInput(
  fd: FormData,
): { input: { name: string; cadenceSeconds: number; reasons: WritableReason[] } } | TickerInvalid {
  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { invalid: { field: 'name', message: nameMessage() } };
  const cadenceSeconds = parseCadence(String(fd.get('cadenceSeconds') ?? '').trim());
  if (cadenceSeconds === null) return { invalid: { field: 'cadenceSeconds', message: cadenceMessage() } };
  const reasons = chosenReasons(fd);
  if (reasons.length === 0) return { invalid: { field: 'reasons', message: noReasonsMessage() } };
  return { input: { name, cadenceSeconds, reasons } };
}

export function buildUpdatePatch(
  fd: FormData,
): { patch: { name?: string; cadenceSeconds?: number; reasons?: WritableReason[] } } | TickerInvalid {
  const patch: { name?: string; cadenceSeconds?: number; reasons?: WritableReason[] } = {};

  const name = String(fd.get('name') ?? '').trim();
  if (!name) return { invalid: { field: 'name', message: nameMessage() } };
  if (name !== String(fd.get('nameWas') ?? '').trim()) patch.name = name;

  const rawCadence = String(fd.get('cadenceSeconds') ?? '').trim();
  const cadenceSeconds = parseCadence(rawCadence);
  if (cadenceSeconds === null) return { invalid: { field: 'cadenceSeconds', message: cadenceMessage() } };
  if (rawCadence !== String(fd.get('cadenceSecondsWas') ?? '').trim()) patch.cadenceSeconds = cadenceSeconds;

  // Only a form that showed the reasons can change them; one that didn't (the
  // ticker carries a value this build can't show) leaves them untouched.
  if (fd.get('reasonsShown') === '1') {
    const reasons = chosenReasons(fd);
    const was = String(fd.get('reasonsWas') ?? '').split(',').filter(isWritable);
    const changed = reasons.length !== was.length || reasons.some((r) => !was.includes(r));
    if (changed) {
      if (reasons.length === 0) return { invalid: { field: 'reasons', message: noReasonsMessage() } };
      patch.reasons = reasons;
    }
  }

  if (Object.keys(patch).length === 0) {
    return { invalid: { field: 'form', message: t('app.tickers.write.nothing-changed', 'Change a value to save.') } };
  }
  return { patch };
}

/*
 * portal#1497 (MCP cut R7a) — the CONTROL forms' intent, parsed strictly. The
 * POST must carry the write's intent itself (review:explicit-mutation-intent):
 * the desired value of `enabled` as a literal true/false, and exactly one
 * worker ref. A missing value, a repeated field, or anything else is invalid
 * and sends nothing — never a default, never a toggle inferred from the page.
 */

/** `enabled` as exactly one `true` or `false`; anything else, or a repeat, is no intent at all. */
export function parseEnabledIntent(fd: FormData): boolean | null {
  const all = fd.getAll('enabled');
  if (all.length !== 1) return null;
  const v = all[0];
  if (v !== 'true' && v !== 'false') return null;
  return v === 'true';
}

/** A worker id or URN: one value, bounded length, and a charset that cannot carry markup or a list. */
const WORKER_REF = /^[A-Za-z0-9._:-]{1,512}$/;

/** Exactly one `worker` value that looks like an id or a URN; anything else names no worker. */
export function parseWorkerRef(fd: FormData): string | null {
  const all = fd.getAll('worker');
  if (all.length !== 1 || typeof all[0] !== 'string') return null;
  const v = all[0];
  return WORKER_REF.test(v) ? v : null;
}

export const enabledInvalidMessage = () =>
  t('app.ticker.controls.enabled-invalid', 'That isn’t a value this control can send. Reload the page and try again.');

export const workerInvalidMessage = () =>
  t('app.ticker.controls.worker-invalid', 'Choose one worker from the list.');
