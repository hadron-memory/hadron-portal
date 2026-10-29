import { describe, expect, it, vi } from 'vitest';
import { BOOT_COMPILED_QUERY, BOOT_SOURCE_QUERY } from './queries';
import { readBootSource } from './boot-source';

const gqlErr = (code: string) => Object.assign(new Error('x'), { response: { errors: [{ message: 'm', extensions: { code } }] } });
const client = (impl: (q: string, v: unknown) => unknown) => ({ request: vi.fn(async (q: string, v: unknown) => impl(q, v)) }) as never;

describe('readBootSource', () => {
  it('a failed pointer read is unknown, never legacy', async () => {
    expect(await readBootSource(client(() => ({})), { ok: false }, 'sys')).toEqual({ mode: 'unknown' });
  });
  it('no pointer is legacy', async () => {
    expect(await readBootSource(client(() => ({})), { ok: true, ref: null, deleted: null }, 'sys')).toEqual({ mode: 'legacy' });
  });
  it('reads the source raw at boot:source and the approved revision of the pointed node', async () => {
    const c = client((q) => q === BOOT_SOURCE_QUERY
      ? { node: { id: 'n1', urn: 'u', revision: 3, content: '{{> a:b}}' } }
      : { node: { urn: 'cu', revision: 2, content: 'built', approvalStatus: { approval: { revision: 2 } } } });
    const v = await readBootSource(c, { ok: true, ref: 'hrn:node:ada:sys:boot:compiled', deleted: false }, 'sys');
    expect(v).toEqual({ mode: 'source', node: { id: 'n1', urn: 'u', revision: 3, content: '{{> a:b}}' }, compiled: { urn: 'cu', revision: 2, content: 'built', approvedRevision: 2 } });
    expect(BOOT_SOURCE_QUERY).toContain('raw: true');
    expect((c as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(BOOT_SOURCE_QUERY, { ref: 'boot:source', memoryRef: 'sys' });
    expect((c as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(BOOT_COMPILED_QUERY, { ref: 'hrn:node:ada:sys:boot:compiled' });
  });
  it('a missing source node is source-missing; a refused read is source-unreadable; other failures are unknown', async () => {
    const p = { ok: true as const, ref: 'r', deleted: false };
    expect(await readBootSource(client(() => ({ node: null })), p, 'sys')).toEqual({ mode: 'source-missing' });
    expect(await readBootSource(client(() => { throw gqlErr('FORBIDDEN'); }), p, 'sys')).toEqual({ mode: 'source-unreadable' });
    expect(await readBootSource(client(() => { throw new Error('boom'); }), p, 'sys')).toEqual({ mode: 'unknown' });
  });
  it('a failed compiled read keeps the editor and drops only the revision number', async () => {
    const c = client((q) => { if (q === BOOT_COMPILED_QUERY) throw new Error('boom'); return { node: { id: 'n', urn: 'u', revision: 1, content: null } }; });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toMatchObject({ mode: 'source', node: { content: '' }, compiled: null });
  });
  it('a withheld source falls back to the compiled node when it is readable (R1 c), and never writes', async () => {
    const c = client((q) => { if (q === BOOT_SOURCE_QUERY) throw gqlErr('FORBIDDEN'); return { node: { urn: 'cu', revision: 4, content: 'served text', approvalStatus: { approval: { revision: 3 } } } }; });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toEqual({ mode: 'compiled-only', compiled: { urn: 'cu', revision: 4, content: 'served text', approvedRevision: 3 } });
    expect((c as { request: ReturnType<typeof vi.fn> }).request).toHaveBeenCalledWith(BOOT_COMPILED_QUERY, { ref: 'r' });
  });
  it('a withheld source and an unreadable compiled node is the cannot-see notice', async () => {
    const c = client((q) => { if (q === BOOT_SOURCE_QUERY) throw gqlErr('FORBIDDEN'); throw gqlErr('FORBIDDEN'); });
    expect(await readBootSource(c, { ok: true, ref: 'r', deleted: false }, 'sys')).toEqual({ mode: 'source-unreadable' });
  });
  it('requests the compiled text', () => { expect(BOOT_COMPILED_QUERY).toContain('content'); });
});
