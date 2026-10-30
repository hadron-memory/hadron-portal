import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_BY_ID_QUERY, RUN_TASK_APP_MUTATION } from '$lib/server/queries';

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

async function runTestFlow(fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return actions.testFlow({
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

const node = {
  id: 'pk',
  memoryId: 'mem-1',
  loc: 'flows:classify',
  name: 'Classify',
  memory: { id: 'mem-1', urn: 'acme.com::flows', name: 'Flows' },
};

describe('testFlow action Superforms validation', () => {
  it('runs the node as the selected app and redirects to the run page', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === RUN_TASK_APP_MUTATION) return { runTask: 'run-1' };
      throw new Error('unexpected query');
    });

    await expect(runTestFlow({
      _kind: 'testFlow',
      appId: 'app-1',
      orgId: 'org-1',
      payload: '{"confidence":0.9}',
    })).rejects.toMatchObject({
      status: 303,
      location: '/app/apps/app-1/runs/run-1',
    });
    expect(mockRequest.mock.calls.find(([query]) => query === RUN_TASK_APP_MUTATION)?.[1]).toEqual({
      nodeRef: 'hrn:node:acme.com:flows:flows:classify',
      args: { confidence: 0.9 },
      appRef: 'app-1',
      runAsSelf: false,
    });
  });

  it('rejects invalid JSON before looking up the node', async () => {
    const result = (await runTestFlow({
      _kind: 'testFlow',
      appId: 'app-1',
      orgId: 'org-1',
      payload: '{nope',
    })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?.payload?.[0]).toBe('The test payload must be valid JSON.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a missing app id before looking up the node', async () => {
    const result = (await runTestFlow({
      _kind: 'testFlow',
      orgId: 'org-1',
      payload: '',
    })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?.appId?.[0]).toBe('Pick an App to run as.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects non-object JSON payloads before looking up the node', async () => {
    const result = (await runTestFlow({
      _kind: 'testFlow',
      appId: 'app-1',
      orgId: 'org-1',
      payload: '[]',
    })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?.payload?.[0]).toBe('The test payload must be a JSON object of named fields.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before looking up the node', async () => {
    const result = (await runTestFlow({
      _kind: 'moveNode',
      appId: 'app-1',
      orgId: 'org-1',
      payload: '',
    })) as { status: number };

    expect(result.status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// portal#1444 (hadron-server#2849): the same choice on the node page's "Test this flow".
describe('testFlow action: choosing the Agent (#1444)', () => {
  const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });
  const base = { _kind: 'testFlow', appId: 'app-1', orgId: 'org-1', payload: '' };

  function answer(run: () => unknown) {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === NODE_BY_ID_QUERY) return { node };
      if (query === RUN_TASK_APP_MUTATION) return run();
      throw new Error('unexpected query');
    });
  }
  const sent = () => mockRequest.mock.calls.find(([q]) => q === RUN_TASK_APP_MUTATION)?.[1];

  it('sends agentRef when an Agent was chosen', async () => {
    answer(() => ({ runTask: 'run-1' }));
    await expect(runTestFlow({ ...base, agentRef: 'ag-b' })).rejects.toMatchObject({ status: 303 });
    expect(sent()).toMatchObject({ appRef: 'app-1', agentRef: 'ag-b' });
  });

  it('sends no agentRef key when none was chosen', async () => {
    answer(() => ({ runTask: 'run-1' }));
    await expect(runTestFlow({ ...base, agentRef: '' })).rejects.toMatchObject({ status: 303 });
    expect(sent()).not.toHaveProperty('agentRef');
  });

  it('RUN_AGENT_REQUIRED reads as a plain prompt to choose an Agent, never as the code', async () => {
    answer(() => { throw gqlError('RUN_AGENT_REQUIRED', 'RUN_AGENT_REQUIRED: name one of the installed Agents'); });
    const result = await runTestFlow(base);
    const text = (superFormFrom(result)?.message as { text: string }).text;
    expect(text).toMatch(/choose an agent/i);
    expect(text).not.toContain('RUN_AGENT_REQUIRED');
  });

  // portal#1454 — a correctable refusal is the reader's input, not a server fault.
  it('RUN_AGENT_REQUIRED answers 400; any other failure to start stays 500', async () => {
    answer(() => { throw gqlError('RUN_AGENT_REQUIRED', 'RUN_AGENT_REQUIRED: name one of the installed Agents'); });
    expect(((await runTestFlow(base)) as { status: number }).status).toBe(400);

    answer(() => { throw new Error('boom'); });
    expect(((await runTestFlow(base)) as { status: number }).status).toBe(500);
  });
});
