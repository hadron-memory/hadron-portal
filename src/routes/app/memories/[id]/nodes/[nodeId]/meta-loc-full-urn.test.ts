/**
 * #1876 — the Settings "location" field (`updateMeta`'s move-if-loc-changed
 * path) must treat a pasted FULL node URN the way the Move dialog does: a
 * cross-memory URN moves the node to that memory + loc, a same-memory URN
 * renames in place, a URN naming the node's own address is a no-op, and a bare
 * loc keeps composing into the node's own memory. A full URN must never be
 * reduced to its loc (which silently drops the memory) or composed as a loc
 * beneath the source memory.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOVE_NODE_MUTATION,
  NODE_BY_ID_QUERY,
  NODE_DATA_READ_QUERY,
  NODE_QUERY,
  UPDATE_NODE_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

const node = {
  id: 'pk',
  memoryId: 'mem-1',
  loc: 'rules:copy',
  name: 'Copy',
  tags: [],
  data: {},
  outgoingEdges: [],
  role: null,
  isRunnable: null,
  memory: { id: 'mem-1', urn: 'hrn:mem:acme.com:mem-a' },
};

function stub(moveError?: unknown) {
  mockRequest.mockImplementation(async (query: unknown) => {
    if (query === NODE_BY_ID_QUERY || query === NODE_QUERY || query === NODE_DATA_READ_QUERY) return { node };
    if (query === MOVE_NODE_MUTATION && moveError) throw moveError;
    return {};
  });
}

async function saveLoc(loc: string) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries({
    name: 'Copy', nodeType: 'info', description: '', alias: '', seq: '1', tags: '', loc,
  })) fd.set(k, v);
  return (actions as Record<string, (e: never) => Promise<unknown>>).updateMeta({
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
  } as never);
}

const moves = () => mockRequest.mock.calls.filter(([q]) => q === MOVE_NODE_MUTATION).map(([, v]) => v);

describe('updateMeta location field takes a full node URN (#1876)', () => {
  it('moves cross-memory to the pasted memory and loc, as-is', async () => {
    stub();
    await saveLoc('hrn:node:acme.com:mem-b:rules:original');
    expect(moves()).toEqual([{ sourceRef: 'pk', targetUrn: 'hrn:node:acme.com:mem-b:rules:original' }]);
  });

  it('renames in place for a same-memory full URN', async () => {
    stub();
    await saveLoc('hrn:node:acme.com:mem-a:rules:original');
    expect(moves()).toEqual([{ sourceRef: 'pk', targetUrn: 'hrn:node:acme.com:mem-a:rules:original' }]);
  });

  it('is a no-op when the URN names the node where it already is', async () => {
    stub();
    const result = (await saveLoc('hrn:node:acme.com:mem-a:rules:copy')) as { status?: number };
    expect(moves()).toEqual([]);
    expect(result.status).toBeUndefined();
    expect(mockRequest.mock.calls.some(([q]) => q === UPDATE_NODE_MUTATION)).toBe(true);
  });

  it.each([
    'urn:node:acme.com::mem-a::worker::system::reports:daily',
    'acme.com::mem-a::worker::system::reports:daily',
  ])('forwards a legacy ownership-chain destination %s for the server to resolve (never flattened into a no-op)', async (chain) => {
    mockRequest.mockImplementation(async (query: unknown) => {
      if (query === NODE_BY_ID_QUERY || query === NODE_QUERY || query === NODE_DATA_READ_QUERY) {
        return { node: { ...node, loc: 'worker:system:reports:daily' } };
      }
      return {};
    });
    await saveLoc(chain);
    expect(moves()).toEqual([{ sourceRef: 'pk', targetUrn: chain }]);
  });

  it('keeps composing a bare loc into the node\'s own memory', async () => {
    stub();
    await saveLoc('rules:renamed');
    expect(moves()).toEqual([{ sourceRef: 'pk', targetUrn: 'hrn:node:acme.com:mem-a:rules:renamed' }]);
  });

  it('a failed cross-memory move still reports the edits as saved', async () => {
    stub(Object.assign(new Error('x'), { response: { errors: [{ message: 'no', extensions: { code: 'NODE_ALREADY_EXISTS' } }] } }));
    const result = (await saveLoc('hrn:node:acme.com:mem-b:rules:original')) as { status?: number; data?: { metaSaved?: boolean } };
    expect(result.status).toBe(409);
    expect(result.data?.metaSaved).toBe(true);
  });
});
