import { describe, expect, it, vi } from 'vitest';
import { BOOT_COMPILED_QUERY, BOOT_SOURCE_APPROVAL_QUERY, BOOT_SOURCE_QUERY } from './queries';
import { readBootSource } from './boot-source';

const gqlErr = (code: string) => Object.assign(new Error('x'), { response: { errors: [{ message: 'm', extensions: { code } }] } });
const NOT_APPROVED = { state: 'NOT_APPROVED', tone: 'neutral', approval: null, canApprove: true };
const client = (impl: (q: string, v: unknown) => unknown) => ({ request: vi.fn(async (q: string, v: unknown) => impl(q, v)) }) as never;

describe('readBootSource', () => {
  it('a failed pointer read is unknown, never legacy', async () => {
    expect(await readBootSource(client(() => ({})), { ok: false }, 'sys')).toEqual({ mode: 'unknown' });
  });
  it('no pointer is legacy', async () => {
    expect(await readBootSource(client(() => ({ node: null })), { ok: true, ref: null, deleted: null }, 'sys')).toEqual({ mode: 'legacy', canStart: true });
  });
  it('portal#1378: no pointer and no system memory, or a source read that fails, offers no Start', async () => {
    expect(await readBootSource(client(() => ({})), { ok: true, ref: null, deleted: null }, null)).toEqual({ mode: 'legacy', canStart: false });
    for (const code of ['FORBIDDEN', 'MEMORY_NOT_FOUND', 'INTERNAL_SERVER_ERROR']) {
      expect(await readBootSource(client(() => { throw gqlErr(code); }), { ok: true, ref: null, deleted: null }, 'sys')).toEqual({ mode: 'legacy', canStart: false });
    }
  });
  it('portal#1378: a source started for a pointer-less Agent is edited, not offered again, and nothing is served yet', async () => {
    const c = client((q) => q === BOOT_SOURCE_APPROVAL_QUERY ? { node: { id: 'n1', revision: 1, approvalStatus: { state: 'NOT_APPROVED', approval: null } } } : { node: { id: 'n1', urn: 'u', revision: 1, content: 'seed' } });
    expect(await readBootSource(c, { ok: true, ref: null, deleted: null }, 'sys')).toEqual({ mode: 'source', node: { id: 'n1', urn: 'u', memoryId: 'sys', revision: 1, content: 'seed', approval: NOT_APPROVED }, compiled: null, noPointer: true });
  });
  it('reads the source raw at boot:source and the approved revision of the pointed node', async () => {
    const c = client((q) => q === BOOT_SOURCE_QUERY
      ? { node: { id: 'n1', urn: 'u', revision: 3, content: '{{> a:b}}' } }
      : q === BOOT_SOURCE_APPROVAL_QUERY
        ? { node: { id: 'n1', revision: 3, approvalStatus: { state: 'APPROVED', approval: { revision: 3 } } } }
        : { node: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 2, content: 'built', approvalStatus: { state: 'APPROVED', approval: { revision: 2 } }, lintWarnings: null } });
    const v = await readBootSource(c, { ok: true, ref: 'hrn:node:ada:sys:boot:compiled', deleted: false }, 'sys');
    expect(v).toEqual({
      mode: 'source',
      node: { id: 'n1', urn: 'u', memoryId: 'sys', revision: 3, content: '{{> a:b}}', approval: { state: 'APPROVED', tone: 'approved', approval: { revision: 3 }, canApprove: false } },
      compiled: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 2, content: 'built', approvedRevision: 2, pending: false, lint: null },
    });
    expect((c as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(BOOT_SOURCE_APPROVAL_QUERY, { ref: 'n1' });
    expect(BOOT_SOURCE_QUERY).toContain('raw: true');
    expect((c as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(BOOT_SOURCE_QUERY, { ref: 'boot:source', memoryRef: 'sys' });
    expect((c as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(BOOT_COMPILED_QUERY, { ref: 'hrn:node:ada:sys:boot:compiled' });
  });
  it('a missing source node is source-missing; a refused read is source-unreadable; other failures are unknown', async () => {
    const p = { ok: true as const, ref: 'r', deleted: false };
    expect(await readBootSource(client((q) => q === BOOT_SOURCE_QUERY ? { node: null } : { node: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 2, content: 'built', approvalStatus: { state: 'APPROVED', approval: { revision: 2 } }, lintWarnings: null } }), p, 'sys'))
      .toEqual({ mode: 'source-missing', canStart: true, compiled: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 2, content: 'built', approvedRevision: 2, pending: false, lint: null } });
    expect(await readBootSource(client((q) => { if (q === BOOT_COMPILED_QUERY) throw new Error('boom'); return { node: null }; }), p, 'sys')).toEqual({ mode: 'source-missing', canStart: true, compiled: null });
    expect(await readBootSource(client(() => { throw gqlErr('FORBIDDEN'); }), p, 'sys')).toEqual({ mode: 'source-unreadable' });
    expect(await readBootSource(client(() => { throw new Error('boom'); }), p, 'sys')).toEqual({ mode: 'unknown' });
  });
  it('a failed compiled read keeps the editor and drops only the revision number', async () => {
    const c = client((q) => { if (q === BOOT_COMPILED_QUERY) throw new Error('boom'); return { node: { id: 'n', urn: 'u', revision: 1, content: null } }; });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toMatchObject({ mode: 'source', node: { content: '' }, compiled: null });
  });
  it('a withheld source falls back to the compiled node when it is readable (R1 c), and never writes', async () => {
    const c = client((q) => { if (q === BOOT_SOURCE_QUERY) throw gqlErr('FORBIDDEN'); return { node: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 4, content: 'served text', approvalStatus: { state: 'APPROVED', approval: { revision: 3 } }, lintWarnings: null } }; });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toEqual({ mode: 'compiled-only', compiled: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 4, content: 'served text', approvedRevision: 3, pending: false, lint: null } });
    expect((c as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(BOOT_COMPILED_QUERY, { ref: 'r' });
  });
  it('a withheld source and an unreadable compiled node is the cannot-see notice', async () => {
    const c = client((q) => { if (q === BOOT_SOURCE_QUERY) throw gqlErr('FORBIDDEN'); throw gqlErr('FORBIDDEN'); });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toEqual({ mode: 'source-unreadable' });
  });
  it('requests the compiled text and the memory its page lives in', () => {
    expect(BOOT_COMPILED_QUERY).toContain('content');
    expect(BOOT_COMPILED_QUERY).toMatch(/\bmemoryId\b/);
  });
  it('portal#1485: a failed source approval read costs only that status, never the tab', async () => {
    const c = client((q) => {
      if (q === BOOT_SOURCE_APPROVAL_QUERY) throw new Error('boom');
      return q === BOOT_SOURCE_QUERY ? { node: { id: 'n1', urn: 'u', revision: 3, content: 'x' } } : { node: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 2, content: 'built', approvalStatus: { state: 'APPROVED', approval: { revision: 2 } }, lintWarnings: null } };
    });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toMatchObject({ mode: 'source', node: { id: 'n1', approval: { state: 'UNAVAILABLE', approval: null } }, compiled: { approvedRevision: 2 } });
  });
  it('portal#1485: an approval read describing another source revision is CHANGED, never attached to the shown one', async () => {
    // An edit and an approval can land between the source read and the approval read.
    const c = client((q) => q === BOOT_SOURCE_QUERY
      ? { node: { id: 'n1', urn: 'u', revision: 3, content: 'old' } }
      : q === BOOT_SOURCE_APPROVAL_QUERY
        ? { node: { id: 'n1', revision: 4, approvalStatus: { state: 'APPROVED', approval: { revision: 4 } } } }
        : { node: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 2, content: 'built', approvalStatus: { state: 'APPROVED', approval: { revision: 2 } }, lintWarnings: null } });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toMatchObject({
      mode: 'source', node: { revision: 3, content: 'old', approval: { state: 'CHANGED', approval: null, canApprove: false } }, compiled: { approvedRevision: 2 },
    });
  });
  it('portal#1485: an approval read for the shown source revision is kept', async () => {
    const c = client((q) => q === BOOT_SOURCE_QUERY
      ? { node: { id: 'n1', urn: 'u', revision: 4, content: 'new' } }
      : { node: { id: 'n1', revision: 4, approvalStatus: { state: 'APPROVED', approval: { revision: 4 } } } });
    expect(await readBootSource(c, { ok: true, ref: null, deleted: null }, 'sys')).toMatchObject({
      mode: 'source', node: { revision: 4, approval: { state: 'APPROVED', approval: { revision: 4 } } },
    });
  });
  it('portal#1485: a null node or status from the approval read is UNAVAILABLE, not NOT_APPROVED', async () => {
    for (const answer of [{ node: null }, { node: { id: 'n1', revision: 3, approvalStatus: null } }]) {
      const c = client((q) => q === BOOT_SOURCE_APPROVAL_QUERY ? answer : { node: { id: 'n1', urn: 'u', revision: 3, content: 'x' } });
      expect(await readBootSource(c, { ok: true, ref: null, deleted: null }, 'sys')).toMatchObject({ mode: 'source', node: { approval: { state: 'UNAVAILABLE', canApprove: false } } });
    }
  });
  it('portal#1485: the source approval is read by the source node id, raw, and selects no content', () => {
    expect(BOOT_SOURCE_APPROVAL_QUERY).toContain('raw: true');
    expect(BOOT_SOURCE_APPROVAL_QUERY).toContain('approvalStatus { state approval { revision } }');
    // The revision the status describes, so it can be bound to the shown source.
    expect(BOOT_SOURCE_APPROVAL_QUERY).toMatch(/\bid revision approvalStatus\b/);
    expect(BOOT_SOURCE_APPROVAL_QUERY).not.toMatch(/\bcontent\b/);
  });
  it.each(['MEMORY_NOT_FOUND', 'FORBIDDEN'])('the real concealed refusal %s of the source falls back to the readable compiled node', async (code) => {
    const c = client((q) => { if (q === BOOT_SOURCE_QUERY) throw gqlErr(code); return { node: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 4, content: 'served text', approvalStatus: { state: 'APPROVED', approval: { revision: 3 } }, lintWarnings: null } }; });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toMatchObject({ mode: 'compiled-only', compiled: { content: 'served text' } });
  });
  it('MEMORY_NOT_FOUND with an unreadable compiled node is the neutral cannot-see notice, not unknown and not an inferred missing memory', async () => {
    const c = client((q) => { throw gqlErr(q === BOOT_SOURCE_QUERY ? 'MEMORY_NOT_FOUND' : 'NODE_NOT_FOUND'); });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toEqual({ mode: 'source-unreadable' });
  });
  it('a real outage of the source read stays unknown and never tries the fallback', async () => {
    const c = client(() => { throw gqlErr('INTERNAL_SERVER_ERROR'); });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toEqual({ mode: 'unknown' });
    expect((c as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledTimes(1);
  });
  it('a compiled revision that is not approved is pending, and keeps its lint warnings', async () => {
    const lint = { items: [{ kind: 'BROKEN_INCLUDE', position: 4, text: 'x', targetUrn: null, pinnedRevision: null, newerRevision: null, workerField: null }], total: 3, nextCursor: 'c' };
    const c = client((q) => q === BOOT_SOURCE_QUERY ? { node: { id: 'n', urn: 'u', revision: 1, content: '' } } : { node: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 5, content: 'new', approvalStatus: { state: 'SUPERSEDED', approval: { revision: 4 } }, lintWarnings: lint } });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toMatchObject({ compiled: { revision: 5, approvedRevision: 4, pending: true, lint } });
  });
  it('never approved is pending with no approved revision', async () => {
    const c = client((q) => q === BOOT_SOURCE_QUERY ? { node: { id: 'n', urn: 'u', revision: 1, content: '' } } : { node: { id: 'c1', urn: 'cu', memoryId: 'sys', revision: 1, content: 'new', approvalStatus: { state: 'NOT_APPROVED', approval: null }, lintWarnings: null } });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toMatchObject({ compiled: { approvedRevision: null, pending: true, lint: null } });
  });
});
