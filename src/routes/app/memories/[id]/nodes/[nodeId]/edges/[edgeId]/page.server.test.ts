import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      edgeId: 'edge-pk',
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
