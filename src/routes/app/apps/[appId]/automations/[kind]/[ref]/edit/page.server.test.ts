/**
 * portal#1701 — editing a schedule. The action re-reads the stored schedule, sends ONLY what changed and never the
 * timezone, leaves custom timing alone unless asked, and reads the approval state from the server afterwards.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { AGENT_SCHEDULES_QUERY, UPDATE_AGENT_SCHEDULE_MUTATION } from '$lib/server/automation-schedule';
import { AUTOMATION_APPROVAL_QUERY } from '$lib/server/automation-approval';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/node-memories', () => ({ loadNodeMemories: () => Promise.resolve({ kind: 'ok', value: [] }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const stored = (over: Record<string, unknown> = {}) => ({ id: 'sch-1', name: 'Digest', entryNodeUrn: 'hrn:node:acme.com:m:e', cron: '0 9 * * *', runAt: null, timezone: 'Europe/Berlin', enabled: true, nextRunAt: null, lastRunAt: null, userId: 'u1', createdBy: 'u1', ...over });
const gqlError = (code: string) => ({ response: { errors: [{ message: 'the stored run-as user', extensions: { code } }] } });
const locals = { token: 'tok', user: { id: 'u1' }, impersonation: null };

let state = 'ADOPTED';
function serve(schedules: unknown[]) {
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === AGENT_SCHEDULES_QUERY) return { agentSchedules: { total: schedules.length, items: schedules } };
    if (q === UPDATE_AGENT_SCHEDULE_MUTATION) return { updateAgentSchedule: { id: 'sch-1' } };
    if (q === AUTOMATION_APPROVAL_QUERY) return { automationApproval: { state, hash: 'h', depth: {}, summary: { name: 'Digest', schedule: null, reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] } } };
    throw new Error(`unrouted: ${q}`);
  });
}
beforeEach(() => { request.mockReset(); state = 'ADOPTED'; });

const updates = () => request.mock.calls.filter((c) => c[0] === UPDATE_AGENT_SCHEDULE_MUTATION).map((c) => c[1]);
async function save(fields: Record<string, string | string[]>, kind = 'schedule') {
  const { actions } = await import('./+page.server');
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) body.append(k, x);
  return (await (actions as unknown as { default: (e: never) => Promise<unknown> }).default({ request: new Request('http://localhost/x', { method: 'POST', body }), params: { appId: 'app-1', kind, ref: 'sch-1' }, locals } as never)) as { status?: number; data?: Record<string, any> } & Record<string, any>;
}
const same = { entryNodeUrn: 'hrn:node:acme.com:m:e', name: 'Digest', when: 'daily', time: '09:00' };

describe('edit action', () => {
  it('a timing edit sends the new cron alone: no entry, no name, never the timezone', async () => {
    serve([stored()]);
    const r = await save({ ...same, time: '10:30' });
    expect(updates()).toEqual([{ id: 'sch-1', input: { cron: '30 10 * * *' } }]);
    expect(r).toMatchObject({ saved: true, needsApproval: false });
  });
  it('an entry edit sends the entry alone', async () => {
    serve([stored()]);
    await save({ ...same, entryNodeUrn: 'hrn:node:acme.com:m:other' });
    expect(updates()).toEqual([{ id: 'sch-1', input: { entryNodeUrn: 'hrn:node:acme.com:m:other' } }]);
  });
  it('a name edit sends the name alone, and no cron even though the form carries timing', async () => {
    serve([stored()]);
    await save({ ...same, name: 'Morning digest' });
    expect(updates()).toEqual([{ id: 'sch-1', input: { name: 'Morning digest' } }]);
  });
  it('nothing changed sends nothing and says so', async () => {
    serve([stored()]);
    expect(await save(same)).toEqual({ nothingToChange: true });
    expect(updates()).toEqual([]);
  });
  it('custom timing is left alone when the user did not ask to change it', async () => {
    serve([stored({ cron: '*/5 * * * *' })]);
    await save({ entryNodeUrn: same.entryNodeUrn, name: 'Renamed', keepTiming: '1' });
    expect(updates()).toEqual([{ id: 'sch-1', input: { name: 'Renamed' } }]);
  });
  it('a posted zone, cron or id cannot change anything: the schedule is re-read and the id is the URL’s', async () => {
    serve([stored()]);
    await save({ ...same, time: '10:30', timezone: 'Asia/Tokyo', cron: '* * * * *', id: 'sch-9' });
    expect(updates()).toEqual([{ id: 'sch-1', input: { cron: '30 10 * * *' } }]);
  });
  it('a one-time instant is read in the schedule’s own zone, not the browser’s', async () => {
    serve([stored()]);
    await save({ ...same, when: 'once', date: '2027-01-15', time: '08:00', timezone: 'Asia/Tokyo', zone: 'Asia/Tokyo' });
    expect(updates()).toEqual([{ id: 'sch-1', input: { runAt: '2027-01-15T07:00:00.000Z' } }]);
  });
  it('says it needs approval when the SERVER says the state is not adopted', async () => {
    serve([stored()]);
    state = 'CHANGED';
    const r = await save({ ...same, entryNodeUrn: 'hrn:node:acme.com:m:other' });
    expect(r).toMatchObject({ saved: true, needsApproval: true, approvalPath: '/app/apps/app-1/automations/schedule/sch-1' });
  });
  it('a refusal is plain words that say who to ask, with no server vocabulary', async () => {
    serve([stored()]);
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AGENT_SCHEDULES_QUERY) return { agentSchedules: { total: 1, items: [stored()] } };
      throw gqlError('FORBIDDEN');
    });
    const r = await save({ ...same, time: '10:30' });
    expect(r.status).toBe(403);
    expect(r.data!.failure.message).toMatch(/created this schedule can change it/);
    expect(r.data!.failure.message).not.toMatch(/run-as|FORBIDDEN/);
  });
  it('a schedule that is gone is a plain failure and nothing is sent', async () => {
    serve([]);
    const r = await save({ ...same, time: '10:30' });
    expect(r.status).toBe(404);
    expect(updates()).toEqual([]);
  });
  it('refuses an empty name or entry before any call', async () => {
    expect((await save({ ...same, name: ' ' })).status).toBe(400);
    expect((await save({ ...same, entryNodeUrn: '' })).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it('a webhook has no edit page', async () => {
    await expect(save(same, 'webhook')).rejects.toMatchObject({ status: 404 });
  });
});

describe('edit loader', () => {
  async function load(kind = 'schedule') {
    const { load } = await import('./+page.server');
    return (await load({ params: { appId: 'app-1', kind, ref: 'sch-1' }, locals } as never)) as Record<string, any>;
  }
  it('loads the stored schedule and reads its timing', async () => {
    serve([stored()]);
    const r = await load();
    expect(r.schedule.id).toBe('sch-1');
    expect(r.timing).toEqual({ kind: 'daily', time: '09:00' });
  });
  it('a missing schedule is a 404; a webhook is a 404 that asks nothing', async () => {
    serve([]);
    await expect(load()).rejects.toMatchObject({ status: 404 });
    request.mockReset();
    await expect(load('webhook')).rejects.toMatchObject({ status: 404 });
    expect(request).not.toHaveBeenCalled();
  });
});
