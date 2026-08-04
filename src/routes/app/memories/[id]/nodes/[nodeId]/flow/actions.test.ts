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

async function runLoad() {
  const { load } = await import('./+page.server');
  const event = {
    params: { id: 'mem-1', nodeId: 'node-1' },
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({ isConsumerMode: false }),
  } as unknown as Parameters<typeof load>[0];
  return load(event);
}

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

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, unknown>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

describe('load', () => {
  it('seeds a Superforms panel form for each displayed edge', async () => {
    mockRequest.mockResolvedValueOnce({
      node: {
        id: 'node-1',
        memoryId: 'mem-1',
        loc: 'classify',
        name: 'Classify',
        data: null,
        memory: { id: 'mem-1', urn: 'acme.com::flows', name: 'Flows' },
        outgoingEdges: [
          {
            id: 'edge-1',
            name: 'next.1.high',
            loc: 'classify:next-1-high:act',
            priority: 2,
            condition: { var: 'message.data.ready' },
            target: { id: 'node-2', loc: 'act', name: 'Act' },
          },
          {
            id: 'edge-2',
            name: null,
            loc: 'classify:documents:spec',
            priority: null,
            condition: null,
            target: { id: 'node-3', loc: 'spec', name: 'Spec' },
          },
        ],
        incomingEdges: [],
      },
    });

    const result = await runLoad() as {
      edgeForms: Record<string, { data: Record<string, unknown>; errors: Record<string, string[]> }>;
    };

    expect(Object.keys(result.edgeForms)).toEqual(['edge-1', 'edge-2']);
    expect(result.edgeForms['edge-1'].data).toMatchObject({
      edgeId: 'edge-1',
      name: 'next.1.high',
      priority: '2',
      condition: JSON.stringify({ var: 'message.data.ready' }),
    });
    expect(result.edgeForms['edge-2'].data).toMatchObject({
      edgeId: 'edge-2',
      name: '',
      priority: '0',
      condition: 'null',
    });
    expect(result.edgeForms['edge-1'].errors).toEqual({});
    expect(result.edgeForms['edge-2'].errors).toEqual({});
  });
});

describe('updateEdge', () => {
  it('sends only the panel-edited variables (keeps description/data by omission)', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'next.2.high',
      priority: '5',
      condition: JSON.stringify({ '>': [{ var: 'message.data.confidence' }, 0.8] }),
    });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Edge saved.' });
    expect(mockRequest.mock.calls[0][1]).toEqual({
      edgeRef: 'e1',
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
    expect(fieldError(result, 'priority')).toMatch(/whole number/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a missing edge id through the Superforms field error path', async () => {
    const result = (await runAction('updateEdge', {
      name: 'next',
      priority: '0',
      condition: 'null',
    })) as { status: number };
    expect(result.status).toBe(400);
    expect(fieldError(result, 'edgeId')).toBe('Missing edge id');
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
    expect(fieldError(result, 'condition')).toBe('Invalid condition expression');
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
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Forbidden' });
    expect(superFormFrom(result)?.data?.edgeId).toBe('e1');
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
    expect(result).toMatchObject({ created: true, edgeId: 'e-new' });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Edge created.' });
    expect(mockRequest.mock.calls[1][1]).toEqual({
      sourceRef: 'n1',
      targetRef: 'n4',
      name: 'next.2',
    });
  });

  it('bumps priority past an index-less sibling so the new branch lands last', async () => {
    // A bare `next` (index-less) sorts AFTER every numeric index; without the
    // bump the new condition-less next.1 would become the fall-through and cut
    // the existing branch off.
    mockRequest.mockResolvedValueOnce({
      node: {
        ...host,
        outgoingEdges: [
          { id: 'e1', name: 'next', loc: 'classify:next:act', target: { id: 'n2', loc: 'act', name: 'Act' } },
        ],
      },
    });
    mockRequest.mockResolvedValueOnce({ createEdge: { id: 'e-new' } });
    await runAction('createEdge', { sourceId: 'n1', targetId: 'n4' });
    expect(mockRequest.mock.calls[1][1]).toEqual({
      sourceRef: 'n1',
      targetRef: 'n4',
      name: 'next.1',
      priority: 1,
    });
  });

  it('rejects a self-connection without any server calls', async () => {
    const result = (await runAction('createEdge', { sourceId: 'n1', targetId: 'n1' })) as {
      status: number;
    };
    expect(result.status).toBe(400);
    expect(fieldError(result, 'targetId')).toMatch(/itself/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before calling GraphQL', async () => {
    const result = (await runAction('createEdge', {
      _kind: 'updateEdge',
      sourceId: 'n1',
      targetId: 'n4',
    })) as { status: number };
    expect(result.status).toBe(400);
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('404s when the source node cannot be loaded', async () => {
    mockRequest.mockResolvedValueOnce({ node: null });
    const result = (await runAction('createEdge', { sourceId: 'n1', targetId: 'n4' })) as {
      status: number;
    };
    expect(result.status).toBe(404);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Node not found: n1' });
  });
});
