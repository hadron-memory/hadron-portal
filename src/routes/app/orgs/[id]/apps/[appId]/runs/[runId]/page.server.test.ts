/**
 * Run detail loader (#478 phase 3): URL correction to the run's canonical
 * org/app, and graceful envelope degradation on servers without
 * hadron-server#534 (where selecting AppRun.data errors the whole query).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_QUERY, APP_RUN_QUERY, APP_RUN_ENVELOPE_QUERY } from '$lib/server/queries';

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

describe('run detail load', () => {
  it('returns the run with its envelope when the server supports it', async () => {
    routeByQuery({ envelope: { intent: 'question' } });
    const result = (await runLoad()) as { run: unknown; envelope: unknown; envelopeSupported: boolean };
    expect(result.run).toMatchObject({ id: 'run-1' });
    expect(result.envelope).toEqual({ intent: 'question' });
    expect(result.envelopeSupported).toBe(true);
  });

  it('degrades to envelopeSupported=false on a pre-#534 server instead of erroring', async () => {
    routeByQuery({ envelopeError: true });
    const result = (await runLoad()) as { run: unknown; envelope: unknown; envelopeSupported: boolean };
    expect(result.run).toMatchObject({ id: 'run-1' });
    expect(result.envelope).toBeNull();
    expect(result.envelopeSupported).toBe(false);
  });

  it('redirects a wrong org/app URL to the run’s canonical page', async () => {
    routeByQuery({});
    await expect(runLoad({ id: 'org-OTHER', appId: 'app-1', runId: 'run-1' })).rejects.toMatchObject({
      status: 303,
      location: '/app/orgs/org-1/apps/app-1/runs/run-1',
    });
  });

  it('404s a missing run', async () => {
    routeByQuery({ run: null });
    await expect(runLoad()).rejects.toMatchObject({ status: 404 });
  });
});
