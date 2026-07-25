/**
 * Run detail loader (#478 phase 3): URL correction to the run's canonical
 * org/app, and graceful envelope degradation on servers without
 * hadron-server#534 (where selecting AppRun.data errors the whole query).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_QUERY, APP_RUN_QUERY, APP_RUN_ENVELOPE_QUERY, CANCEL_APP_RUN_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('$app/navigation', () => ({
  beforeNavigate: () => {},
  goto: vi.fn(),
  invalidateAll: vi.fn(),
}));
vi.mock('$app/forms', () => ({
  applyAction: vi.fn(),
  deserialize: vi.fn(),
  enhance: () => ({}),
}));
vi.mock('$app/environment', () => ({ browser: false, dev: false, building: false, version: 'test' }));
vi.mock('$app/stores', async () => {
  const { readable } = await import('svelte/store');
  return {
    page: readable({
      url: new URL('https://example.test/app/orgs/org-1/apps/app-1/runs/run-1'),
      params: {},
      route: { id: null },
      status: 200,
      error: null,
      data: {},
      form: null,
    }),
  };
});

beforeEach(() => {
  mockRequest.mockReset();
});

const app = { id: 'app-1', name: 'Digest', organizationId: 'org-1' };
const run = {
  id: 'run-1',
  organizationId: 'org-1',
  appId: 'app-1',
  status: 'COMPLETED',
  entryNodeUrn: 'acme.com::flows::classify',
  triggerKind: 'MANUAL',
  eventData: null,
  failure: null,
  attempts: 1,
  startedAt: '1000',
  finishedAt: '2000',
  createdAt: '900',
};

function routeByQuery(opts: { envelope?: unknown; envelopeError?: boolean; run?: unknown }) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === APP_QUERY) return { app };
    if (query === APP_RUN_QUERY) return { appRun: 'run' in opts ? opts.run : run };
    if (query === APP_RUN_ENVELOPE_QUERY) {
      if (opts.envelopeError) throw new Error('Cannot query field "data" on type "AppRun".');
      return { appRun: { id: 'run-1', data: opts.envelope ?? null } };
    }
    throw new Error(`unexpected query: ${query.slice(0, 60)}`);
  });
}

async function runLoad(params = { id: 'org-1', appId: 'app-1', runId: 'run-1' }) {
  const { load } = await import('./+page.server');
  return load({
    params,
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({ isConsumerMode: false }),
  } as never);
}

function actionEvent(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    request: { formData: async () => fd },
    params: { id: 'org-1', appId: 'app-1', runId: 'run-1' },
    locals: { token: 'tok' },
  };
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message } };
    form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message };
  } | undefined)?.form;
}

describe('run detail load', () => {
  it('returns the run with its envelope when the server supports it', async () => {
    routeByQuery({ envelope: { intent: 'question' } });
    const result = (await runLoad()) as {
      run: unknown;
      envelope: unknown;
      envelopeSupported: boolean;
      cancelForm: { data: { _kind: string } };
    };
    expect(result.run).toMatchObject({ id: 'run-1' });
    expect(result.envelope).toEqual({ intent: 'question' });
    expect(result.envelopeSupported).toBe(true);
    expect(result.cancelForm.data._kind).toBe('cancelRun');
  });

  it('degrades to envelopeSupported=false on a pre-#534 server instead of erroring', async () => {
    routeByQuery({ envelopeError: true });
    const result = (await runLoad()) as { run: unknown; envelope: unknown; envelopeSupported: boolean };
    expect(result.run).toMatchObject({ id: 'run-1' });
    expect(result.envelope).toBeNull();
    expect(result.envelopeSupported).toBe(false);
  });

  it('redirects a wrong-app URL to the run’s canonical (org-independent) page', async () => {
    // #648: the canonical route is org-independent — the correction now keys on
    // appId only and redirects to /app/apps/[appId]/runs/[runId].
    routeByQuery({});
    await expect(runLoad({ id: 'org-1', appId: 'app-OTHER', runId: 'run-1' })).rejects.toMatchObject({
      status: 303,
      location: '/app/apps/app-1/runs/run-1',
    });
  });

  it('404s a missing run', async () => {
    routeByQuery({ run: null });
    await expect(runLoad()).rejects.toMatchObject({ status: 404 });
  });
});

describe('run detail cancel action', () => {
  it('cancels a run and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce(true);
    const { actions } = await import('./+page.server');

    const result = await actions.cancel(actionEvent() as never);

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'cancelRun' },
        message: { type: 'success', text: 'Run cancellation requested.' },
      },
    });
    expect(mockRequest).toHaveBeenCalledWith(CANCEL_APP_RUN_MUTATION, { id: 'run-1' });
  });

  it('rejects cancel POSTs with the wrong form discriminator', async () => {
    const { actions } = await import('./+page.server');

    const result = await actions.cancel(actionEvent({ _kind: 'runFlow' }) as never);

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when cancellation fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('already completed'));
    const { actions } = await import('./+page.server');

    const result = await actions.cancel(actionEvent() as never);

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'already completed',
    });
  });
});
