// portal#1174: the controller that feeds the Nodes tab its extra columns. The
// lifecycle half is the one a server render cannot see: a batch still in flight
// when the list unmounts must not write into state that is gone.
import { describe, expect, it, vi } from 'vitest';
import { captureUnhandledRejections } from '$lib/test/mountComponent';
import { createNodeColumns } from './node-columns.svelte';
import type { NodeColumnRow } from './node-columns';

const row = (id: string): NodeColumnRow => ({
  id, role: null, updatedAt: null, revision: 1, approval: 'NOT_APPROVED', signature: null, agent: null, worker: null,
});
const gate = () => {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
};

describe('createNodeColumns', () => {
  it('asks only for ids it has not asked for, and merges what comes back', async () => {
    const fetchChunk = vi.fn(async (refs: string[]) => ({ rows: refs.map(row), unavailable: [] as string[] }));
    const c = createNodeColumns(fetchChunk);
    await c.ensure(['a', 'b']);
    await c.ensure(['b', 'c']);
    expect(fetchChunk.mock.calls.map(([r]) => r)).toEqual([['a', 'b'], ['c']]);
    expect(Object.keys(c.rows).sort()).toEqual(['a', 'b', 'c']);
    expect(c.failed).toBe(0);
    c.destroy();
  });

  it('a failed batch is counted and can be retried', async () => {
    let fail = true;
    const fetchChunk = vi.fn(async (refs: string[]) => {
      if (fail) throw new Error('nope');
      return { rows: refs.map(row), unavailable: [] as string[] };
    });
    const c = createNodeColumns(fetchChunk);
    await c.ensure(['a']);
    expect(c.failed).toBe(1);
    expect(c.rows['a']).toBeUndefined();
    fail = false;
    await c.retry();
    expect(c.failed).toBe(0);
    expect(c.rows['a']).toBeDefined();
    c.destroy();
  });

  it('ids the server would not return are unavailable, not failed, and retry does not chase them (Gizelle on #1181)', async () => {
    const fetchChunk = vi.fn(async () => ({ rows: [] as NodeColumnRow[], unavailable: ['gone'] }));
    const c = createNodeColumns(fetchChunk);
    await c.ensure(['gone']);
    expect(c.unavailable).toBe(1);
    expect(c.failed).toBe(0);
    await c.retry();
    expect(fetchChunk).toHaveBeenCalledTimes(1);
    expect(c.unavailable).toBe(1);
    c.destroy();
  });

  it('reset forgets what was asked, so the same ids are read again, and drops an older batch that lands late', async () => {
    const g = gate();
    let call = 0;
    const fetchChunk = vi.fn(async (refs: string[]) => {
      const mine = ++call;
      if (mine === 1) await g.p;
      return { rows: refs.map((id) => ({ ...row(id), revision: mine })), unavailable: [] as string[] };
    });
    const c = createNodeColumns(fetchChunk);
    const first = c.ensure(['a']);
    c.reset();
    await c.ensure(['a']);
    expect(fetchChunk).toHaveBeenCalledTimes(2);
    expect(c.rows['a'].revision).toBe(2);
    g.release();
    await first;
    // the pre-reset batch must not overwrite the fresher read
    expect(c.rows['a'].revision).toBe(2);
    c.destroy();
  });

  it('a batch that lands after destroy writes nothing and throws nothing', async () => {
    const g = gate();
    const fetchChunk = vi.fn(async (refs: string[]) => {
      await g.p;
      return { rows: refs.map(row), unavailable: [] as string[] };
    });
    const c = createNodeColumns(fetchChunk);
    const errors = await captureUnhandledRejections(async () => {
      const done = c.ensure(['a']);
      c.destroy();
      g.release();
      await done;
    });
    expect(c.rows['a']).toBeUndefined();
    expect(errors).toEqual([]);
  });

  it('the guard is what keeps that true: without destroy the same batch lands', async () => {
    const g = gate();
    const c = createNodeColumns(async (refs) => {
      await g.p;
      return { rows: refs.map(row), unavailable: [] };
    });
    const done = c.ensure(['a']);
    g.release();
    await done;
    expect(c.rows['a']).toBeDefined();
    c.destroy();
  });

  it('after destroy it asks for nothing more', async () => {
    const fetchChunk = vi.fn(async (refs: string[]) => ({ rows: refs.map(row), unavailable: [] as string[] }));
    const c = createNodeColumns(fetchChunk);
    c.destroy();
    await c.ensure(['a']);
    expect(fetchChunk).not.toHaveBeenCalled();
  });
});
