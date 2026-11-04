/**
 * portal#1701 — the schedule section of the approval page: the loader reads the schedule only for the schedule
 * kind, and Pause / Resume send exactly the edit the server's rules need (pause is {enabled:false} alone).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { AGENT_SCHEDULES_QUERY, UPDATE_AGENT_SCHEDULE_MUTATION } from '$lib/server/automation-schedule';
import { AUTOMATION_APPROVAL_QUERY } from '$lib/server/automation-approval';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const sched = (over: Record<string, unknown> = {}) => ({ id: 'sch-1', name: 'Digest', entryNodeUrn: 'hrn:node:acme.com:m:e', cron: '0 9 * * *', runAt: null, timezone: 'Europe/Berlin', enabled: true, nextRunAt: null, lastRunAt: null, userId: 'u1', createdBy: 'u1', ...over });
const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });
const locals = { token: 'tok', user: { id: 'u1' }, impersonation: null };

beforeEach(() => { request.mockReset(); });

async function load(kind: string, query = '') {
  const { load } = await import('./+page.server');
  return (await load({ params: { appId: 'app-1', kind, ref: 'sch-1' }, locals, url: new URL(`http://localhost/x${query}`) } as never)) as Record<string, unknown>;
}
const route = (schedules: unknown[] | null) => request.mockImplementation(async (q: string) => {
  if (q === AGENT_TASKS_APP_QUERY) return { app };
  if (q === AUTOMATION_APPROVAL_QUERY) return { automationApproval: { state: 'UNADOPTED', hash: 'h', depth: {}, summary: { name: 'Digest', schedule: '0 9 * * *', reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] } } };
  if (q === AGENT_SCHEDULES_QUERY) { if (schedules === null) throw gqlError('FORBIDDEN'); return { agentSchedules: { total: schedules.length, items: schedules } }; }
  return {}; // team grant reads
});
const updates = () => request.mock.calls.filter((c) => c[0] === UPDATE_AGENT_SCHEDULE_MUTATION).map((c) => c[1]);

describe('schedule loader', () => {
  it('finds this schedule by the id in the URL among the App’s schedules', async () => {
    route([sched({ id: 'other' }), sched()]);
    expect((await load('schedule')).schedule).toMatchObject({ id: 'sch-1', cron: '0 9 * * *' });
  });
  it('a reader the server refuses gets no schedule, so the page falls back and does not break', async () => {
    route(null);
    expect((await load('schedule')).schedule).toBeNull();
  });
  it('any other failed read does not fail the page either: the approval is its job', async () => {
    request.mockImplementation(async (q: string) => {
      if (q === AGENT_TASKS_APP_QUERY) return { app };
      if (q === AUTOMATION_APPROVAL_QUERY) return { automationApproval: { state: 'UNADOPTED', hash: 'h', depth: {}, summary: { name: 'Digest', schedule: null, reads: [], writes: [], tools: [], limits: [], cannotDo: [], flows: [] } } };
      if (q === AGENT_SCHEDULES_QUERY) throw gqlError('INTERNAL_SERVER_ERROR');
      return {};
    });
    const r = await load('schedule');
    expect(r.schedule).toBeNull();
    expect(r.approval).toMatchObject({ state: 'UNADOPTED' });
  });
  it('a webhook never reads schedules', async () => {
    route([sched()]);
    expect((await load('webhook')).schedule).toBeNull();
    expect(request.mock.calls.some((c) => c[0] === AGENT_SCHEDULES_QUERY)).toBe(false);
  });
  it('?created=1 is read for a schedule only', async () => {
    route([sched()]);
    expect((await load('schedule', '?created=1')).created).toBe(true);
    expect((await load('schedule')).created).toBe(false);
    expect((await load('webhook', '?created=1')).created).toBe(false);
  });
});

async function act(name: 'pause' | 'resume', kind = 'schedule') {
  const { actions } = await import('./+page.server');
  return (await (actions as Record<string, (e: never) => Promise<unknown>>)[name]({ request: new Request('http://localhost/x', { method: 'POST', body: new FormData() }), params: { appId: 'app-1', kind, ref: 'sch-1' }, locals } as never)) as { status?: number; data?: Record<string, unknown> } | Record<string, unknown>;
}

describe('pause and resume', () => {
  it('pause sends exactly {enabled:false} for the id in the URL', async () => {
    request.mockResolvedValue({ updateAgentSchedule: { id: 'sch-1' } });
    expect(await act('pause')).toEqual({ scheduleEnabled: false });
    expect(updates()).toEqual([{ id: 'sch-1', input: { enabled: false } }]);
  });
  it('resume sends exactly {enabled:true}', async () => {
    request.mockResolvedValue({ updateAgentSchedule: { id: 'sch-1' } });
    expect(await act('resume')).toEqual({ scheduleEnabled: true });
    expect(updates()).toEqual([{ id: 'sch-1', input: { enabled: true } }]);
  });
  it.each([['pause', /Only an organization admin can pause/], ['resume', /created this schedule can start it again/]] as const)('%s refused says who to ask, in plain words', async (name, words) => {
    request.mockRejectedValue(gqlError('FORBIDDEN'));
    const r = (await act(name)) as { status: number; data: { scheduleMessage: string } };
    expect(r.status).toBe(403);
    expect(r.data.scheduleMessage).toMatch(words);
    expect(r.data.scheduleMessage).not.toMatch(/FORBIDDEN|run-as/);
  });
  it('is a 404 for a webhook and calls nothing', async () => {
    await expect(act('pause', 'webhook')).rejects.toMatchObject({ status: 404 });
    expect(request).not.toHaveBeenCalled();
  });
});
