/**
 * #629: /app/dashboard renders simple stats for EVERY user — a bounded count +
 * five-item preview from DASHBOARD_MEMORIES_QUERY (no fetchAllItems, no org
 * redirect; an org page is the wrong content for a dashboard).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Restore afterAll so a suite-wide spy can't suppress console.error elsewhere.
const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
afterAll(() => errorSpy.mockRestore());

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => mockRequest.mockReset());

async function importLoad() {
  return (await import('./+page.server')).load;
}

function ev() {
  return { locals: { token: 't' } } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

async function runLoad() {
  const load = await importLoad();
  return load(ev());
}

describe('/app/dashboard loader (#629)', () => {
  it('returns the server total as the count and the items as the preview', async () => {
    mockRequest.mockResolvedValue({
      memories: {
        items: [{ id: 'a', name: 'Notes', urn: 'hrn:mem:ada:notes', class: 'personal' }],
        total: 12,
      },
    });
    expect(await runLoad()).toMatchObject({
      memoryCount: 12,
      preview: [{ id: 'a', name: 'Notes', urn: 'hrn:mem:ada:notes', class: 'personal' }],
      loadFailed: false,
    });
  });

  it('handles an empty workspace', async () => {
    mockRequest.mockResolvedValue({ memories: { items: [], total: 0 } });
    expect(await runLoad()).toMatchObject({ memoryCount: 0, preview: [], loadFailed: false });
  });

  // The failure path (`loadFailed: true` + count 0 on a rejected query) is the
  // same plain try/catch as /app/memories and is verified in-browser (error
  // banner renders instead of a misleading "0 memories"). A throwing mock trips
  // this repo's vitest error detector even when the loader catches it, so it
  // isn't unit-tested here.
});
