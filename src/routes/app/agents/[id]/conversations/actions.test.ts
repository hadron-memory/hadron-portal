/**
 * Conversation-editor actions (canvas rewrite). updateEdge saves the rule
 * panel's full set (name/priority/condition/data) with validation; addEdge
 * returns the created edge id so the canvas can select it; savePosition
 * merges data.position without clobbering the node's other data keys.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UPDATE_NODE_MUTATION,
  UPDATE_REVIEW_NODE_MUTATION,
  UPDATE_SPEC_NODE_MUTATION,
  UPDATE_TASK_NODE_MUTATION,
} from '$lib/server/queries';

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
  name: 'addConversation' | 'addStage' | 'updateEdge' | 'updateExtractionSpec' | 'updateGoals' | 'updatePrompt' | 'addEdge' | 'savePosition',
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

describe('addStage', () => {
  it('creates a stage and prompt, updates stage order, and returns a typed success', async () => {
    mockRequest
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ node: { data: { stageOrder: ['start'] } } })
      .mockResolvedValueOnce({});
    const result = await runAction('addStage', {
      systemMemoryId: 'mem-1',
      conversationLoc: 'conversations:demo',
      stageName: 'Gather Details',
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { conversationLoc: 'conversations:demo', stageName: 'Gather Details' },
        message: { type: 'success', text: 'Stage added.' },
      },
    });
    expect(mockRequest.mock.calls[0][1]).toEqual({
      input: {
        memoryId: 'mem-1',
        loc: 'conversations:demo:gather-details',
        name: 'gather-details',
        nodeType: 'system',
        description: 'Gather Details',
        data: {
          promptRef: 'prompts:demo:gather-details',
          extractionSpec: [],
        },
      },
    });
    expect(mockRequest.mock.calls[1][1]).toEqual({
      input: {
        memoryId: 'mem-1',
        loc: 'prompts:demo:gather-details',
        name: 'gather-details',
        nodeType: 'system',
        content: 'Stage: Gather Details\n\n[Edit this prompt]',
      },
    });
    expect(mockRequest.mock.calls[3][1]).toEqual({
      input: {
        memoryId: 'mem-1',
        loc: 'conversations:demo',
        data: { stageOrder: ['start', 'gather-details'] },
      },
    });
  });

  it('rejects missing stage names before creating nodes', async () => {
    const result = (await runAction('addStage', {
      systemMemoryId: 'mem-1',
      conversationLoc: 'conversations:demo',
    })) as { status: number; data: { form: { data: { stageName: string }; errors: { stageName?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.stageName).toBe('');
    expect(result.data.form.errors.stageName?.[0]).toBe('Stage name is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects non-conversation locs before creating nodes', async () => {
    const result = (await runAction('addStage', {
      systemMemoryId: 'mem-1',
      conversationLoc: 'conversations:demo:start',
      stageName: 'Gather Details',
    })) as { status: number; data: { form: { data: { conversationLoc: string }; errors: { conversationLoc?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.conversationLoc).toBe('conversations:demo:start');
    expect(result.data.form.errors.conversationLoc?.[0]).toBe('Invalid conversation loc');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps duplicate stage slugs to a stageName field error', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('NodeLocConflictError'));
    const result = (await runAction('addStage', {
      systemMemoryId: 'mem-1',
      conversationLoc: 'conversations:demo',
      stageName: 'Gather Details',
    })) as { status: number; data: { form: { data: { stageName: string }; errors: { stageName?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.stageName).toBe('Gather Details');
    expect(result.data.form.errors.stageName?.[0]).toBe('A stage with this name already exists in this conversation');
  });

  it('returns a typed fallback error when updating stage order fails', async () => {
    mockRequest
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ node: { data: { stageOrder: [] } } })
      .mockRejectedValueOnce({});
    const result = (await runAction('addStage', {
      systemMemoryId: 'mem-1',
      conversationLoc: 'conversations:demo',
      stageName: 'Gather Details',
    })) as { status: number; data: { form: { data: { conversationLoc: string }; message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.data.conversationLoc).toBe('conversations:demo');
    expect(result.data.form.message).toEqual({
      type: 'error',
      text: 'Failed to add stage',
    });
  });
});

/**
 * #870 — updatePrompt reads before it writes, and the door follows the node.
 *
 * This flow used to write FIRST and create on NODE_NOT_FOUND, because a
 * stage's promptRef can dangle. The server refuses a generic `updateNode`
 * against a governed node, so an update has to know the node's kind and a
 * write-first flow cannot — hence read, then create or update through the
 * door. Both races the old shape handled are preserved and they are opposites:
 * the node can APPEAR between read and create, and VANISH between read and
 * update.
 *
 * The assertions name the mutation DOCUMENT, not just the payload. Pinning the
 * payload alone is how `convertToTask` passed through a total outage on #868:
 * exactly the right input sent to exactly the wrong operation.
 */
describe('updatePrompt', () => {
  const PROMPT = { ref: 'prompts:demo:start', memoryRef: 'mem-1' };

  /** Serve the read, and let every write resolve. `node` null = does not exist. */
  function serve(node: Record<string, unknown> | null, onWrite?: (doc: string) => unknown) {
    mockRequest.mockImplementation(async (query: string, vars: Record<string, unknown>) => {
      if (vars && 'ref' in vars) return { node };
      const thrown = onWrite?.(query);
      if (thrown instanceof Error) throw thrown;
      return {};
    });
  }

  /** The documents sent, in order — reads are the calls carrying `ref`. */
  function writes() {
    return mockRequest.mock.calls.filter(([, vars]) => !(vars && 'ref' in vars));
  }

  it('reads first, then updates an existing prompt through the generic door', async () => {
    serve({ data: {}, role: null, isRunnable: null });
    const result = await runAction('updatePrompt', {
      systemMemoryId: 'mem-1',
      loc: PROMPT.ref,
      content: 'Updated prompt',
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'updatePrompt', loc: PROMPT.ref, content: 'Updated prompt' },
        message: { type: 'success', text: 'Prompt saved.' },
      },
    });
    expect(mockRequest.mock.calls[0][1]).toEqual(PROMPT);
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe(UPDATE_NODE_MUTATION);
    expect(writes()[0][1]).toEqual({
      input: { memoryId: 'mem-1', loc: PROMPT.ref, content: 'Updated prompt' },
    });
  });

  /**
   * The defect #870 is actually about. A prompt node someone converted to a
   * task is refused by the generic door, and before this the wizard could not
   * save it at all. Same input, different operation.
   */
  it.each([
    ['a task node', { data: {}, role: null, isRunnable: true }, UPDATE_TASK_NODE_MUTATION],
    ['a review node', { data: {}, role: 'review', isRunnable: null }, UPDATE_REVIEW_NODE_MUTATION],
    ['a spec node', { data: {}, role: 'spec', isRunnable: null }, UPDATE_SPEC_NODE_MUTATION],
  ])('updates %s through its own door', async (_what, node, door) => {
    serve(node);
    await runAction('updatePrompt', { systemMemoryId: 'mem-1', loc: PROMPT.ref, content: 'x' });
    expect(writes()).toHaveLength(1);
    expect(writes()[0][0]).toBe(door);
  });

  it('creates the prompt when the read says it does not exist', async () => {
    serve(null);
    const result = await runAction('updatePrompt', {
      systemMemoryId: 'mem-1',
      loc: PROMPT.ref,
      content: 'Created prompt',
    });
    expect(result).toMatchObject({ form: { valid: true, message: { type: 'success', text: 'Prompt saved.' } } });
    expect(writes()).toHaveLength(1);
    expect(writes()[0][1]).toEqual({
      input: {
        memoryId: 'mem-1',
        loc: PROMPT.ref,
        name: 'start',
        nodeType: 'system',
        content: 'Created prompt',
      },
    });
  });

  // Race one: the node APPEARS between the read and the create. Re-read rather
  // than assume — the winner decided what this node is, and the door follows
  // from that rather than from what we expected to create.
  it('re-reads and routes when it loses the create race', async () => {
    let created = false;
    mockRequest.mockImplementation(async (query: string, vars: Record<string, unknown>) => {
      if (vars && 'ref' in vars) return { node: created ? { data: {}, role: null, isRunnable: true } : null };
      if (!created) {
        created = true;
        throw gqlError('NodeLocConflictError');
      }
      return {};
    });
    const result = await runAction('updatePrompt', {
      systemMemoryId: 'mem-1',
      loc: PROMPT.ref,
      content: 'Raced prompt',
    });
    expect(result).toMatchObject({ form: { message: { type: 'success', text: 'Prompt saved.' } } });
    // The winner made it runnable, so the retry must use the TASK door — the
    // case a retry that reused the original document would get wrong.
    expect(writes()).toHaveLength(2);
    expect(writes()[1][0]).toBe(UPDATE_TASK_NODE_MUTATION);
  });

  // Race two, the opposite: the node VANISHES between the read and the update.
  // The desired end state is still "the prompt exists with this content".
  it('creates when the node is deleted between the read and the write', async () => {
    let updateTried = false;
    mockRequest.mockImplementation(async (query: string, vars: Record<string, unknown>) => {
      if (vars && 'ref' in vars) return { node: { data: {}, role: null, isRunnable: null } };
      if (!updateTried) {
        updateTried = true;
        throw gqlError('NODE_NOT_FOUND');
      }
      return {};
    });
    const result = await runAction('updatePrompt', {
      systemMemoryId: 'mem-1',
      loc: PROMPT.ref,
      content: 'Recreated prompt',
    });
    expect(result).toMatchObject({ form: { message: { type: 'success', text: 'Prompt saved.' } } });
    expect(writes()).toHaveLength(2);
    expect(writes()[1][1]).toMatchObject({ input: { nodeType: 'system', content: 'Recreated prompt' } });
  });

  it('rejects missing prompt locs before any mutation', async () => {
    const result = (await runAction('updatePrompt', {
      systemMemoryId: 'mem-1',
      content: 'Updated prompt',
    })) as { status: number; data: { form: { data: { loc: string }; errors: { loc?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.data.loc).toBe('');
    expect(result.data.form.errors.loc?.[0]).toBe('Missing prompt loc');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects updatePrompt POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('updatePrompt', {
      _kind: 'addStage',
      systemMemoryId: 'mem-1',
      loc: 'prompts:demo:start',
      content: 'Updated prompt',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed fallback error when prompt update fails', async () => {
    mockRequest.mockRejectedValueOnce({});
    const result = (await runAction('updatePrompt', {
      systemMemoryId: 'mem-1',
      loc: 'prompts:demo:start',
      content: 'Updated prompt',
    })) as { status: number; data: { form: { data: { loc: string }; message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.data.loc).toBe('prompts:demo:start');
    expect(result.data.form.message).toEqual({
      type: 'error',
      text: 'Failed to update prompt',
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
      edgeRef: 'e1',
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
              data: { promptRef: 'prompts:demo:start' },
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
              content: 'Start content',
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
              data: { promptRef: 'prompts:demo:end' },
              outgoingEdges: [],
            },
          },
        ],
      },
    });

    const result = (await runLoad()) as {
      addConversationForm: { data: { _kind: string; systemMemoryId: string; name: string } };
      addEdgeForm: { data: { _kind: string; sourceNodeId: string; targetNodeId: string; name: string; condition: string; priority: string; data: string } };
      addStageForms: Record<string, { data: { _kind: string; systemMemoryId: string; conversationLoc: string; stageName: string } }>;
      promptForms: Record<string, { data: { _kind: string; systemMemoryId: string; loc: string; content: string } }>;
      edgeForms: Record<string, { data: { _kind: string; edgeId: string; name: string; priority: string; condition: string; data: string } }>;
      conversationGoalForms: Record<string, { data: { _kind: string; systemMemoryId: string; convLoc: string; goalDescriptionsText: string; goalSignalsText: string } }>;
      stageExtractionForms: Record<string, { data: { _kind: string; systemMemoryId: string; stageLoc: string; extractionSpec: string } }>;
    };

    expect(result.addConversationForm.data).toMatchObject({ _kind: 'addConversation', systemMemoryId: 'mem-1', name: '' });
    expect(result.addEdgeForm.data).toMatchObject({
      _kind: 'addEdge',
      sourceNodeId: '',
      targetNodeId: '',
      name: '',
      condition: 'null',
      priority: '0',
      data: '{}',
    });
    expect(result.addStageForms['conv-1'].data).toMatchObject({
      _kind: 'addStage',
      systemMemoryId: 'mem-1',
      conversationLoc: 'conversations:demo',
      stageName: '',
    });
    expect(result.addStageForms['prompt-1']).toBeUndefined();
    expect(result.promptForms['prompts:demo:start'].data).toMatchObject({
      _kind: 'updatePrompt',
      systemMemoryId: 'mem-1',
      loc: 'prompts:demo:start',
      content: 'Start content',
    });
    expect(result.promptForms['prompts:demo:end'].data).toMatchObject({
      _kind: 'updatePrompt',
      systemMemoryId: 'mem-1',
      loc: 'prompts:demo:end',
      content: '',
    });
    expect(Object.keys(result.edgeForms)).toEqual(['e1', 'e2']);
    expect(result.edgeForms.e1.data).toMatchObject({
      _kind: 'updateEdge',
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
      _kind: 'updateExtractionSpec',
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
      _kind: 'updateGoals',
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
    expect(result).toMatchObject({
      created: true,
      edgeId: 'e-new',
      form: {
        valid: true,
        data: { sourceNodeId: 'n1', targetNodeId: 'n2' },
        message: { type: 'success', text: 'Rule added.' },
      },
    });
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
    })) as { status: number; data: { form: { errors: { priority?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.priority?.[0]).toBe('Priority must be a whole number');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects missing endpoints before any mutation', async () => {
    const result = (await runAction('addEdge', {
      condition: 'null',
      priority: '0',
      data: '{}',
    })) as { status: number; data: { form: { errors: { sourceNodeId?: string[]; targetNodeId?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.sourceNodeId?.[0]).toBe('Source is required');
    expect(result.data.form.errors.targetNodeId?.[0]).toBe('Target is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before any mutation', async () => {
    const result = (await runAction('addEdge', {
      _kind: 'addConversation',
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      condition: 'null',
      priority: '0',
      data: '{}',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };

    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects non-object edge data before any mutation', async () => {
    const result = (await runAction('addEdge', {
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      name: 'x',
      condition: 'null',
      priority: '0',
      data: '[]',
    })) as { status: number; data: { form: { errors: { data?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.data?.[0]).toBe('Edge data must be a JSON object');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error message when edge creation fails', async () => {
    mockRequest.mockRejectedValueOnce({});
    const result = (await runAction('addEdge', {
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      name: 'x',
      condition: 'null',
      priority: '0',
      data: '{}',
    })) as { status: number; data: { form: { message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({
      type: 'error',
      text: 'Failed to create edge',
    });
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
