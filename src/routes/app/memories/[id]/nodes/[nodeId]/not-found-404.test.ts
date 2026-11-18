import { beforeEach, describe, expect, it, vi } from 'vitest';

// No NODE_BY_ID_QUERY import: every request in this file resolves `{ node: null }`
// regardless of the document, because the null is the whole subject. Discriminating
// on the query would pin which document asks — that is covered elsewhere — and here
// it would only add a way for the mock to fall through and return undefined.
const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
});

/**
 * Run a loader expecting it to THROW, and hand back what it threw.
 *
 * A returning load is a test failure, not a pass: the whole point is that these
 * routes refuse rather than render, and a load that returned would sail past a
 * bare `.catch()` assertion. Mirrors `expectError` in
 * `src/routes/app/u/[urn]/page.server.test.ts`.
 */
async function expectThrow(
  load: (event: unknown) => unknown,
  event: unknown,
): Promise<{ status?: number; body?: { message?: string } }> {
  try {
    await load(event);
  } catch (e) {
    return e as { status?: number; body?: { message?: string } };
  }
  throw new Error('Expected load to throw, but it returned normally');
}

function event(nodeId = 'no-such-node') {
  return {
    params: { id: 'mem-1', nodeId },
    locals: { token: 'tok' },
    url: new URL(`http://localhost/app/memories/mem-1/nodes/${nodeId}`),
    parent: vi.fn().mockResolvedValue({
      graphNodes: [], graph: { id: 'mem-1', urn: 'hrn:mem:acme.com:notes' },
      isConsumerMode: false, activeOrgId: 'org-1',
    }),
  };
}

// #790. `node(ref:)` returns null both for "no such id" and for "exists but you
// may not read it" — that collapse is the existence-hiding the server gate is
// specified to produce. These routes used to answer it with a bare
// `throw new Error`, which SvelteKit renders as 500.
//
// Two things were wrong with that, and the second is why this is pinned rather
// than just fixed:
//
//   - A 500 tells the user the PORTAL is broken. Someone following a stale or
//     shared link to a deleted node reports an outage rather than a dead link.
//   - A 500 here and a 404 elsewhere is a DIFFERENT observable response for the
//     two cases the null is meant to make indistinguishable, handing the
//     distinction back to anyone probing.
//
// Both routes were covered because the sweep that found the second one is the
// point: they were written independently, so this is a pattern rather than a
// typo, and a regression would most likely reappear the same way — one route at
// a time. #1031 retired the edit page to a redirect, so its case now pins that
// the redirect reads nothing and leaves the answer to the detail page.
describe('node routes — a node that does not resolve is a 404, not a 500 (#790)', () => {
  it('detail page 404s', async () => {
    mockRequest.mockResolvedValue({ node: null });
    const { load } = await import('./+page.server');
    const thrown = await expectThrow(load as never, event());
    expect(thrown.status).toBe(404);
    expect(thrown.body?.message).toBe('Node not found');
  });

  it('the old edit URL reads nothing, and defers the 404 to the detail page (#1031)', async () => {
    // The edit page became the detail page's Properties tab; its URL only
    // redirects there. It must not resolve the node itself: answering a missing
    // node differently from the detail page is the #790 defect over again.
    mockRequest.mockResolvedValue({ node: null });
    const { GET } = await import('./edit/+server');
    const thrown = await expectThrow(GET as never, event());
    expect(thrown.status).toBe(307);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not leak the requested id into the message', async () => {
    // The old message interpolated `params.nodeId`. Echoing a caller-supplied
    // id into a rendered error page is needless — it tells the requester only
    // what they already sent, and it is the kind of reflection that turns into
    // an injection surface the moment an error page renders unescaped.
    mockRequest.mockResolvedValue({ node: null });
    const { load } = await import('./+page.server');
    const thrown = await expectThrow(load as never, event('<script>alert(1)</script>'));
    expect(thrown.body?.message).toBe('Node not found');
    expect(thrown.body?.message).not.toContain('script');
  });
});

// #1159: a node that does not resolve MAY still be a retained tombstone the
// viewer can recover (recoveryNode is writer-only and answers null otherwise,
// so existence stays hidden). Only then does the detail page hand over.
describe('detail page — a recoverable deleted node (#1159)', () => {
  it('redirects to the deleted-node page when recoveryNode finds the tombstone', async () => {
    mockRequest.mockResolvedValue({ node: null, recoveryNode: { id: 'no-such-node', memoryId: 'mem-1' } });
    const { load } = await import('./+page.server');
    const thrown = (await expectThrow(load as never, event())) as { status?: number; location?: string };
    expect(thrown.status).toBe(303);
    expect(thrown.location).toBe('/app/memories/mem-1/nodes/no-such-node/deleted');
  });

  it('still 404s when there is no tombstone', async () => {
    mockRequest.mockResolvedValue({ node: null, recoveryNode: null });
    const { load } = await import('./+page.server');
    expect((await expectThrow(load as never, event())).status).toBe(404);
  });

  it('still 404s when the recovery read itself fails', async () => {
    mockRequest.mockImplementation(async (q: string) => {
      if (String(q).includes('recoveryNode')) throw new Error('boom');
      return { node: null };
    });
    const { load } = await import('./+page.server');
    expect((await expectThrow(load as never, event())).status).toBe(404);
  });
});
