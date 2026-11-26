/**
 * convertToTask action (#503): flips isRunnable on via a minimal updateNode
 * patch (other fields preserved server-side), tags passed through.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY, UPDATE_NODE_MUTATION, UPDATE_TASK_NODE_MUTATION } from '$lib/server/queries';

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

const node = { id: 'pk', memoryId: 'mem-1', loc: 'classify', name: 'Classify', tags: ['keep'] };

async function runConvert(form: Record<string, string> = {}) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [key, value] of Object.entries(form)) fd.set(key, value);
  return actions.convertToTask({
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
  } as never);
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

describe('convertToTask action (#503)', () => {
  it('goes through the TASK KIND DOOR — the generic surface always refused this', async () => {
    // server #1201: a write that produces a runnable node may only go through
    // updateTaskNode, and this action's whole purpose is to produce one. So
    // "Convert to task" could never have worked since the doors landed —
    // every call returned "This write would produce a RUNNABLE node".
    //
    // This assertion used to name UPDATE_NODE_MUTATION and passed, because it
    // pinned the SHAPE of the payload and never the door it went through.
    mockRequest.mockImplementation((query: unknown) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === UPDATE_TASK_NODE_MUTATION) return { updateTaskNode: { id: 'pk' } };
      return {};
    });
    await runConvert();
    expect(mockRequest.mock.calls.some(([q]) => q === UPDATE_TASK_NODE_MUTATION)).toBe(true);
    expect(mockRequest.mock.calls.some(([q]) => q === UPDATE_NODE_MUTATION)).toBe(false);
  });

  it('sends a minimal isRunnable:true patch preserving tags', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === UPDATE_TASK_NODE_MUTATION) return { updateTaskNode: { id: 'pk' } };
      throw new Error('unexpected query');
    });
    const result = await runConvert();
    expect(result).toMatchObject({ convertedToTask: true });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Node converted to a task.' });
    const input = mockRequest.mock.calls.find(([q]) => q === UPDATE_TASK_NODE_MUTATION)![1].input;
    expect(input).toEqual({ memoryRef: 'mem-1', loc: 'classify', tags: ['keep'], isRunnable: true });
  });

  it('404s a missing node without mutating', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node: null };
      throw new Error('unexpected query');
    });
    const result = (await runConvert()) as { status: number };
    expect(result.status).toBe(404);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Node not found' });
    expect(mockRequest.mock.calls.some(([q]) => q === UPDATE_TASK_NODE_MUTATION)).toBe(false);
  });

  it('rejects a tampered form discriminator before looking up the node', async () => {
    const result = (await runConvert({ _kind: 'moveNode' })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
