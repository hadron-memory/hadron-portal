/**
 * portal#2240 (BLIND delta P2 on #2247): the AI Team (staff) panel must read only payload keys the staff tab's
 * first screen loads. A key some other tab owns (canManageApp, appKeys, …) would be absent when staff opens first,
 * so the panel would render its "not loaded" state as if it were the answer. Reads the panel's own markup and
 * `workerActions`, the one helper it calls, and fails on any owned key outside TAB_READS.staff's groups.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { READ_GROUP_KEYS, TAB_PAYLOAD_KEYS, TAB_READS } from './first-screen';

const source = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');
const between = (from: string, to: string) => {
  const a = source.indexOf(from);
  const b = source.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThan(-1);
  expect(b, to).toBeGreaterThan(a);
  return source.slice(a, b);
};
const owned = (code: string) => [...code.matchAll(/\b(?:tabData|data)\.([A-Za-z]+)/g)].map((m) => m[1]).filter((k) => TAB_PAYLOAD_KEYS.has(k));
const allowed = new Set<string>(TAB_READS.staff.flatMap((g) => READ_GROUP_KEYS[g]));

describe('the staff panel reads only what the staff first screen loads', () => {
  const panel = between('<div id="panel-staff"', 'HUMAN TEAM TAB');
  const actions = between('function workerActions', '\n  }\n');

  it('the panel markup', () => {
    expect(owned(panel).filter((k) => !allowed.has(k))).toEqual([]);
  });
  it('the worker row actions it calls', () => {
    expect(owned(actions).filter((k) => !allowed.has(k))).toEqual([]);
  });
  it('is not vacuous: it sliced the staff panel, and the panel is not the members one', () => {
    expect(panel).toContain('workerActions');
    expect(panel).not.toContain('id="panel-members"');
  });
});
