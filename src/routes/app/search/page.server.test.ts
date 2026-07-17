/**
 * #552 — global search should include node body content by default.
 *
 * The server's `globalSearch` null-field default is intentionally
 * content-blind, so the portal must send an explicit field list for normal
 * sidebar searches while still honoring power-user `field=` URL narrowing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (...args: unknown[]) => mockRequest(...args) }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev(path: string) {
  return {
    url: new URL(path, 'https://portal.example.test'),
    locals: { token: 'tok' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

function emptySearch() {
  return { globalSearch: { hits: [], degraded: [] } };
}

describe('/app/search loader', () => {
  it('includes content in the default globalSearch fields', async () => {
    mockRequest.mockResolvedValueOnce(emptySearch());
    const load = await importLoad();

    await load(ev('/app/search?q=Masterclass'));

    expect(mockRequest).toHaveBeenCalledWith(expect.any(String), {
      query: 'Masterclass',
      entityTypes: null,
      fields: ['urn', 'name', 'description', 'pk', 'content'],
      limit: 50,
    });
  });

  it('honors explicit field URL params as a narrowing override', async () => {
    mockRequest.mockResolvedValueOnce(emptySearch());
    const load = await importLoad();

    await load(ev('/app/search?q=Masterclass&field=name&field=urn'));

    expect(mockRequest).toHaveBeenCalledWith(expect.any(String), {
      query: 'Masterclass',
      entityTypes: null,
      fields: ['name', 'urn'],
      limit: 50,
    });
  });
});
