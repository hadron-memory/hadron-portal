import { tick } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { readbackAfterWrite } from '$lib/readback-after-write';

/**
 * What a control knows about a write the server COMMITTED but whose reload has
 * not been confirmed (portal#2195), kept apart from the control's lifetime.
 *
 * The control that sent the write can be torn down (a tab switch that
 * conditionally renders it) or pointed at another owner (A -> B -> A) before the
 * outcome is settled, and a local `$state` then forgets the write while the
 * loader still shows the old value. So the entry is keyed by the thing written
 * to (`<control>:<owner id>`), survives any component, and is dropped only when
 * the loader shows the value the server confirmed.
 *
 *  - `inflight`: submitted, no answer yet. Held from submission so a remount or
 *    A -> B -> A cannot open a second write on the same owner (blind delta F5).
 *  - `pending`: the reload is in flight.
 *  - `stale`: the reload failed, hung, or could not be confirmed. The control
 *    keeps showing `value`, locks further writes and warns the page may be old.
 */
export type WriteRecovery = {
  value: string;
  phase: 'inflight' | 'pending' | 'stale';
  token: number;
  /** The write got no answer from the server (transport failure): it may or may not have committed. */
  uncertain: boolean;
};

const entries = new SvelteMap<string, WriteRecovery>();
let nextToken = 0;

export const recoveryOf = (key: string): WriteRecovery | undefined => entries.get(key);
export const clearRecovery = (key: string): void => { entries.delete(key); };
/** For tests: forget every recovery so one case cannot leak into the next. */
export const resetWriteRecovery = (): void => { entries.clear(); };

/** Lock `key` from submission. The token is how this operation's later callbacks prove the entry is still theirs. */
export function beginWrite(key: string, value: string): number {
  const token = ++nextToken;
  entries.set(key, { value, phase: 'inflight', token, uncertain: false });
  return token;
}
/** The write was refused or never committed: release the lock, unless a newer operation owns the entry. */
export function failWrite(key: string, token: number): void {
  if (entries.get(key)?.token === token) entries.delete(key);
}
const advance = (key: string, token: number, value: string, phase: WriteRecovery['phase'], uncertain: boolean): boolean => {
  if (entries.get(key)?.token !== token) return false;
  entries.set(key, { value, phase, token, uncertain });
  return true;
};

/**
 * Settle a write the server COMMITTED, for the control that sent it, or one whose outcome is
 * UNKNOWN (`uncertain`: no answer came back). Either way the owner stays locked until the loader
 * shows `value`; an uncertain one is never described as saved.
 *
 * `shownNow()` is the loader's value for that owner while the owner is on
 * screen and `undefined` when it is not. A write whose owner has been left, or
 * returned to, before the answer arrived cannot be confirmed by a reload of the
 * page now shown, so it is recorded `stale` and waits for the loader to show
 * `value` (or for the person to reload). Otherwise the reload is awaited and a
 * loader that still shows something else after it is `stale` too.
 */
export async function settleCommittedWrite(key: string, token: number, value: string, ownerShown: boolean, shownNow: () => string | undefined, uncertain = false): Promise<void> {
  if (!ownerShown) { advance(key, token, value, 'stale', uncertain); return; }
  if (!advance(key, token, value, 'pending', uncertain)) return;
  const landed = await readbackAfterWrite();
  if (landed) {
    await tick();
    if (shownNow() === value) { if (entries.get(key)?.token === token) clearRecovery(key); return; }
  }
  advance(key, token, value, 'stale', uncertain);
}

/**
 * Whether an action result leaves the write's outcome UNKNOWN: the request itself failed
 * (`error`), or the portal's action could not reach the server and said so (`uncertain`).
 * A refusal or a GraphQL error response is a definite "did not commit" and is not this.
 */
export function isUncertainResult(result: { type: string; data?: unknown }): boolean {
  return result.type === 'error' || (result.type === 'failure' && (result.data as { uncertain?: boolean } | undefined)?.uncertain === true);
}
