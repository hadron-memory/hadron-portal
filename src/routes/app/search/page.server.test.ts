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
  gqlClient: vi.fn(() => ({ request: (...args: unknown[]) => mockRequest(...args) })),
}));

beforeEach(() => {
  vi.clearAllMocks();
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

// portal#1946: consume the server task kind and resolve its canonical App only on click.
describe('task search results', () => {
  it('honors type=agentTask and keeps the server title and handle unchanged', async () => {
    const hit = { entityType: 'agentTask', id: 'task-id', urn: null, name: 'Repair the importer', handle: 'AT0.6508', description: null, matchedField: 'name', score: 9, memoryId: null, organizationId: null };
    mockRequest.mockResolvedValueOnce({ globalSearch: { hits: [hit], degraded: [] } });
    const data = await (await importLoad())(ev('/app/search?q=AT0.6508&type=agentTask'));
    expect(mockRequest.mock.calls[0][1].entityTypes).toEqual(['agentTask']);
    expect(data).toMatchObject({ result: { hits: [hit] } });
  });
  it('opens a selected task using the viewer-scoped lookup and the returned App/id, with no search or guessed URN', async () => {
    mockRequest.mockResolvedValueOnce({ agentTask: { id: 'task-id', appId: 'app-id' } });
    await expect((await importLoad())(ev('/app/search?task=task-id'))).rejects.toMatchObject({ status: 307, location: '/app/apps/app-id/tasks/task-id' });
    const { gqlClient } = await import('$lib/server/api');
    expect(gqlClient).toHaveBeenCalledWith('tok');
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0][1]).toEqual({ id: 'task-id' });
  });
  it('a missing or no-longer-readable task is the same neutral 404', async () => {
    mockRequest.mockResolvedValueOnce({ agentTask: null });
    await expect((await importLoad())(ev('/app/search?task=missing'))).rejects.toMatchObject({ status: 404 });
  });
  // portal#2177: a schema-violating 200 success is a failure, never a 404 and never a redirect built from a missing appId.
  describe('a schema-violating success is a failure', () => {
    const isHttpErrorOrRedirect = (e: unknown) => typeof e === 'object' && e !== null && ('status' in e || 'location' in e);
    for (const [name, payload] of [
      ['data without the agentTask key', {}],
      ['a task without appId', { agentTask: { id: 'task-id' } }],
      ['a task with an empty appId', { agentTask: { id: 'task-id', appId: '' } }],
      ['a task with a non-string appId', { agentTask: { id: 'task-id', appId: 7 } }],
      ['a task without id', { agentTask: { appId: 'app-1' } }],
      ['a task with an empty id', { agentTask: { id: '', appId: 'app-1' } }],
      ['a task that is not an object', { agentTask: 'task-id' }],
    ] as const) {
      it(`${name} throws a plain failure: no 404, no redirect`, async () => {
        mockRequest.mockResolvedValueOnce(payload);
        const failure = await Promise.resolve((await importLoad())(ev('/app/search?task=task-id'))).catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(Error);
        expect(isHttpErrorOrRedirect(failure)).toBe(false);
      });
    }
  });
  it('does not require the returned id to equal ?task=: a short handle resolves to the real id', async () => {
    mockRequest.mockResolvedValueOnce({ agentTask: { id: 'real-id', appId: 'app-1' } });
    await expect((await importLoad())(ev('/app/search?task=AT0.6508'))).rejects.toMatchObject({ status: 307, location: '/app/apps/app-1/tasks/real-id' });
  });
  it('encodes the returned appId and id as before', async () => {
    mockRequest.mockResolvedValueOnce({ agentTask: { id: 'a/b', appId: 'c d' } });
    await expect((await importLoad())(ev('/app/search?task=x'))).rejects.toMatchObject({ status: 307, location: '/app/apps/c%20d/tasks/a%2Fb' });
  });
  it('a task lookup outage stays an outage, never a false not-found', async () => {
    const fault = new Error('transport failure'); mockRequest.mockRejectedValueOnce(fault);
    await expect((await importLoad())(ev('/app/search?task=task-id'))).rejects.toBe(fault);
  });
});
