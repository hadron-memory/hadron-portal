/**
 * portal#1749 B2: causal pins for `loadTemplates` paging (hrn:node:hadronmemory.com:specs:cor:api:120:02 and hrn:node:hadronmemory.com:specs:cor:api:120:04). The fake server hands back
 * SHORT pages (fewer rows than the requested limit) so an offset that does not follow the returned count,
 * or a loop that stops early, cannot hide behind a page size that happens to match.
 */
import { describe, expect, it } from 'vitest';
import { loadTemplates } from './service';
import type { Template } from '$lib/memory-config/types';

const row = (n: number): Template => ({ id: `t${n}`, name: `template-${n}`, description: null, required: false, revision: 1, rules: [] });
/** A server holding `total` rows that answers each request with at most `sizes[call]` of them from `offset`. */
function server(total: number, sizes: number[], reportedTotal: (call: number) => number = () => total) {
  const calls: { offset: number; limit: number; filter: unknown }[] = [];
  const all = Array.from({ length: total }, (_, i) => row(i));
  const request = async (_query: string, vars: { offset: number; limit: number; filter: unknown }) => {
    const call = calls.length;
    calls.push(vars);
    if (call > 12) throw new Error('runaway paging');
    const size = sizes[Math.min(call, sizes.length - 1)];
    return { memoryConfigTemplates: { total: reportedTotal(call), items: all.slice(vars.offset, vars.offset + size) } };
  };
  return { client: { request } as never, calls };
}

describe('portal#1749 B2: template list paging', () => {
  it('advances each offset by the number of rows actually returned and collects every row', async () => {
    const s = server(17, [5, 5, 5, 2]);
    const rows = await loadTemplates(s.client, 'ORGANIZATION', 'org-1');
    expect(s.calls.map(c => c.offset)).toEqual([0, 5, 10, 15]);
    expect(rows.map(r => r.id)).toEqual(Array.from({ length: 17 }, (_, i) => `t${i}`));
    expect(s.calls.every(c => c.limit === 20)).toBe(true);
    expect(s.calls.every(c => JSON.stringify(c.filter) === JSON.stringify({ ownerType: 'ORGANIZATION', ownerRef: 'org-1' }))).toBe(true);
  });
  it('stops as soon as the collected rows reach the total, without a further request', async () => {
    const s = server(10, [5, 5, 5]);
    expect((await loadTemplates(s.client, 'USER', 'u1')).length).toBe(10);
    expect(s.calls).toHaveLength(2);
  });
  it('makes one request for a list that fits in one page', async () => {
    const s = server(3, [20]);
    expect((await loadTemplates(s.client, 'USER', 'u1')).length).toBe(3);
    expect(s.calls).toHaveLength(1);
  });
  it('returns an empty list for an owner with no templates', async () => {
    expect(await loadTemplates(server(0, [20]).client, 'USER', 'u1')).toEqual([]);
  });
  it('refuses, and returns no partial list, when a page comes back empty before the total', async () => {
    // The server claims 12 rows but only ever holds 5, so the second page is empty.
    const s = server(5, [5, 5], () => 12);
    await expect(loadTemplates(s.client, 'USER', 'u1')).rejects.toThrow('Template list is incomplete. Reload to try again.');
    expect(s.calls).toHaveLength(2);
  });
  // Observation of today's behaviour, NOT a guarantee (hrn:node:hadronmemory.com:specs:cor:api:120:02 only promises no drift for a list that
  // does not change while it is being paged): when the reported total shrinks mid-walk the loop trusts the
  // latest total and returns the rows it has.
  it('observation: a total that shrinks between pages ends the walk with the rows already collected', async () => {
    const s = server(20, [5, 5, 5, 5], call => (call === 0 ? 20 : 8));
    expect((await loadTemplates(s.client, 'USER', 'u1')).length).toBe(10);
    expect(s.calls.map(c => c.offset)).toEqual([0, 5]);
  });
});
