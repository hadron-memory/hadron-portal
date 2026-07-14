/**
 * Conversation-editor actions (canvas rewrite). updateEdge saves the rule
 * panel's full set (name/priority/condition/data) with validation; addEdge
 * returns the created edge id so the canvas can select it; savePosition
 * merges data.position without clobbering the node's other data keys.
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
    expect(result).toEqual({ saved: true, edgeId: 'e1' });
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
    })) as { status: number; data: { edgeId: string; error: string } };
    expect(result.status).toBe(400);
    expect(result.data.edgeId).toBe('e1');
    expect(mockRequest).not.toHaveBeenCalled();
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
      priority: '0',
      data: JSON.stringify({ timing: 'on_complete', behavior: 'transition' }),
    });
    expect(result).toEqual({ created: true, edgeId: 'e-new' });
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
