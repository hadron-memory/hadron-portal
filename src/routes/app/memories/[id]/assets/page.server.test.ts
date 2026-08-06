/**
 * portal#696 — the per-memory Assets tab loader.
 *
 * The cases worth pinning are the ones that were wrong or absent server-side
 * before #888, and the ones a happy-path fixture hides: a NULL uploader
 * (server-authored, hadron_store_file), an uploader the caller may not resolve,
 * and a query failure that must stay distinguishable from "no files".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMORY_ASSETS_QUERY } from '$lib/server/assetQueries';
import { USER_PROFILE_QUERY } from '$lib/server/queries';
import { MEMORY_ASSETS_DEP } from '$lib/assets/deps';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

async function importMod() {
  return import('./+page.server');
}

function asset(over: Record<string, unknown> = {}) {
  return {
    id: 'asset-1',
    memoryId: 'mem-1',
    urn: 'hrn:asset:acme:mem-1:asset-1',
    filename: 'notes.md',
    mimeType: 'text/markdown',
    sizeBytes: 1024,
    uploadedAt: '2026-08-01T10:00:00.000Z',
    uploadedBy: 'user-1',
    scanStatus: 'CLEAN',
    description: null,
    publicUrl: null,
    ...over,
  };
}

/** Route both documents off ONE mock, so argument order can't make a test lie. */
function respond(
  page: { assets: unknown[]; total: number; hasMore: boolean },
  users: Record<string, { id: string; handle: string | null } | null> = {},
) {
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, unknown>) => {
    if (doc === MEMORY_ASSETS_QUERY) return { memoryAssets: page };
    if (doc === USER_PROFILE_QUERY) return { user: users[vars.ref as string] ?? null };
    throw new Error(`unexpected document: ${doc.slice(0, 40)}`);
  });
}

const event = { params: { id: 'mem-1' }, locals: { token: 't' }, depends: vi.fn() };

describe('memory assets loader', () => {
  it('declares the scoped invalidation dependency the page re-runs it with', async () => {
    respond({ assets: [], total: 0, hasMore: false });
    const { load } = await importMod();
    await (load as (e: unknown) => Promise<unknown>)({ ...event, depends: event.depends });
    // A mismatch here is silent at runtime: invalidate() with a key no loader
    // declared is a no-op, so the grid would just stop refreshing.
    expect(event.depends).toHaveBeenCalledWith(MEMORY_ASSETS_DEP);
  });

  it('returns the window and resolves uploader handles', async () => {
    respond({ assets: [asset()], total: 1, hasMore: false }, { 'user-1': { id: 'user-1', handle: 'ada' } });
    const { load } = await importMod();
    const data = (await (load as (e: unknown) => Promise<Record<string, unknown>>)(event)) as {
      assets: unknown[];
      total: number;
      truncated: boolean;
      failed: boolean;
      uploaderNames: Record<string, string>;
    };
    expect(data.assets).toHaveLength(1);
    expect(data.total).toBe(1);
    expect(data.failed).toBe(false);
    expect(data.uploaderNames).toEqual({ 'user-1': '@ada' });
  });

  it('never looks up a NULL uploader — a server-authored asset has no user', async () => {
    respond({ assets: [asset({ uploadedBy: null })], total: 1, hasMore: false });
    const { load } = await importMod();
    await (load as (e: unknown) => Promise<unknown>)(event);
    const userCalls = mockRequest.mock.calls.filter(([doc]) => doc === USER_PROFILE_QUERY);
    expect(userCalls).toHaveLength(0);
  });

  it('leaves an unresolvable uploader out rather than blanking the list', async () => {
    // `user(ref:)` returns null when the caller may not see that user — denied
    // and missing are indistinguishable by design, so this is expected, and the
    // grid falls back to showing the id.
    respond({ assets: [asset()], total: 1, hasMore: false }, { 'user-1': null });
    const { load } = await importMod();
    const data = (await (load as (e: unknown) => Promise<Record<string, unknown>>)(event)) as {
      assets: unknown[];
      uploaderNames: Record<string, string>;
    };
    expect(data.assets).toHaveLength(1);
    expect(data.uploaderNames).toEqual({});
  });

  it('survives an uploader lookup that throws', async () => {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === MEMORY_ASSETS_QUERY) {
        return { memoryAssets: { assets: [asset()], total: 1, hasMore: false } };
      }
      throw new Error('user lookup exploded');
    });
    const { load } = await importMod();
    const data = (await (load as (e: unknown) => Promise<Record<string, unknown>>)(event)) as {
      assets: unknown[];
      failed: boolean;
      uploaderNames: Record<string, string>;
    };
    expect(data.failed).toBe(false);
    expect(data.assets).toHaveLength(1);
    expect(data.uploaderNames).toEqual({});
  });

  it('dedupes uploader lookups and caps the fan-out', async () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      asset({ id: `asset-${i}`, uploadedBy: `user-${i}` }),
    );
    // Two more assets sharing an already-seen uploader — dedupe must not spend
    // lookups on them.
    many.push(asset({ id: 'asset-dup-1', uploadedBy: 'user-0' }));
    many.push(asset({ id: 'asset-dup-2', uploadedBy: 'user-0' }));
    respond({ assets: many, total: many.length, hasMore: false });
    const { load } = await importMod();
    await (load as (e: unknown) => Promise<unknown>)(event);
    const refs = mockRequest.mock.calls
      .filter(([doc]) => doc === USER_PROFILE_QUERY)
      .map(([, vars]) => (vars as { ref: string }).ref);
    expect(refs).toHaveLength(25);
    expect(new Set(refs).size).toBe(25);
  });

  it('reports truncation when the window clips the total', async () => {
    respond({ assets: [asset()], total: 900, hasMore: true });
    const { load } = await importMod();
    const data = (await (load as (e: unknown) => Promise<Record<string, unknown>>)(event)) as {
      truncated: boolean;
      total: number;
    };
    expect(data.truncated).toBe(true);
    expect(data.total).toBe(900);
  });

  it('flags a failed query instead of returning a silently empty list', async () => {
    // review:no-silent-loader-catch — an empty `assets` alone reads as "this
    // memory has no files", which has masked real server errors in this repo.
    mockRequest.mockRejectedValue(new Error('boom'));
    const { load } = await importMod();
    const data = (await (load as (e: unknown) => Promise<Record<string, unknown>>)(event)) as {
      assets: unknown[];
      failed: boolean;
      truncated: boolean;
    };
    expect(data.failed).toBe(true);
    expect(data.assets).toEqual([]);
    expect(data.truncated).toBe(false);
  });

  it('asks for the memory-wide list, not just the caller’s own uploads', async () => {
    // #888 widened the gate off uploader identity; passing `mine` here would
    // re-impose exactly the scoping that made a colleague's (and every
    // run-created) file invisible.
    respond({ assets: [], total: 0, hasMore: false });
    const { load } = await importMod();
    await (load as (e: unknown) => Promise<unknown>)(event);
    const [, vars] = mockRequest.mock.calls.find(([doc]) => doc === MEMORY_ASSETS_QUERY)!;
    expect((vars as { mine?: boolean }).mine).toBeUndefined();
    expect((vars as { memoryId: string }).memoryId).toBe('mem-1');
  });
});
