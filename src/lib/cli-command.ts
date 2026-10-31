/**
 * portal#1496 (MCP cut P1): the hadron CLI commands a page offers for a change
 * the portal does not make yet. Built in code so the identifier never enters a
 * `t()` string; the page's sentence ("To turn it off:") is the translated part.
 *
 * Spellings follow released hadron-cli v0.32.1 help (`ticker update|subscribe|
 * unsubscribe`, `team wake-settings set`).
 */

const BARE = /^[A-Za-z0-9:._-]+$/;

/** A shell word for `value`: bare when it is plainly safe, otherwise POSIX single-quoted. */
export function shellArg(value: string): string {
  return BARE.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The ref a command names: the URN, else the id, else none (never an empty operand). */
export function cliRef(entity: { urn?: string | null; id?: string | null }): string | null {
  return entity.urn || entity.id || null;
}

export interface TickerCommands {
  off: string;
  on: string;
  subscribe: string;
  unsubscribe: string;
}

export function tickerCommands(ref: string): TickerCommands {
  const r = shellArg(ref);
  return {
    off: `hadron ticker update ${r} --enabled=false`,
    on: `hadron ticker update ${r} --enabled`,
    subscribe: `hadron ticker subscribe ${r} --worker <worker-id-or-URN>`,
    unsubscribe: `hadron ticker unsubscribe ${r} --worker <worker-id-or-URN>`,
  };
}

export interface WakeCommands {
  mentionsOff: string;
  mentionsImmediate: string;
  clearPause: string;
  pauseUntil: string;
}

/** `wake-settings set` requires at least one setting, so each command carries one. */
export function wakeCommands(ref: string): WakeCommands {
  const base = `hadron team wake-settings set --worker ${shellArg(ref)}`;
  return {
    mentionsOff: `${base} --mentions off`,
    mentionsImmediate: `${base} --mentions immediate`,
    clearPause: `${base} --clear-pause`,
    pauseUntil: `${base} --paused-until <RFC3339>`,
  };
}
