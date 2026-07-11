/**
 * Flow-canvas edit actions (#510). updateEdge saves the side panel's subset
 * (name/priority/condition) and must OMIT the variables it doesn't edit so
 * the server keeps description/isRunnable/data. createEdge names the new
 * routing edge with the source's next free index.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

async function runAction(name: 'updateEdge' | 'createEdge', fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const event = {
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'node-1' },
    locals: { token: 'tok' },
  } as unknown as Parameters<(typeof actions)[typeof name]>[0];
  return actions[name](event);
}

describe('updateEdge', () => {
  it('sends only the panel-edited variables (keeps description/data by omission)', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'next.2.high',
      priority: '5',
      condition: JSON.stringify({ '>': [{ var: 'message.data.confidence' }, 0.8] }),
    });
    expect(result).toEqual({ saved: true, edgeId: 'e1' });
    expect(mockRequest.mock.calls[0][1]).toEqual({
      edgeId: 'e1',
      name: 'next.2.high',
      priority: 5,
      condition: { '>': [{ var: 'message.data.confidence' }, 0.8] },
    });
  });

  it('clears the condition with an explicit null and defaults empty priority to 0', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('updateEdge', { edgeId: 'e1', name: 'next', priority: '', condition: 'null' });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ condition: null, priority: 0 });
  });

  it('rejects a non-integer priority before any mutation', async () => {
    const result = (await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'next',
      priority: '1.5',
      condition: 'null',
    })) as { status: number; data: { error: string } };
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/whole number/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects malformed condition JSON before any mutation', async () => {
    const result = (await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'next',
      priority: '0',
      condition: '{nope',
    })) as { status: number };
    expect(result.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('surfaces the GraphQL error message, not the raw ClientError payload', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('huge query/variable dump'), {
        response: { errors: [{ message: 'Forbidden' }] },
      }),
    );
    const result = (await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'next',
      priority: '0',
      condition: 'null',
    })) as { status: number; data: { error: string; edgeId: string } };
    expect(result.status).toBe(500);
    expect(result.data.error).toBe('Forbidden');
    expect(result.data.edgeId).toBe('e1');
  });
});

describe('createEdge', () => {
  const host = {
    id: 'n1',
    memoryId: 'mem-1',
    loc: 'classify',
    name: 'Classify',
    data: null,
    memory: { id: 'mem-1', urn: 'acme.com::flows', name: 'Flows' },
    outgoingEdges: [
      { id: 'e1', name: 'next.1', loc: 'classify:next-1:act', target: { id: 'n2', loc: 'act', name: 'Act' } },
      { id: 'e2', name: 'documents', loc: 'classify:documents:spec', target: { id: 'n3', loc: 'spec', name: 'Spec' } },
    ],
    incomingEdges: [],
  };

  it('creates a routing edge named with the next free index and returns its id', async () => {
    mockRequest.mockResolvedValueOnce({ node: host });
    mockRequest.mockResolvedValueOnce({ createEdge: { id: 'e-new' } });
    const result = await runAction('createEdge', { sourceId: 'n1', targetId: 'n4' });
    expect(result).toEqual({ created: true, edgeId: 'e-new' });
    expect(mockRequest.mock.calls[1][1]).toEqual({
      sourceNodeId: 'n1',
      targetNodeId: 'n4',
      name: 'next.2',
    });
  });

  it('rejects a self-connection without any server calls', async () => {
    const result = (await runAction('createEdge', { sourceId: 'n1', targetId: 'n1' })) as {
      status: number;
      data: { error: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/itself/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('404s when the source node cannot be loaded', async () => {
    mockRequest.mockResolvedValueOnce({ node: null });
    const result = (await runAction('createEdge', { sourceId: 'n1', targetId: 'n4' })) as {
      status: number;
    };
    expect(result.status).toBe(404);
  });
});
