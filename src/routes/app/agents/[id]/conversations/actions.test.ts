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
  name: 'addConversation' | 'updateEdge' | 'updateExtractionSpec' | 'updateGoals' | 'addEdge' | 'savePosition',
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

function gqlError(code: string) {
  return { response: { errors: [{ extensions: { code } }] } };
}

describe('addConversation', () => {
  it('creates a conversation from a validated name and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('addConversation', {
      systemMemoryId: 'mem-1',
      name: 'Demo Conversation',
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { systemMemoryId: 'mem-1', name: 'Demo Conversation' },
        message: { type: 'success', text: 'Conversation added.' },
      },
    });
    expect(mockRequest.mock.calls[0][1]).toEqual({
      input: {
        memoryId: 'mem-1',
        loc: 'conversations:demo-conversation',
        name: 'demo-conversation',
        nodeType: 'system',
        description: 'Demo Conversation',
        data: { stageOrder: [] },
      },
    });
  });

  it('rejects missing conversation names before creating a node', async () => {
    const result = (await runAction('addConversation', {
      systemMemoryId: 'mem-1',
    })) as { status: number; data: { form: { data: { name: string }; errors: { name?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.name).toBe('');
    expect(result.data.form.errors.name?.[0]).toBe('Name is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects missing system memory ids before creating a node', async () => {
    const result = (await runAction('addConversation', {
      name: 'Demo Conversation',
    })) as { status: number; data: { form: { data: { systemMemoryId: string }; errors: { systemMemoryId?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.systemMemoryId).toBe('');
    expect(result.data.form.errors.systemMemoryId?.[0]).toBe('Missing system memory id');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps duplicate conversation slugs to a name field error', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('NodeLocConflictError'));
    const result = (await runAction('addConversation', {
      systemMemoryId: 'mem-1',
      name: 'Demo Conversation',
    })) as { status: number; data: { form: { data: { name: string }; errors: { name?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.name).toBe('Demo Conversation');
    expect(result.data.form.errors.name?.[0]).toBe('A conversation with this name already exists');
  });

  it('returns a typed fallback error when creation fails without a message', async () => {
    mockRequest.mockRejectedValueOnce({});
    const result = (await runAction('addConversation', {
      systemMemoryId: 'mem-1',
      name: 'Demo Conversation',
    })) as { status: number; data: { form: { data: { name: string }; message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.data.name).toBe('Demo Conversation');
    expect(result.data.form.message).toEqual({
      type: 'error',
      text: 'Failed to add conversation',
    });
  });
});

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

  it('rejects non-object data JSON before any mutation, scoped to the edge', async () => {
    const result = (await runAction('updateEdge', {
      edgeId: 'e1',
      name: 'x',
      priority: '1',
      condition: 'null',
      data: '"hello"',
    })) as { status: number; data: { form: { data: { edgeId: string }; errors: { data?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.edgeId).toBe('e1');
    expect(result.data.form.errors.data?.[0]).toBe('Data must be a JSON object');
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
    expect(result.status).toBe(500);
    expect(result.data.form.data.edgeId).toBe('e1');
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('updateExtractionSpec', () => {
  it('merges a valid extraction spec into the stage data and returns a typed success', async () => {
    mockRequest
      .mockResolvedValueOnce({ node: { data: { promptRef: 'prompts:demo:start' } } })
      .mockResolvedValueOnce({});
    const result = await runAction('updateExtractionSpec', {
      systemMemoryId: 'mem-1',
      stageLoc: 'conversations:demo:start',
      extractionSpec: JSON.stringify([{ field: 'memory.name', description: 'User name' }]),
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { stageLoc: 'conversations:demo:start' },
        message: { type: 'success', text: 'Extraction saved.' },
      },
    });
    expect(mockRequest.mock.calls[1][1]).toEqual({
      input: {
        memoryId: 'mem-1',
        loc: 'conversations:demo:start',
        data: {
          promptRef: 'prompts:demo:start',
          extractionSpec: [{ field: 'memory.name', description: 'User name' }],
        },
      },
    });
  });

  it('rejects invalid extraction spec JSON before reading the stage node', async () => {
    const result = (await runAction('updateExtractionSpec', {
      systemMemoryId: 'mem-1',
      stageLoc: 'conversations:demo:start',
      extractionSpec: '{',
    })) as { status: number; data: { form: { data: { stageLoc: string }; errors: { extractionSpec?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.stageLoc).toBe('conversations:demo:start');
    expect(result.data.form.errors.extractionSpec?.[0]).toBe('Invalid JSON');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects non-array extraction spec JSON before reading the stage node', async () => {
    const result = (await runAction('updateExtractionSpec', {
      systemMemoryId: 'mem-1',
      stageLoc: 'conversations:demo:start',
      extractionSpec: '{}',
    })) as { status: number; data: { form: { data: { stageLoc: string }; errors: { extractionSpec?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.stageLoc).toBe('conversations:demo:start');
    expect(result.data.form.errors.extractionSpec?.[0]).toBe('Extraction spec must be a JSON array');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects missing stage loc before reading the stage node', async () => {
    const result = (await runAction('updateExtractionSpec', {
      systemMemoryId: 'mem-1',
      extractionSpec: '[]',
    })) as { status: number; data: { form: { data: { stageLoc: string }; errors: { stageLoc?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.stageLoc).toBe('');
    expect(result.data.form.errors.stageLoc?.[0]).toBe('Missing stage loc');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error message when the mutation fails', async () => {
    mockRequest
      .mockResolvedValueOnce({ node: { data: {} } })
      .mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('updateExtractionSpec', {
      systemMemoryId: 'mem-1',
      stageLoc: 'conversations:demo:start',
      extractionSpec: '[]',
    })) as { status: number; data: { form: { data: { stageLoc: string }; message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.data.stageLoc).toBe('conversations:demo:start');
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('updateGoals', () => {
  it('normalizes goal textareas into arrays, merges conversation data, and returns a typed success', async () => {
    mockRequest
      .mockResolvedValueOnce({ node: { data: { stageOrder: ['start'] } } })
      .mockResolvedValueOnce({});
    const result = await runAction('updateGoals', {
      systemMemoryId: 'mem-1',
      convLoc: 'conversations:demo',
      goalDescriptionsText: ' Find a mentor \n\nAnswer questions ',
      goalSignalsText: 'I need help\r\n  find someone  ',
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { convLoc: 'conversations:demo' },
        message: { type: 'success', text: 'Goals saved.' },
      },
    });
    expect(mockRequest.mock.calls[1][1]).toEqual({
      input: {
        memoryId: 'mem-1',
        loc: 'conversations:demo',
        data: {
          stageOrder: ['start'],
          goalDescriptions: ['Find a mentor', 'Answer questions'],
          goalSignals: ['I need help', 'find someone'],
        },
      },
    });
  });

  it('rejects missing conversation loc before reading the conversation node', async () => {
    const result = (await runAction('updateGoals', {
      systemMemoryId: 'mem-1',
      goalDescriptionsText: 'Find a mentor',
      goalSignalsText: 'I need help',
    })) as { status: number; data: { form: { data: { convLoc: string }; errors: { convLoc?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.convLoc).toBe('');
    expect(result.data.form.errors.convLoc?.[0]).toBe('Missing conversation loc');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects non-conversation locs before reading the conversation node', async () => {
    const result = (await runAction('updateGoals', {
      systemMemoryId: 'mem-1',
      convLoc: 'conversations:demo:start',
      goalDescriptionsText: 'Find a mentor',
      goalSignalsText: 'I need help',
    })) as { status: number; data: { form: { data: { convLoc: string }; errors: { convLoc?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.convLoc).toBe('conversations:demo:start');
    expect(result.data.form.errors.convLoc?.[0]).toBe('Invalid conversation loc');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error message when the mutation fails', async () => {
    mockRequest
      .mockResolvedValueOnce({ node: { data: {} } })
      .mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('updateGoals', {
      systemMemoryId: 'mem-1',
      convLoc: 'conversations:demo',
      goalDescriptionsText: '',
      goalSignalsText: '',
    })) as { status: number; data: { form: { data: { convLoc: string }; message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.data.convLoc).toBe('conversations:demo');
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });

  it('returns the translated fallback when the mutation error has no message', async () => {
    mockRequest
      .mockResolvedValueOnce({ node: { data: {} } })
      .mockRejectedValueOnce({});
    const result = (await runAction('updateGoals', {
      systemMemoryId: 'mem-1',
      convLoc: 'conversations:demo',
      goalDescriptionsText: '',
      goalSignalsText: '',
    })) as { status: number; data: { form: { data: { convLoc: string }; message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.data.convLoc).toBe('conversations:demo');
    expect(result.data.form.message).toEqual({
      type: 'error',
      text: 'Failed to update goals',
    });
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
              id: 'conv-1',
              memoryId: 'mem-1',
              loc: 'conversations:demo',
              name: 'demo',
              description: 'Demo',
              data: {
                goalDescriptions: ['Find a mentor'],
                goalSignals: ['I need help'],
                stageOrder: ['start', 'end'],
              },
              outgoingEdges: [],
            },
          },
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
              id: 'prompt-1',
              memoryId: 'mem-1',
              loc: 'prompts:demo:start',
              name: 'start',
              description: 'Start prompt',
              data: {},
              outgoingEdges: [],
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
      addConversationForm: { data: { systemMemoryId: string; name: string } };
      edgeForms: Record<string, { data: { edgeId: string; name: string; priority: string; condition: string; data: string } }>;
      conversationGoalForms: Record<string, { data: { systemMemoryId: string; convLoc: string; goalDescriptionsText: string; goalSignalsText: string } }>;
      stageExtractionForms: Record<string, { data: { systemMemoryId: string; stageLoc: string; extractionSpec: string } }>;
    };

    expect(result.addConversationForm.data).toMatchObject({ systemMemoryId: 'mem-1', name: '' });
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
    expect(result.stageExtractionForms.n1.data).toMatchObject({
      systemMemoryId: 'mem-1',
      stageLoc: 'conversations:demo:start',
      extractionSpec: '[]',
    });
    expect(result.stageExtractionForms.n2.data).toMatchObject({
      systemMemoryId: 'mem-1',
      stageLoc: 'conversations:demo:end',
      extractionSpec: '[]',
    });
    expect(result.stageExtractionForms['prompt-1']).toBeUndefined();
    expect(result.conversationGoalForms['conv-1'].data).toMatchObject({
      systemMemoryId: 'mem-1',
      convLoc: 'conversations:demo',
      goalDescriptionsText: 'Find a mentor',
      goalSignalsText: 'I need help',
    });
    expect(result.conversationGoalForms['prompt-1']).toBeUndefined();
  });

  it('returns an empty edgeForms object when the conversation has no rendered edges', async () => {
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
              outgoingEdges: [],
            },
          },
        ],
      },
    });

    const result = (await runLoad()) as { edgeForms: Record<string, unknown> };

    expect(result.edgeForms).toEqual({});
  });

  it('does not seed a form for an edge whose target is missing', async () => {
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
                  id: 'missing-target-edge',
                  name: 'orphaned',
                  priority: 0,
                  condition: null,
                  data: {},
                  target: null,
                },
              ],
            },
          },
        ],
      },
    });

    const result = (await runLoad()) as { edgeForms: Record<string, unknown> };

    expect(result.edgeForms).toEqual({});
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
