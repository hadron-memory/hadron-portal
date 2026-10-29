import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { DELETE_EDGE_MUTATION } from '$lib/server/queries';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import type { Actions } from './$types';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEvent(form: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(form)) formData.append(key, value);
  return {
    params: { id: 'mem-A', nodeId: 'source-pk', edgeId: 'edge-pk' },
    locals: { token: 'tok' },
    request: { formData: async () => formData },
  } as unknown as Parameters<Actions[keyof Actions]>[0];
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

describe('edge detail load: form ids (#1320)', () => {
  it('gives the update and delete forms their own Superforms ids', async () => {
    const edge = { id: 'edge-pk', name: 'next', isRunnable: false, priority: 0, condition: null, data: null };
    mockRequest.mockResolvedValue({
      node: { id: 'source-pk', memoryId: 'mem-A', loc: 'a:b', name: 'B', data: {}, incomingEdges: [], outgoingEdges: [edge] },
    });
    const { load } = await import('./+page.server');
    const result = await load({
      params: { id: 'mem-A', nodeId: 'source-pk', edgeId: 'edge-pk' },
      locals: { token: 'tok' },
      parent: async () => ({ isConsumerMode: false }),
    } as never);
    expectDistinctFormIds(result, 2);
  });
});

describe('edge detail update action Superforms validation', () => {
  it('updates an edge with normalized parser-backed fields and a typed success message', async () => {
    mockRequest.mockResolvedValueOnce({ updateEdge: { id: 'edge-pk' } });

    const actions = await importActions();
    const result = await actions.update(actionEvent({
      name: ' next.1.high ',
      description: ' edge description ',
      isRunnable: 'true',
      priority: '1e2',
      condition: '{"var":"message.data.confidence"}',
      data: '{"threshold":0.8}',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, {
      edgeId: string;
      name: string;
      description: string;
      isRunnable: boolean;
      priority: number;
      condition: unknown;
      data: unknown;
    }];
    expect(vars).toMatchObject({
      edgeRef: 'edge-pk',
      name: 'next.1.high',
      description: 'edge description',
      isRunnable: true,
      priority: 100,
    });
    expect(vars.condition).toEqual({ var: 'message.data.confidence' });
    expect(vars.data).toEqual({ threshold: 0.8 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Edge saved.' });
  });

  it('returns a priority field error before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.update(actionEvent({
      name: 'edge',
      priority: '1.5',
      condition: 'null',
      data: '',
    }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'priority')).toBe('Priority must be a whole number');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a condition field error before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.update(actionEvent({
      name: 'edge',
      priority: '0',
      condition: '{not json',
      data: '',
    }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'condition')).toBe('Invalid condition expression');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a data field error before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.update(actionEvent({
      name: 'edge',
      priority: '0',
      condition: 'null',
      data: '{not json',
    }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'data')).toMatch(/^Invalid JSON:/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a data field error for oversized JSON before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.update(actionEvent({
      name: 'edge',
      priority: '0',
      condition: 'null',
      data: JSON.stringify({ blob: 'x'.repeat(300_000) }),
    }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'data')).toMatch(/too large/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.update(actionEvent({
      _kind: 'deleteEdge',
      name: 'edge',
      priority: '0',
      condition: 'null',
      data: '',
    }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('defaults omitted priority to 0 and unchecked runnable to false', async () => {
    mockRequest.mockResolvedValueOnce({ updateEdge: { id: 'edge-pk' } });

    const actions = await importActions();
    await actions.update(actionEvent({
      name: 'edge',
      condition: 'null',
      data: '',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, {
      priority: number;
      isRunnable: boolean;
      data: unknown;
    }];
    expect(vars.priority).toBe(0);
    expect(vars.isRunnable).toBe(false);
    expect(vars.data).toBeNull();
  });

  it('returns update failures as typed Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('edge save exploded'));

    const actions = await importActions();
    const result = await actions.update(actionEvent({
      name: 'edge',
      priority: '0',
      condition: 'null',
      data: '',
    }));

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'edge save exploded' });
  });
});

describe('edge detail delete action Superforms validation', () => {
  it('deletes the edge and redirects to the source node', async () => {
    mockRequest.mockResolvedValueOnce({ deleteEdge: true });

    const actions = await importActions();
    let result: unknown;
    try {
      result = await actions.delete(actionEvent({ _kind: 'deleteEdge' }));
    } catch (e: unknown) {
      result = e;
    }

    expect(mockRequest).toHaveBeenCalledWith(DELETE_EDGE_MUTATION, { edgeRef: 'edge-pk' });
    expect(result).toMatchObject({
      status: 303,
      location: '/app/memories/mem-A/nodes/source-pk',
    });
  });

  it('rejects a tampered form discriminator before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.delete(actionEvent({ _kind: 'updateEdge' }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns delete failures as typed Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('edge delete exploded'));

    const actions = await importActions();
    const result = await actions.delete(actionEvent({ _kind: 'deleteEdge' }));

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'edge delete exploded' });
  });
});

// portal#1142 P0a — an INCLUDE edge is derived from its source node's content
// (hadron-server#2040); editing or deleting it directly is refused with
// INCLUDE_EDGE_DERIVED. The refusal is shown with the server's words and the
// way forward. Every GraphQL failure now shows the server's first error
// message, not graphql-request's raw ClientError text (query and variables).
describe('edge detail: include-derived refusal', () => {
  function gqlError(code: string, message: string) {
    return Object.assign(new Error('raw ClientError text {"query":"mutation …"}'), {
      response: { errors: [{ message, extensions: { code } }] },
    });
  }
  const derived = () => gqlError('INCLUDE_EDGE_DERIVED', "This edge is derived from an include tag in the source node's content; edit that content instead.");

  it('update answers 409 with the server message and the next step', async () => {
    mockRequest.mockRejectedValueOnce(derived());
    const actions = await importActions();
    const result = await actions.update(actionEvent({ name: 'edge', priority: '0', condition: 'null', data: '' }));
    expect(result).toMatchObject({ status: 409 });
    const text = (superFormFrom(result)?.message as { text: string }).text;
    expect(text).toContain('This edge is derived from an include tag');
    expect(text).toContain("change that node's content instead");
  });

  it('delete answers 409 the same way, and does not redirect', async () => {
    mockRequest.mockRejectedValueOnce(derived());
    const actions = await importActions();
    const result = await actions.delete(actionEvent({ _kind: 'deleteEdge' }));
    expect(result).toMatchObject({ status: 409 });
    expect((superFormFrom(result)?.message as { text: string }).text).toContain('This edge is derived from an include tag');
  });

  it.each(['update', 'delete'] as const)('%s shows another GraphQL refusal by its message, never the raw ClientError text', async (action) => {
    mockRequest.mockRejectedValueOnce(gqlError('FORBIDDEN', 'You cannot change this edge.'));
    const actions = await importActions();
    const result = action === 'update'
      ? await actions.update(actionEvent({ name: 'edge', priority: '0', condition: 'null', data: '' }))
      : await actions.delete(actionEvent({ _kind: 'deleteEdge' }));
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'You cannot change this edge.' });
  });
});

// Gene's blind P2 on #1155: graphql-request also throws ClientError for a
// response with no GraphQL errors (a 503, say), and its message embeds the
// request query and variables. Without a server message the page shows the
// safe fallback, never that text. A plain Error keeps its message.
describe('edge detail: a payloadless ClientError never shows its request', () => {
  function payloadless() {
    return new ClientError(
      { status: 503, headers: new Headers() } as never,
      { query: 'mutation SecretEdgeQuery { updateEdge }', variables: { sentinel: 'PRIVATE-DRAFT' } } as never,
    );
  }

  it.each(['update', 'delete'] as const)('%s shows the fallback, not the query or variables', async (action) => {
    mockRequest.mockRejectedValueOnce(payloadless());
    const actions = await importActions();
    const result = action === 'update'
      ? await actions.update(actionEvent({ name: 'edge', priority: '0', condition: 'null', data: '' }))
      : await actions.delete(actionEvent({ _kind: 'deleteEdge' }));
    expect(result).toMatchObject({ status: 500 });
    const text = (superFormFrom(result)?.message as { text: string }).text;
    expect(text).not.toContain('SecretEdgeQuery');
    expect(text).not.toContain('PRIVATE-DRAFT');
    expect(text).toBe(action === 'update' ? 'Failed to update edge' : 'Failed to delete edge');
  });
});
