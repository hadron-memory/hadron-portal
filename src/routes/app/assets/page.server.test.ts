/**
 * portal#696 part 1 — the top-level Files loader.
 *
 * The cases that matter are the ones where a wrong answer is SILENT: an org tab
 * that quietly widens to everything, a window that clips without saying so, a
 * failed query that reads as "no files", and the server's 200-row cap turning a
 * single 500-row request into a truncated one.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ASSETS_QUERY } from '$lib/server/assetQueries';
import { USER_PROFILE_QUERY } from '$lib/server/queries';
import { ALL_ASSETS_DEP } from '$lib/assets/deps';

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
    urn: 'hrn:asset:acme:docs:assets:asset-1',
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

/** Route both documents off one mock so argument order can't make a test lie. */
function respond(
  page: { items: unknown[]; total: number },
  users: Record<string, { id: string; handle: string | null } | null> = {},
) {
  mockRequest.mockImplementation(async (doc: string, vars: Record<string, unknown>) => {
    if (doc === ASSETS_QUERY) return { assets: page };
    if (doc === USER_PROFILE_QUERY) return { user: users[vars.ref as string] ?? null };
    throw new Error(`unexpected document: ${doc.slice(0, 40)}`);
  });
}

function event(tab: string | null, activeOrgId: string | null = 'org-1') {
  return {
    url: new URL(`http://x/app/assets${tab ? `?tab=${tab}` : ''}`),
    locals: { token: 't' },
    parent: async () => ({ activeOrgId }),
    depends: vi.fn(),
  };
}

type Result = {
  tab: string;
  assets: unknown[];
  total: number;
  truncated: boolean;
  failed: boolean;
  noOrg: boolean;
  uploaderNames: Record<string, string>;
};

async function run(ev: ReturnType<typeof event>): Promise<Result> {
  const { load } = await importMod();
  return (await (load as (e: unknown) => Promise<unknown>)(ev)) as Result;
}

/** Variables of the first assets() call. */
function assetVars() {
  return mockRequest.mock.calls.find(([doc]) => doc === ASSETS_QUERY)?.[1] as Record<
    string,
    unknown
  >;
}

describe('top-level assets loader', () => {
  it('declares the invalidation dependency the page refreshes with', async () => {
    respond({ items: [], total: 0 });
    const ev = event('mine');
    await run(ev);
    // A mismatch is silent: invalidate() with an undeclared key is a no-op, so
    // deleting a row would stop refreshing the grid with nothing to notice.
    expect(ev.depends).toHaveBeenCalledWith(ALL_ASSETS_DEP);
  });

  it('sends mine:true for the default tab', async () => {
    respond({ items: [asset()], total: 1 });
    const data = await run(event(null));
    expect(data.tab).toBe('mine');
    expect(assetVars().filter).toEqual({ mine: true });
    expect(assetVars().orgRef).toBeUndefined();
  });

  it('sends neither filter nor orgRef for "available"', async () => {
    respond({ items: [], total: 0 });
    await run(event('available'));
    expect(assetVars().filter).toBeUndefined();
    expect(assetVars().orgRef).toBeUndefined();
  });

  it('scopes "org" to the active org', async () => {
    respond({ items: [], total: 0 });
    await run(event('org', 'org-7'));
    expect(assetVars().orgRef).toBe('org-7');
    expect(assetVars().filter).toBeUndefined();
  });

  it('does NOT query at all for "org" with no active org', async () => {
    // The whole point: omitting orgRef returns everything the caller can reach,
    // which the Organization tab would then mislabel as the org's.
    respond({ items: [asset()], total: 1 });
    const data = await run(event('org', null));
    expect(data.noOrg).toBe(true);
    expect(data.assets).toEqual([]);
    expect(mockRequest.mock.calls.filter(([doc]) => doc === ASSETS_QUERY)).toHaveLength(0);
  });

  it('falls back to the default tab for an unrecognised ?tab', async () => {
    respond({ items: [], total: 0 });
    const data = await run(event('../../etc/passwd'));
    expect(data.tab).toBe('mine');
    expect(assetVars().filter).toEqual({ mine: true });
  });

  it('requests at most 200 per page, since the server clamps there', async () => {
    // A single limit:500 request would be silently clamped to 200 and look like
    // a short page — i.e. a silent cap.
    respond({ items: [], total: 0 });
    await run(event('available'));
    expect(assetVars().limit).toBeLessThanOrEqual(200);
    expect(assetVars().offset).toBe(0);
  });

  it('pages until the window is full, then reports truncation', async () => {
    const full = Array.from({ length: 200 }, (_, i) => asset({ id: `a${i}`, uploadedBy: null }));
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === ASSETS_QUERY) return { assets: { items: full, total: 5000 } };
      throw new Error('unexpected');
    });
    const data = await run(event('available'));
    // WINDOW 500 / PAGE 200 → three requests (200 + 200 + 100).
    expect(mockRequest.mock.calls.filter(([doc]) => doc === ASSETS_QUERY)).toHaveLength(3);
    expect(data.truncated).toBe(true);
    expect(data.total).toBe(5000);
  });

  it('stops on a short page instead of looping', async () => {
    respond({ items: [asset()], total: 1 });
    const data = await run(event('available'));
    expect(mockRequest.mock.calls.filter(([doc]) => doc === ASSETS_QUERY)).toHaveLength(1);
    expect(data.truncated).toBe(false);
  });

  it('resolves uploader handles and skips NULL uploaders', async () => {
    respond(
      { items: [asset(), asset({ id: 'a2', uploadedBy: null })], total: 2 },
      { 'user-1': { id: 'user-1', handle: 'ada' } },
    );
    const data = await run(event('available'));
    expect(data.uploaderNames).toEqual({ 'user-1': '@ada' });
    // A server-authored asset has no user to resolve.
    const refs = mockRequest.mock.calls
      .filter(([doc]) => doc === USER_PROFILE_QUERY)
      .map(([, v]) => (v as { ref: string }).ref);
    expect(refs).toEqual(['user-1']);
  });

  it('survives an uploader lookup that throws', async () => {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === ASSETS_QUERY) return { assets: { items: [asset()], total: 1 } };
      throw new Error('user lookup exploded');
    });
    const data = await run(event('mine'));
    expect(data.failed).toBe(false);
    expect(data.assets).toHaveLength(1);
    expect(data.uploaderNames).toEqual({});
  });

  it('caps uploader lookups and dedupes them', async () => {
    const many = Array.from({ length: 40 }, (_, i) => asset({ id: `a${i}`, uploadedBy: `u${i}` }));
    many.push(asset({ id: 'dup', uploadedBy: 'u0' }));
    respond({ items: many, total: many.length });
    await run(event('available'));
    const refs = mockRequest.mock.calls
      .filter(([doc]) => doc === USER_PROFILE_QUERY)
      .map(([, v]) => (v as { ref: string }).ref);
    expect(refs).toHaveLength(25);
    expect(new Set(refs).size).toBe(25);
  });

  it('flags a failed query rather than returning a silently empty list', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    const data = await run(event('available'));
    expect(data.failed).toBe(true);
    expect(data.assets).toEqual([]);
    expect(data.truncated).toBe(false);
    expect(data.noOrg).toBe(false);
  });

  it('keeps the requested tab on the failure path, so the strip stays correct', async () => {
    mockRequest.mockRejectedValue(new Error('boom'));
    expect((await run(event('org', 'org-1'))).tab).toBe('org');
  });
});
