/**
 * Conversation-editor actions (canvas rewrite). updateEdge saves the rule
 * panel's full set (name/priority/condition/data) with validation; addEdge
 * returns the created edge id so the canvas can select it; savePosition
 * merges data.position without clobbering the node's other data keys.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import { parse, visit, Kind } from 'graphql';
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
vi.mock('$lib/server/paginate', async (importOriginal) => ({
  ...(await importOriginal<typeof import('$lib/server/paginate')>()),
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
  name: 'addConversation' | 'addStage' | 'updateEdge' | 'updateExtractionSpec' | 'updateGoals' | 'moveConversation' | 'updateEntryCondition' | 'updatePrompt' | 'addEdge' | 'savePosition',
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
 * update. They also COMPOUND — vanish, then reappear — and the first cut of
 * #870 dropped that one: the fallback create had no conflict retry, so a path
 * the pre-#870 upsert recovered from became a 500. Three shapes, not two.
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

  // Race three: the two above COMPOUND. Deleted after the read, so the update
  // 404s and we fall through to create — and recreated before that create, so
  // it conflicts. Both halves are individually handled above; before #875 the
  // combination escaped as a 500, because the fallback create was a second
  // call site that had never been given the retry. The pre-#870 upsert
  // recovered here, so this is the regression case, not a new guarantee.
  it('adopts the winner when the node is deleted and recreated mid-save', async () => {
    let updateTried = false;
    let createTried = false;
    mockRequest.mockImplementation(async (query: string, vars: Record<string, unknown>) => {
      // The re-read after the conflict sees the winner, which made it runnable.
      if (vars && 'ref' in vars) {
        return { node: createTried ? { data: {}, role: null, isRunnable: true } : { data: {}, role: null, isRunnable: null } };
      }
      if (!updateTried) {
        updateTried = true;
        throw gqlError('NODE_NOT_FOUND');
      }
      if (!createTried) {
        createTried = true;
        throw gqlError('NodeLocConflictError');
      }
      return {};
    });
    const result = await runAction('updatePrompt', {
      systemMemoryId: 'mem-1',
      loc: PROMPT.ref,
      content: 'Contested prompt',
    });
    expect(result).toMatchObject({ form: { message: { type: 'success', text: 'Prompt saved.' } } });
    // update (404) → create (conflict) → update through the WINNER's door. The
    // task door, not the generic one the first read would have chosen: a retry
    // that reused the original document would be refused by the server.
    expect(writes()).toHaveLength(3);
    expect(writes()[2][0]).toBe(UPDATE_TASK_NODE_MUTATION);
    expect(writes()[2][1]).toEqual({
      input: { memoryId: 'mem-1', loc: PROMPT.ref, content: 'Contested prompt' },
    });
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

// --- S7 (#2064): start order and entry condition -----------------------------

type Row = { id: string; loc: string; seq: number | null; data?: Record<string, unknown> };

/** Route mock GraphQL traffic by document: list reads, per-node reads, writes. */
function routeConversationTraffic(
  rows: Row[],
  opts: { nodeData?: Record<string, Record<string, unknown>>; failWriteAt?: number; failWith?: unknown } = {},
) {
  const writes: Array<{ loc: string; input: Record<string, unknown> }> = [];
  mockRequest.mockImplementation(async (doc: string, vars?: Record<string, unknown>) => {
    if (typeof doc === 'string' && doc.includes('findNodes')) {
      if (vars?.offset) return { findNodes: { hits: [] } };
      return {
        findNodes: {
          hits: rows.map((r) => ({
            node: { memoryId: 'mem-1', nodeType: 'system', name: r.loc, description: null, data: {}, outgoingEdges: [], ...r },
          })),
        },
      };
    }
    if (typeof doc === 'string' && doc.includes('NodeDataByLoc')) {
      const loc = String(vars?.ref);
      return { node: { data: opts.nodeData?.[loc] ?? rows.find((r) => r.loc === loc)?.data ?? {}, role: null, isRunnable: null } };
    }
    const input = (vars as { input: Record<string, unknown> }).input;
    if (opts.failWriteAt !== undefined && writes.length === opts.failWriteAt) {
      writes.push({ loc: String(input.loc), input });
      throw opts.failWith ?? new Error('write refused');
    }
    writes.push({ loc: String(input.loc), input });
    return {};
  });
  return writes;
}

describe('moveConversation (start order, B4)', () => {
  const rows: Row[] = [
    { id: 'c1', loc: 'conversations:a', seq: 10 },
    { id: 'c2', loc: 'conversations:b', seq: 20 },
    { id: 'c3', loc: 'conversations:c', seq: 30 },
    { id: 'c4', loc: 'conversations:setup', seq: null, data: { isSetup: true } },
  ];

  it('writes only seq for the two swapped conversations, never data', async () => {
    const writes = routeConversationTraffic(rows);
    const result = await runAction('moveConversation', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:b', direction: 'earlier',
    });
    expect(result).toMatchObject({ form: { valid: true, message: { type: 'success' } } });
    expect(writes.map((w) => w.input)).toEqual([
      { memoryId: 'mem-1', loc: 'conversations:a', seq: 20 },
      { memoryId: 'mem-1', loc: 'conversations:b', seq: 10 },
    ]);
    expect(writes.every((w) => !('data' in w.input))).toBe(true);
  });

  it('renumbers every ordinary conversation 1..n when one has no seq, leaving setup alone', async () => {
    const writes = routeConversationTraffic([
      { id: 'c1', loc: 'conversations:a', seq: null },
      { id: 'c2', loc: 'conversations:b', seq: 7 },
      { id: 'c3', loc: 'conversations:setup', seq: null, data: { isSetup: true } },
    ]);
    await runAction('moveConversation', { systemMemoryId: 'mem-1', convLoc: 'conversations:a', direction: 'earlier' });
    // Displayed order b (7), a (no seq, so last); after the move a, b.
    expect(writes.map((w) => [w.loc, w.input.seq])).toEqual([
      ['conversations:a', 1],
      ['conversations:b', 2],
    ]);
  });

  it('stops at the first refused write: earlier writes stay, later ones are never attempted, and the error says it was partial', async () => {
    const writes = routeConversationTraffic(
      [
        { id: 'c1', loc: 'conversations:a', seq: null },
        { id: 'c2', loc: 'conversations:b', seq: null },
        { id: 'c3', loc: 'conversations:c', seq: null },
      ],
      { failWriteAt: 1 },
    );
    const result = (await runAction('moveConversation', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:c', direction: 'earlier',
    })) as { status: number; data: { form: { message: { type: string; text: string } } } };
    // Plan: a=1, c=2, b=3. Write 0 (a→1) lands, write 1 (c→2) is refused, b→3 is never tried.
    expect(writes).toHaveLength(2);
    expect(writes.every((w) => !('data' in w.input))).toBe(true);
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'Start order was only partly saved. Try again.' });
  });

  it('does not show the raw server message for a refused write', async () => {
    routeConversationTraffic(rows, { failWriteAt: 0, failWith: { response: { errors: [{ message: 'secret internals', extensions: { code: 'SOMETHING_ODD' } }] } } });
    const result = (await runAction('moveConversation', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:b', direction: 'earlier',
    })) as { data: { form: { message: { text: string } } } };
    expect(result.data.form.message.text).not.toContain('secret internals');
  });

  it('does nothing for a move off the end of the order', async () => {
    const writes = routeConversationTraffic(rows);
    const result = await runAction('moveConversation', { systemMemoryId: 'mem-1', convLoc: 'conversations:a', direction: 'earlier' });
    expect(result).toMatchObject({ form: { valid: true } });
    expect(writes).toEqual([]);
  });

  it('rejects a stage loc and an unknown direction before any request', async () => {
    const bad1 = (await runAction('moveConversation', { systemMemoryId: 'mem-1', convLoc: 'conversations:a:s', direction: 'earlier' })) as { status: number };
    const bad2 = (await runAction('moveConversation', { systemMemoryId: 'mem-1', convLoc: 'conversations:a', direction: 'sideways' })) as { status: number };
    expect(bad1.status).toBe(400);
    expect(bad2.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('updateEntryCondition', () => {
  const stored = {
    stageOrder: ['start', 'end'],
    goalDescriptions: ['Find a mentor'],
    goalSignals: ['I need help'],
    position: { x: 4, y: 8 },
    futureKey: { keep: true },
  };
  const cond = { '==': [{ var: 'memory.business_type' }, 'retail'] };

  it('writes data.entryCondition and keeps every other data key', async () => {
    const writes = routeConversationTraffic([{ id: 'c1', loc: 'conversations:demo', seq: 1, data: stored }]);
    const result = await runAction('updateEntryCondition', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:demo', condition: JSON.stringify(cond), intent: 'save',
    });
    expect(result).toMatchObject({ form: { valid: true, message: { type: 'success' } } });
    expect(writes[0].input).toEqual({
      memoryId: 'mem-1', loc: 'conversations:demo', data: { ...stored, entryCondition: cond },
    });
  });

  it('Clear removes only entryCondition', async () => {
    const writes = routeConversationTraffic([
      { id: 'c1', loc: 'conversations:demo', seq: 1, data: { ...stored, entryCondition: cond } },
    ]);
    await runAction('updateEntryCondition', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:demo', condition: JSON.stringify(cond), intent: 'clear',
    });
    expect(writes[0].input).toEqual({ memoryId: 'mem-1', loc: 'conversations:demo', data: stored });
  });

  it('saving an emptied builder clears the condition rather than storing null', async () => {
    const writes = routeConversationTraffic([
      { id: 'c1', loc: 'conversations:demo', seq: 1, data: { ...stored, entryCondition: cond } },
    ]);
    await runAction('updateEntryCondition', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:demo', condition: 'null', intent: 'save',
    });
    expect(writes[0].input.data).toEqual(stored);
  });

  it('refuses a chat.* variable before any request', async () => {
    const result = (await runAction('updateEntryCondition', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:demo',
      condition: JSON.stringify({ '>': [{ var: 'chat.message_count' }, 1] }), intent: 'save',
    })) as { status: number; data: { form: { errors: { condition?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.condition?.[0]).toBe('A start condition can use only memory and agent facts.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses to put a start condition on a setup or fallback conversation', async () => {
    const writes = routeConversationTraffic([{ id: 'c1', loc: 'conversations:setup', seq: null, data: { isSetup: true } }]);
    const result = (await runAction('updateEntryCondition', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:setup', condition: JSON.stringify(cond), intent: 'save',
    })) as { status: number };
    expect(result.status).toBe(400);
    expect(writes).toEqual([]);
  });

  it.each([
    ['SCOPE_NOT_AVAILABLE_AT_START', 'A start condition can use only memory and agent facts.'],
    ['INVALID_JSONLOGIC', "This start condition isn't valid. Check it and try again."],
    ['DISALLOWED_OPERATOR', "This start condition isn't valid. Check it and try again."],
    ['UNKNOWN_SCOPE', "This start condition isn't valid. Check it and try again."],
  ])('maps INVALID_ENTRY_CONDITION reason %s to its own copy, never the raw message', async (reason, text) => {
    routeConversationTraffic([{ id: 'c1', loc: 'conversations:demo', seq: 1, data: stored }], {
      failWriteAt: 0,
      failWith: {
        response: { errors: [{ message: 'raw server words', extensions: { code: 'INVALID_ENTRY_CONDITION', reason, detail: { field: 'chat.x' } } }] },
      },
    });
    const result = (await runAction('updateEntryCondition', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:demo', condition: JSON.stringify(cond), intent: 'save',
    })) as { status: number; data: { form: { message: { type: string; text: string } } } };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text });
  });

  it('maps an unknown INVALID_ENTRY_CONDITION reason to the generic save error', async () => {
    routeConversationTraffic([{ id: 'c1', loc: 'conversations:demo', seq: 1, data: stored }], {
      failWriteAt: 0,
      failWith: { response: { errors: [{ message: 'raw server words', extensions: { code: 'INVALID_ENTRY_CONDITION', reason: 'FUTURE_REASON' } }] } },
    });
    const result = (await runAction('updateEntryCondition', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:demo', condition: JSON.stringify(cond), intent: 'save',
    })) as { data: { form: { message: { text: string } } } };
    expect(result.data.form.message.text).toBe('Failed to save the start condition.');
  });
});


describe('load', () => {
  it('seeds a Superform for each rendered conversation edge', async () => {
    mockFetchAllItems.mockResolvedValueOnce([
      { id: 'org-1', agents: [{ id: 'agent-1', systemMemoryId: 'mem-1' }] },
    ]);
    mockRequest.mockImplementation(async (_doc: string, v?: { offset?: number }) => (v?.offset ? { findNodes: { hits: [] } } : {
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
    }));

    const result = (await runLoad()) as {
      addConversationForm: { data: { _kind: string; systemMemoryId: string; name: string } };
      addEdgeForm: { data: { _kind: string; sourceNodeId: string; targetNodeId: string; name: string; condition: string; priority: string; data: string } };
      addStageForms: Record<string, { data: { _kind: string; systemMemoryId: string; conversationLoc: string; stageName: string } }>;
      promptForms: Record<string, { data: { _kind: string; systemMemoryId: string; loc: string; content: string } }>;
      edgeForms: Record<string, { data: { _kind: string; edgeId: string; name: string; priority: string; condition: string; data: string } }>;
      conversationGoalForms: Record<string, { data: { _kind: string; systemMemoryId: string; convLoc: string; goalDescriptionsText: string; goalSignalsText: string } }>;
      stageExtractionForms: Record<string, { data: { _kind: string; systemMemoryId: string; stageLoc: string; extractionSpec: string } }>;
    };
    // edgeForms / stageExtractionForms / promptForms hold one form per row, but
    // the page mounts only the SELECTED (or editing) row's form, so each record
    // counts once.
    const { edgeForms, stageExtractionForms, promptForms, ...mounted } = result as Record<string, Record<string, unknown>>;
    expectDistinctFormIds({
      ...mounted,
      edge: Object.values(edgeForms)[0],
      stage: Object.values(stageExtractionForms ?? {})[0],
      prompt: Object.values(promptForms ?? {})[0],
    }, 5);

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
    mockRequest.mockImplementation(async (_doc: string, v?: { offset?: number }) => (v?.offset ? { findNodes: { hits: [] } } : {
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
    }));

    const result = (await runLoad()) as { edgeForms: Record<string, unknown> };

    expect(result.edgeForms).toEqual({});
  });

  it('does not seed a form for an edge whose target is missing', async () => {
    mockFetchAllItems.mockResolvedValueOnce([
      { id: 'org-1', agents: [{ id: 'agent-1', systemMemoryId: 'mem-1' }] },
    ]);
    mockRequest.mockImplementation(async (_doc: string, v?: { offset?: number }) => (v?.offset ? { findNodes: { hits: [] } } : {
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
    }));

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

/**
 * #870's routing, across EVERY action that updates a node — not just the one
 * the defect was reported on.
 *
 * `updatePrompt` was the flow #870 was filed against, and until this block it
 * was also the only flow whose door was asserted. The other four update
 * conversation and stage nodes, which are converted to tasks by exactly the
 * same means — that conversion is what @Holger's ruling was about, and the
 * server refuses a generic `updateNode` against the result no matter which
 * form posted it. `check-node-write-doors` is the backstop, but a gate proves
 * the CALL is routed; only a test proves the routing picks the right door.
 *
 * Pinned in both directions per case. A governed node must take its own door,
 * AND a plain one must still take the generic door — an assertion that only
 * ever checks the task door also passes on a router that sends everything
 * there, which would break every ordinary save in the editor.
 */
describe('the kind door, across every routed write', () => {
  /** Reads (the calls carrying `ref`) serve `node`; writes resolve. */
  function serve(node: Record<string, unknown>) {
    mockRequest.mockImplementation(async (_query: string, vars: Record<string, unknown>) =>
      vars && 'ref' in vars ? { node } : {},
    );
  }
  /** The document of the LAST write — the routed one in each of these flows. */
  function lastWriteDocument() {
    const writes = mockRequest.mock.calls.filter(([, vars]) => !(vars && 'ref' in vars));
    return writes[writes.length - 1][0];
  }

  const PLAIN = { data: {}, role: null, isRunnable: null };
  const TASK = { data: {}, role: null, isRunnable: true };

  const routed: Array<[string, Parameters<typeof runAction>[0], Record<string, string>]> = [
    ['addStage', 'addStage', {
      systemMemoryId: 'mem-1', conversationLoc: 'conversations:demo', stageName: 'Gather Details',
    }],
    ['updateExtractionSpec', 'updateExtractionSpec', {
      systemMemoryId: 'mem-1', stageLoc: 'conversations:demo:start', extractionSpec: '[]',
    }],
    ['updateGoals', 'updateGoals', {
      systemMemoryId: 'mem-1', convLoc: 'conversations:demo',
      goalDescriptionsText: 'Find a mentor', goalSignalsText: 'I need help',
    }],
    ['savePosition', 'savePosition', {
      systemMemoryId: 'mem-1', loc: 'conversations:demo', x: '10', y: '20',
    }],
    ['updatePrompt', 'updatePrompt', {
      systemMemoryId: 'mem-1', loc: 'prompts:demo:start', content: 'x',
    }],
  ];

  it.each(routed)('%s sends a governed node through its own door', async (_label, action, fields) => {
    serve(TASK);
    await runAction(action, fields);
    expect(lastWriteDocument()).toBe(UPDATE_TASK_NODE_MUTATION);
  });

  it.each(routed)('%s still sends a plain node through the generic door', async (_label, action, fields) => {
    serve(PLAIN);
    await runAction(action, fields);
    expect(lastWriteDocument()).toBe(UPDATE_NODE_MUTATION);
  });

  /**
   * The anti-vacuity floor. If an action stops routing — or is removed from
   * the table — the two blocks above keep passing on whatever is left, which
   * is the shape of a suite that tests less than it did yesterday without
   * saying so (hrn:node:hadronmemory.com:hadron-portal:review:a-floor-must-not-count-the-gates-own-tests,
   * from the other side: a floor on COVERAGE rather than on corpus size).
   */
  it('covers every nodeUpdateDocument call site in the action file', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('./+page.server.ts', import.meta.url),
      'utf8',
    );
    // Six call sites, five actions: updatePrompt routes from two of them (the
    // ordinary update and the adopt-the-winner retry).
    const callSites = src.match(/client\.request\(nodeUpdateDocument\(/g) ?? [];
    expect(callSites).toHaveLength(6);
    expect(routed).toHaveLength(5);
  });
});

// #874: memory scope and node type are independent server filters. Model the
// documented default with mixed system/info nodes, not an unconditional mock.
describe('system conversation retrieval (#874)', () => {
  const nodes = [
    { id: 'conv', memoryId: 'mem-1', nodeType: 'system', loc: 'conversations:setup', name: 'Setup', data: { stageOrder: ['start'] }, outgoingEdges: [] },
    { id: 'stage', memoryId: 'mem-1', nodeType: 'system', loc: 'conversations:setup:start', name: 'Start', data: { promptRef: 'prompts:setup:start' }, outgoingEdges: [] },
    { id: 'prompt', memoryId: 'mem-1', nodeType: 'system', loc: 'prompts:setup:start', name: 'Prompt', content: 'Hello', outgoingEdges: [] },
    { id: 'info', memoryId: 'mem-1', nodeType: 'info', loc: 'notes', name: 'Notes', outgoingEdges: [] },
  ];
  function serve(rows: Array<Record<string, unknown>> = nodes) {
    mockFetchAllItems.mockResolvedValue([{ id: 'org-1', agents: [{ id: 'agent-1', systemMemoryId: 'mem-1' }] }]);
    mockRequest.mockImplementation(async (document: string, vars: Record<string, unknown>) => {
      expect(vars.memoryIds).toEqual(['mem-1']);
      let requested: string | undefined;
      visit(parse(document), { ObjectField(arg) {
        if (arg.name.value === 'nodeType') {
          if (arg.value.kind === Kind.STRING) requested = arg.value.value;
          if (arg.value.kind === Kind.VARIABLE) requested = vars[arg.value.name.value] as string | undefined;
        }
      } });
      const visible = rows.filter(n => requested ? n.nodeType === requested : n.nodeType !== 'system');
      return { findNodes: { hits: (vars.offset as number) > 0 ? [] : visible.map(node => ({ node })) } };
    });
  }
  it('retrieves existing conversations, stages and prompts from a mixed-type system memory', async () => {
    serve();
    const result = await runLoad() as any;
    expect(result.systemNodes.map((n: {id: string}) => n.id)).toEqual(['info', 'conv', 'stage', 'prompt']);
    expect(result.prompts.map((n: {id: string}) => n.id)).toEqual(['prompt']);
    expect(result.addStageForms.conv).toBeDefined();
    expect(result.promptForms['prompts:setup:start'].data.content).toBe('Hello');
  });
  it('retains directly authored non-system conversations, stages and prompts alongside system nodes', async () => {
    const direct = [
      { id: 'direct', memoryId: 'mem-1', nodeType: 'info', loc: 'conversations:direct', name: 'Direct', data: {}, outgoingEdges: [] },
      { id: 'direct-stage', memoryId: 'mem-1', nodeType: 'info', loc: 'conversations:direct:start', name: 'Start', data: { promptRef: 'prompts:direct:start' }, outgoingEdges: [] },
      { id: 'direct-prompt', memoryId: 'mem-1', nodeType: 'info', loc: 'prompts:direct:start', name: 'Prompt', content: 'Direct prompt', outgoingEdges: [] },
    ];
    serve([...nodes, ...direct]);
    const result = await runLoad() as any;
    expect(result.systemNodes.map((n: { id: string }) => n.id)).toEqual(expect.arrayContaining(['conv', 'stage', 'prompt', 'direct', 'direct-stage', 'direct-prompt']));
    expect(result.addStageForms.direct).toBeDefined();
    expect(result.promptForms['prompts:direct:start'].data.content).toBe('Direct prompt');
  });
  it('deduplicates overlapping responses and excludes nodes outside the scoped memory', async () => {
    serve();
    mockRequest.mockImplementation(async (_doc: string, v?: { offset?: number }) => (v?.offset ? { findNodes: { hits: [] } } : { findNodes: { hits: [...nodes, { ...nodes[0], id: 'foreign', memoryId: 'mem-other' }].map(node => ({ node })) } }));
    const result = await runLoad() as any;
    expect(result.systemNodes.map((n: { id: string }) => n.id)).toEqual(['conv', 'stage', 'prompt', 'info']);
  });
  it.each([undefined, 'system'])('fails instead of showing a partial canvas when the %s read fails', async (failedType) => {
    serve();
    const normalRead = mockRequest.getMockImplementation()!;
    mockRequest.mockImplementation((document: string, vars: Record<string, unknown>) => {
      if (vars.nodeType === failedType) throw new Error('Nodes unavailable');
      return normalRead(document, vars);
    });
    await expect(runLoad()).rejects.toThrow('Nodes unavailable');
  });
  it('keeps a genuinely empty system memory empty without inventing a read failure', async () => {
    serve([]);
    const result = await runLoad() as any;
    expect(result.systemNodes).toEqual([]);
    expect(result.prompts).toEqual([]);
    expect(result.addStageForms).toEqual({});
  });
});
