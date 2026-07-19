/**
 * Conversation-editor actions (canvas rewrite). updateEdge saves the rule
 * panel's full set (name/priority/condition/data) with validation; addEdge
 * returns the created edge id so the canvas can select it; savePosition
 * merges data.position without clobbering the node's other data keys.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
const mockFetchAllItems = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: mockFetchAllItems,
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockFetchAllItems.mockReset();
});

async function runAction(
  name: 'updateEdge' | 'addEdge' | 'savePosition',
  fields: Record<string, string>,
) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const event = {
    request: { formData: async () => fd },
    params: { id: 'agent-1' },
    locals: { token: 'tok' },
  } as unknown as Parameters<(typeof actions)[typeof name]>[0];
  return actions[name](event);
}

async function runLoad() {
  const { load } = await import('./+page.server');
  const event = {
    params: { id: 'agent-1' },
    locals: { token: 'tok' },
    parent: async () => ({}),
  } as unknown as Parameters<typeof load>[0];
  return load(event);
}

describe('updateEdge', () => {
  it('sends name, priority, condition, and data; reports the saved edge id', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'needs profile',
      priority: '5',
      condition: JSON.stringify({ missing: ['memory.name'] }),
      data: JSON.stringify({ timing: 'on_enter', behavior: 'detour', custom: 'kept' }),
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { edgeId: 'e1' },
        message: { type: 'success', text: 'Rule saved.' },
      },
    });
    expect(mockRequest.mock.calls[0][1]).toEqual({
      edgeId: 'e1',
      name: 'needs profile',
      priority: 5,
      condition: { missing: ['memory.name'] },
      data: { timing: 'on_enter', behavior: 'detour', custom: 'kept' },
    });
  });

  it('clears an empty name to null and defaults empty priority to 0', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('updateEdge', {
      edgeId: 'e1',
      name: '  ',
      priority: '',
      condition: 'null',
      data: '{}',
    });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ name: null, priority: 0, condition: null });
  });

  it('rejects a non-integer priority before any mutation, scoped to the edge', async () => {
    const result = (await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'x',
      priority: '1.5',
      condition: 'null',
      data: '{}',
    })) as { status: number; data: { form: { data: { edgeId: string }; errors: { priority?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.edgeId).toBe('e1');
    expect(result.data.form.errors.priority?.[0]).toBe('Priority must be a whole number');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects missing edge ids before any mutation', async () => {
    const result = (await runAction('updateEdge', {
      name: 'x',
      priority: '1',
      condition: 'null',
      data: '{}',
    })) as { status: number; data: { form: { data: { edgeId: string }; errors: { edgeId?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.edgeId).toBe('');
    expect(result.data.form.errors.edgeId?.[0]).toBe('Missing edge id');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid data JSON before any mutation, scoped to the edge', async () => {
    const result = (await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'x',
      priority: '1',
      condition: 'null',
      data: '{',
    })) as { status: number; data: { form: { data: { edgeId: string }; errors: { data?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.edgeId).toBe('e1');
    expect(result.data.form.errors.data?.[0]).toBe('Invalid JSON');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error message when the mutation fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'x',
      priority: '1',
      condition: 'null',
      data: '{}',
    })) as { status: number; data: { form: { data: { edgeId: string }; message: { type: string; text: string } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.edgeId).toBe('e1');
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('load', () => {
  it('seeds a Superform for each rendered conversation edge', async () => {
    mockFetchAllItems.mockResolvedValueOnce([
      { id: 'org-1', agents: [{ id: 'agent-1', systemMemoryId: 'mem-1' }] },
    ]);
    mockRequest.mockResolvedValueOnce({
      findNodes: {
        hits: [
          {
            node: {
              id: 'n1',
              memoryId: 'mem-1',
              loc: 'conversations:demo:start',
              name: 'start',
              description: 'Start',
              data: {},
              outgoingEdges: [
                {
                  id: 'e1',
                  name: 'needs profile',
                  priority: 2,
                  condition: { missing: ['memory.name'] },
                  data: { timing: 'on_enter', behavior: 'detour', custom: 'kept' },
                  target: { id: 'n2', loc: 'conversations:demo:end', name: 'end' },
                },
                {
                  id: 'e2',
                  name: null,
                  priority: null,
                  condition: null,
                  data: {},
                  target: { id: 'n2', loc: 'conversations:demo:end', name: 'end' },
                },
              ],
            },
          },
          {
            node: {
              id: 'n2',
              memoryId: 'mem-1',
              loc: 'conversations:demo:end',
              name: 'end',
              description: 'End',
              data: {},
              outgoingEdges: [],
            },
          },
        ],
      },
    });

    const result = (await runLoad()) as {
      edgeForms: Record<string, { data: { edgeId: string; name: string; priority: string; condition: string; data: string } }>;
    };

    expect(Object.keys(result.edgeForms)).toEqual(['e1', 'e2']);
    expect(result.edgeForms.e1.data).toMatchObject({
      edgeId: 'e1',
      name: 'needs profile',
      priority: '2',
      condition: JSON.stringify({ missing: ['memory.name'] }),
    });
    expect(JSON.parse(result.edgeForms.e1.data.data)).toEqual({
      timing: 'on_enter',
      behavior: 'detour',
      custom: 'kept',
    });
    expect(result.edgeForms.e2.data).toMatchObject({
      edgeId: 'e2',
      name: '',
      priority: '0',
      condition: 'null',
    });
    expect(JSON.parse(result.edgeForms.e2.data.data)).toEqual({
      timing: 'on_complete',
      behavior: 'transition',
    });
  });
});

describe('addEdge', () => {
  it('returns the created edge id so the canvas can select it', async () => {
    mockRequest.mockResolvedValueOnce({ createEdge: { id: 'e-new' } });
    const result = await runAction('addEdge', {
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      name: '→ Setup',
      condition: 'null',
      priority: '3',
      data: JSON.stringify({ timing: 'on_complete', behavior: 'transition' }),
    });
    expect(result).toEqual({ created: true, edgeId: 'e-new' });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({ condition: null, priority: 3 });
  });

  it('rejects a non-integer priority before any mutation (Copilot review on #544)', async () => {
    const result = (await runAction('addEdge', {
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      name: 'x',
      condition: 'null',
      priority: '1.5',
      data: '{}',
    })) as { status: number };
    expect(result.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('savePosition', () => {
  it('merges data.position into the node data it read (other keys survive)', async () => {
    mockRequest
      .mockResolvedValueOnce({ node: { data: { stageOrder: ['a'], position: { x: 1, y: 2 } } } })
      .mockResolvedValueOnce({});
    const result = await runAction('savePosition', {
      systemMemoryId: 'mem-1',
      loc: 'conversations:find-mentor',
      x: '400',
      y: '120',
    });
    expect(result).toBeUndefined();
    expect(mockRequest.mock.calls[1][1]).toEqual({
      input: {
        memoryId: 'mem-1',
        loc: 'conversations:find-mentor',
        data: { stageOrder: ['a'], position: { x: 400, y: 120 } },
      },
    });
  });

  it('rejects a non-numeric position without touching the node', async () => {
    const result = (await runAction('savePosition', {
      systemMemoryId: 'mem-1',
      loc: 'conversations:c',
      x: 'NaN-city',
      y: '0',
    })) as { status: number };
    expect(result.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
