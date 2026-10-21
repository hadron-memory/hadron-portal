/**
 * portal#1148 (hadron-server#2089) — a roster the server WITHHOLDS is not an
 * empty roster.
 *
 * For an owner-role member of a user-owned App the server returns `null` for
 * `App.members`, `memberCount`, `appAgents`, `agents` and `hasAiApiKey`
 * (`Agent.hasAiApiKey` is unchanged): the viewer may manage the App's keys but
 * is not entitled to those children. `null` therefore means WITHHELD / unknown.
 * It never means "no members", "No agents", a count of 0 or a missing AI
 * configuration, and it is distinct from a FAILED read (which a reload can
 * fix). A real `[]` or `0` from an authorized owner is a known-empty answer and
 * keeps its existing empty copy.
 *
 * `undefined` (a partial payload that never selected the field) is NOT
 * withheld: only an explicit `null` is. The types make every consumer handle
 * `null`; they cannot make a hand-built fixture select a field.
 */
export type Roster<T> = { kind: 'ok'; items: T[] } | { kind: 'withheld' };

export function rosterOf<T>(value: readonly T[] | null | undefined): Roster<T> {
  return value === null ? { kind: 'withheld' } : { kind: 'ok', items: [...(value ?? [])] };
}

/** A count: a number only from a real answer; `null` stays `null`, never 0. */
export function countOf(value: number | null | undefined): number | null {
  return typeof value === 'number' ? value : null;
}
