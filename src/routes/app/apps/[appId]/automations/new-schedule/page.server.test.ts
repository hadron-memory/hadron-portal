/**
 * portal#1701 — creating a schedule. The browser sends a plain choice and a picked node; the server action writes
 * the cron, sends the zone explicitly, and shows a refusal in plain words. The portal adds no gate of its own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { CREATE_AGENT_SCHEDULE_MUTATION } from '$lib/server/automation-schedule';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: 'org-1' };
const refusal = (code: string) => new ClientError({ status: 200, errors: [{ message: 'raw words: stored run-as user', extensions: { code } }] } as never, { query: 'mutation X { y }', variables: {} });
const NODE = 'hrn:node:acme.com:ops:digest';

const body = (entries: Record<string, string | string[]>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) for (const x of Array.isArray(v) ? v : [v]) f.append(k, x);
  return f;
};
async function submit(entries: Record<string, string | string[]>) {
  const { actions } = await import('./+page.server');
  return (actions as { default: (e: unknown) => Promise<unknown> }).default({
    request: { formData: async () => body(entries) },
    params: { appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'u1' }, impersonation: null },
  });
}
const good = { entryNodeUrn: NODE, entryName: 'Daily digest', zone: 'Europe/Berlin', when: 'daily', time: '09:00' };

beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === CREATE_AGENT_SCHEDULE_MUTATION) return { createAgentSchedule: { id: 'new-1' } };
    throw new Error(`unexpected ${q}`);
  });
});
const sent = () => request.mock.calls.find((c) => c[0] === CREATE_AGENT_SCHEDULE_MUTATION)?.[1];

describe('create action', () => {
  it('writes the cron from the plain choice, names the schedule from what runs, and sends the zone explicitly', async () => {
    await expect(submit(good)).rejects.toMatchObject({ status: 303, location: '/app/apps/app-1/automations/schedule/new-1?created=1' });
    expect(sent()).toEqual({ input: { appRef: 'app-1', name: 'Daily digest', entryNodeUrn: NODE, cron: '0 9 * * *', timezone: 'Europe/Berlin' } });
  });

  it('uses a named non-UTC zone as given (acceptance 2), including for a one-shot', async () => {
    await expect(submit({ ...good, when: 'once', date: '2026-11-05', time: '14:30' })).rejects.toMatchObject({ status: 303 });
    expect(sent()).toEqual({ input: { appRef: 'app-1', name: 'Daily digest', entryNodeUrn: NODE, runAt: '2026-11-05T13:30:00.000Z', timezone: 'Europe/Berlin' } });
  });

  it('ignores a cron smuggled into the body', async () => {
    await expect(submit({ ...good, cron: '* * * * *' })).rejects.toMatchObject({ status: 303 });
    expect((sent() as { input: { cron: string } }).input.cron).toBe('0 9 * * *');
  });

  it('asks for what runs when none was picked, and writes nothing', async () => {
    const r = await submit({ ...good, entryNodeUrn: '' });
    expect(r).toMatchObject({ status: 400, data: { failure: { field: 'entry' } } });
    expect(sent()).toBeUndefined();
  });

  it('asks for the zone rather than letting the server default to UTC', async () => {
    const r = await submit({ ...good, zone: '' });
    expect(r).toMatchObject({ status: 400, data: { failure: { field: 'when' } } });
    expect(sent()).toBeUndefined();
  });

  it('names the field when the timing is wrong, and writes nothing', async () => {
    expect(await submit({ ...good, time: 'late' })).toMatchObject({ status: 400, data: { failure: { field: 'time' } } });
    expect(sent()).toBeUndefined();
  });

  it('a non-admin create is refused in plain words: who to ask, none of the server words', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw refusal('FORBIDDEN'); });
    const r = (await submit(good)) as { status: number; data: { failure: { field: string; message: string } } };
    expect(r.status).toBe(403);
    expect(r.data.failure.field).toBe('create'); // the create screen renders this field (it has no name input)
    expect(r.data.failure.message).toMatch(/organization admin/i);
    expect(JSON.stringify(r)).not.toMatch(/FORBIDDEN|run-as|raw words|mutation/);
  });

  it('lets an unknown failure through rather than calling it a refusal', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw refusal('INTERNAL_SERVER_ERROR'); });
    await expect(submit(good)).rejects.toBeInstanceOf(ClientError);
  });

  it('a viewer who cannot see the App gets its 404', async () => {
    request.mockRejectedValue({ response: { errors: [{ message: 'x', extensions: { code: 'NOT_FOUND' } }] } });
    await expect(submit(good)).rejects.toMatchObject({ status: 404 });
  });
});

describe('create load', () => {
  it('loads the App and streams the node picker memories as a value, never a rejection', async () => {
    request.mockImplementation(async (q: string) => { if (q === AGENT_TASKS_APP_QUERY) return { app }; throw new Error('memories down'); });
    const { load } = await import('./+page.server');
    const r = (await load({ params: { appId: 'app-1' }, locals: { token: 'tok' }, url: new URL('http://localhost/') } as never)) as { app: unknown; nodeMemories: Promise<unknown> };
    expect(r.app).toEqual(app);
    await expect(r.nodeMemories).resolves.toEqual({ kind: 'failed' });
  });
});
