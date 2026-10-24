// portal#1174: the Nodes tab's extra columns (Role, Last changed, Changed by,
// Revision, Approved, Signed) are read lazily in batches through
// /api/nodes/columns, never added to the shared layout payload.
import { describe, expect, it, vi } from 'vitest';
import {
  COLUMN_BATCH,
  approvedCellText,
  changedByView,
  chunkIds,
  loadNodeColumns,
  signedCellText,
  type NodeColumnRow,
} from './node-columns';

const row = (id: string, over: Partial<NodeColumnRow> = {}): NodeColumnRow => ({
  id, role: null, updatedAt: '2026-10-20T10:00:00Z', revision: 3, approval: 'NOT_APPROVED', signature: null,
  agent: null, worker: null, ...over,
});

describe('chunkIds', () => {
  it('splits at the server batch cap, keeping order', () => {
    const ids = Array.from({ length: COLUMN_BATCH * 2 + 5 }, (_, i) => `n${i}`);
    const chunks = chunkIds(ids);
    expect(chunks.map((c) => c.length)).toEqual([COLUMN_BATCH, COLUMN_BATCH, 5]);
    expect(chunks.flat()).toEqual(ids);
  });
  it('gives no chunks for no ids', () => expect(chunkIds([])).toEqual([]));
  it('the cap is the server nodeBatch cap', () => expect(COLUMN_BATCH).toBe(200));
});

describe('loadNodeColumns', () => {
  it('merges every chunk into one map and reports progress', async () => {
    const ids = Array.from({ length: COLUMN_BATCH + 1 }, (_, i) => `n${i}`);
    const fetchChunk = vi.fn(async (refs: string[]) => ({ rows: refs.map((r) => row(r)), unavailable: [] as string[] }));
    const progress: number[] = [];
    const out = await loadNodeColumns(ids, fetchChunk, { onProgress: (done) => progress.push(done) });
    expect(Object.keys(out.rows)).toHaveLength(ids.length);
    expect(out.failed).toBe(0);
    expect(progress).toEqual([COLUMN_BATCH, COLUMN_BATCH + 1]);
  });

  it('a failed chunk is reported, not hidden, and the other chunks still land', async () => {
    const ids = Array.from({ length: COLUMN_BATCH + 3 }, (_, i) => `n${i}`);
    const fetchChunk = vi.fn(async (refs: string[]) => {
      if (refs[0] === 'n0') throw new Error('boom');
      return { rows: refs.map((r) => row(r)), unavailable: [] as string[] };
    });
    const out = await loadNodeColumns(ids, fetchChunk, {});
    expect(out.failed).toBe(COLUMN_BATCH);
    expect(Object.keys(out.rows)).toHaveLength(3);
    expect(out.rows['n0']).toBeUndefined();
  });

  it('ids the server could not return stay absent and are counted', async () => {
    const out = await loadNodeColumns(['a', 'b'], async () => ({ rows: [row('a')], unavailable: ['b'] }), {});
    expect(Object.keys(out.rows)).toEqual(['a']);
    expect(out.unavailable).toBe(1);
  });

  it('ids the server omitted to stay under its size cap count as failed, not absent', async () => {
    const out = await loadNodeColumns(['a', 'b'], async () => ({ rows: [row('a')], unavailable: [], omitted: ['b'] }), {});
    expect(out.failed).toBe(1);
    expect(out.unavailable).toBe(0);
  });

  it('stops asking once aborted', async () => {
    const ids = Array.from({ length: COLUMN_BATCH * 3 }, (_, i) => `n${i}`);
    const ctl = new AbortController();
    const fetchChunk = vi.fn(async (refs: string[]) => {
      ctl.abort();
      return { rows: refs.map((r) => row(r)), unavailable: [] as string[] };
    });
    await loadNodeColumns(ids, fetchChunk, { signal: ctl.signal });
    expect(fetchChunk).toHaveBeenCalledTimes(1);
  });
});

describe('cell text', () => {
  it('Approved uses the shared approval wording and is blank until loaded', () => {
    expect(approvedCellText(row('a', { approval: 'APPROVED' }))).toBe('Approved');
    expect(approvedCellText(row('a', { approval: 'SUPERSEDED' }))).toBe('Content changed since approval');
    expect(approvedCellText(row('a', { approval: 'NOT_APPROVED' }))).toBe('Not approved');
    expect(approvedCellText(undefined)).toBe('');
    expect(approvedCellText(row('a', { approval: null }))).toBe('');
  });

  it('Signed says Signed only for a current signature and never invents "Not signed"', () => {
    expect(signedCellText(row('a', { signature: 'CURRENT' }))).toBe('Signed');
    expect(signedCellText(row('a', { signature: 'EARLIER' }))).toBe('Signed an earlier version');
    expect(signedCellText(row('a', { signature: null }))).toBe('');
    expect(signedCellText(undefined)).toBe('');
  });

  it('Changed by shows the worker and agent behind the last edit, absent when neither', () => {
    const worker = { id: 'w', name: 'Gil', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:gil' };
    const agent = { id: 'a', name: 'Portal Engineer', urn: 'hrn:agent:hadronmemory.com:portal-engineer' };
    const v = changedByView(row('n', { worker, agent }));
    expect(v.worker).toEqual(worker);
    expect(v.agent).toEqual(agent);
    expect(v.searchText).toContain('Gil');
    expect(v.searchText).toContain(agent.urn);
    expect(changedByView(row('n')).searchText).toBe('');
    expect(changedByView(undefined).worker).toBeNull();
  });
});

it('Changed by preserves the human beside worker and agent; null stays unknown', () => {
  const user = { handle: 'rae', urn: 'hrn:user:acme.com:rae' };
  const worker = { id: 'w', name: 'George', urn: 'hrn:worker:acme.com:team:george' };
  const agent = { id: 'a', name: 'Engineer', urn: 'hrn:agent:acme.com:engineer' };
  expect(changedByView(row('n', { user, worker, agent }))).toMatchObject({ user, worker, agent });
  expect(changedByView(row('n', { user })).searchText).toContain(user.urn);
  expect(changedByView(row('n', { user: null })).user).toBeNull();
  expect(changedByView(undefined).user).toBeNull();
});
