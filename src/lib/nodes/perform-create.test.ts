import { describe, expect, it, vi } from 'vitest';
import { performCreate, type UpsertNodeFn } from './perform-create';

function fakeUpsert(override?: Partial<{ id: string; loc: string }>): UpsertNodeFn {
  return vi.fn(async ({ loc }) => ({ id: override?.id ?? 'node-id-123', loc: override?.loc ?? loc }));
}

describe('performCreate', () => {
  it('happy path: derives loc, calls upsertNode, returns success', async () => {
    const upsertNode = fakeUpsert();
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'projects:alpha', title: 'New Idea', type: 'info' },
      { existingLocs: new Set(['projects:alpha']), upsertNode },
    );
    expect(result).toEqual({ ok: true, createdLoc: 'projects:alpha:new-idea', createdNodeId: 'node-id-123' });
    expect(upsertNode).toHaveBeenCalledWith({
      memoryId: 'm1',
      loc: 'projects:alpha:new-idea',
      name: 'New Idea',
      nodeType: 'info',
    });
  });

  it('top-level (empty parent) creates a bare-slug loc', async () => {
    const upsertNode = fakeUpsert();
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: '', title: 'Top Level', type: 'info' },
      { existingLocs: new Set(), upsertNode },
    );
    expect(result.ok).toBe(true);
    expect(upsertNode).toHaveBeenCalledWith(expect.objectContaining({ loc: 'top-level' }));
  });

  it('suffix-bumps loc on sibling collision', async () => {
    const upsertNode = fakeUpsert();
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: 'Idea', type: 'info' },
      { existingLocs: new Set(['p:idea', 'p:idea-2']), upsertNode },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.createdLoc).toBe('p:idea-3');
  });

  it('trims the title before validation and persistence', async () => {
    const upsertNode = fakeUpsert();
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: '  Spaced  ', type: 'info' },
      { existingLocs: new Set(), upsertNode },
    );
    expect(result.ok).toBe(true);
    expect(upsertNode).toHaveBeenCalledWith(expect.objectContaining({ name: 'Spaced', loc: 'p:spaced' }));
  });

  it('rejects empty title with titleRequired', async () => {
    const upsertNode = fakeUpsert();
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: '   ', type: 'info' },
      { existingLocs: new Set(), upsertNode },
    );
    expect(result).toEqual({ ok: false, error: 'titleRequired' });
    expect(upsertNode).not.toHaveBeenCalled();
  });

  it('rejects title that slugs to nothing with titleEmptySlug', async () => {
    const upsertNode = fakeUpsert();
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: '!!!', type: 'info' },
      { existingLocs: new Set(), upsertNode },
    );
    expect(result).toEqual({ ok: false, error: 'titleEmptySlug' });
    expect(upsertNode).not.toHaveBeenCalled();
  });

  it('rejects empty type with typeRequired', async () => {
    const upsertNode = fakeUpsert();
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: 'OK', type: '' },
      { existingLocs: new Set(), upsertNode },
    );
    expect(result).toEqual({ ok: false, error: 'typeRequired' });
    expect(upsertNode).not.toHaveBeenCalled();
  });

  it('rejects MCP-layer guided types not in the constitutional catalog', async () => {
    const upsertNode = fakeUpsert();
    for (const type of ['task', 'data', 'chat', 'plan']) {
      const result = await performCreate(
        { memoryId: 'm1', parentLoc: 'p', title: 'OK', type },
        { existingLocs: new Set(), upsertNode },
      );
      expect(result).toEqual({ ok: false, error: 'invalidType' });
    }
    expect(upsertNode).not.toHaveBeenCalled();
  });

  it('classifies a write-access error from upsertNode as permissionDenied', async () => {
    const upsertNode: UpsertNodeFn = vi.fn(async () => {
      throw new Error('No write access on this memory');
    });
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: 'OK', type: 'info' },
      { existingLocs: new Set(), upsertNode },
    );
    expect(result).toEqual({ ok: false, error: 'permissionDenied' });
  });

  it('classifies a transport / unknown error as network', async () => {
    const upsertNode: UpsertNodeFn = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: 'OK', type: 'info' },
      { existingLocs: new Set(), upsertNode },
    );
    expect(result).toEqual({ ok: false, error: 'network' });
  });

  it('returns locCollisionExhausted when the suffix range is full', async () => {
    const taken = new Set<string>(['p:idea']);
    for (let n = 2; n <= 99; n++) taken.add(`p:idea-${n}`);
    const upsertNode = fakeUpsert();
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: 'Idea', type: 'info' },
      { existingLocs: taken, upsertNode },
    );
    expect(result).toEqual({ ok: false, error: 'locCollisionExhausted' });
    expect(upsertNode).not.toHaveBeenCalled();
  });

  it('preserves the server-returned loc in the success result (when it differs)', async () => {
    // Defensive: if server overrides loc somehow, surface what was actually written.
    const upsertNode: UpsertNodeFn = vi.fn(async () => ({ id: 'n1', loc: 'p:server-decided-loc' }));
    const result = await performCreate(
      { memoryId: 'm1', parentLoc: 'p', title: 'Hello', type: 'info' },
      { existingLocs: new Set(), upsertNode },
    );
    expect(result).toEqual({ ok: true, createdLoc: 'p:server-decided-loc', createdNodeId: 'n1' });
  });
});
