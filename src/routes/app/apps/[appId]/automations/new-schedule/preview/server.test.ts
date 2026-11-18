/** portal#1701 — the preview endpoint: asks the server only with a complete choice, never passes on the cron line. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASKS_APP_QUERY } from '$lib/server/queries';
import { PREVIEW_AGENT_SCHEDULE_QUERY } from '$lib/server/automation-schedule';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team', organizationId: null };
const summary = { name: 'x', schedule: 'Runs on the schedule "0 9 * * *" (UTC).', reads: ['r'], writes: ['w'], tools: ['t'], limits: ['l'], cannotDo: ['c'] };
const gqlError = (code: string) => ({ response: { errors: [{ message: 'raw: stored run-as user', extensions: { code } }] } });
const good = { entryNodeUrn: 'hrn:node:acme.com:m:e', zone: 'Europe/Berlin', when: 'daily', time: '09:00' };

function answer(preview: unknown) {
  request.mockReset();
  request.mockImplementation(async (q: string) => {
    if (q === AGENT_TASKS_APP_QUERY) return { app };
    if (q === PREVIEW_AGENT_SCHEDULE_QUERY) { if (preview instanceof Function) return preview(); return { previewAgentSchedule: preview }; }
    throw new Error(`unrouted ${q}`);
  });
}
async function post(fields: Record<string, string>) {
  const { POST } = await import('./+server');
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.set(k, v);
  const res = (await POST({ request: new Request('http://localhost/x', { method: 'POST', body }), params: { appId: 'app-1' }, locals: { token: 'tok' } } as never)) as Response;
  return res.json();
}
const asked = () => request.mock.calls.find((c) => c[0] === PREVIEW_AGENT_SCHEDULE_QUERY)?.[1];
beforeEach(() => { request.mockReset(); });

describe('preview endpoint', () => {
  it('ADOPTABLE: the summary, without the timing line that quotes the cron', async () => {
    answer({ outcome: 'ADOPTABLE', reason: null, hash: 'h', summary });
    const r = await post(good);
    expect(r).toEqual({ state: 'ready', summary: { reads: ['r'], writes: ['w'], tools: ['t'], limits: ['l'], cannotDo: ['c'] } });
    expect(JSON.stringify(r)).not.toContain('0 9 * * *');
  });
  it('asks with the entry and timing only: no name, policy, scope; the zone is the browser’s', async () => {
    answer({ outcome: 'ADOPTABLE', reason: null, hash: 'h', summary });
    await post({ ...good, name: 'sneaky', policy: 'x', cron: '* * * * *' });
    expect(asked()).toEqual({ input: { appRef: 'app-1', entryNodeUrn: good.entryNodeUrn, cron: '0 9 * * *', timezone: 'Europe/Berlin' } });
  });
  it.each(['MEMORY_UNREADABLE', 'OTHER'])('CANNOT_BE_ADOPTED (%s) is blocked with a plain reason and no summary', async (reason) => {
    answer({ outcome: 'CANNOT_BE_ADOPTED', reason, hash: null, summary: null });
    const r = await post(good);
    expect(r.state).toBe('blocked');
    expect(r.message.length).toBeGreaterThan(20);
    expect(r.message).not.toMatch(/MEMORY_UNREADABLE|OTHER|CANNOT/);
    expect(r.summary).toBeUndefined();
  });
  it('the two reasons are told apart', async () => {
    answer({ outcome: 'CANNOT_BE_ADOPTED', reason: 'MEMORY_UNREADABLE', hash: null, summary: null });
    const a = await post(good);
    answer({ outcome: 'CANNOT_BE_ADOPTED', reason: 'OTHER', hash: null, summary: null });
    expect((await post(good)).message).not.toBe(a.message);
  });
  it('an incomplete choice asks the server nothing', async () => {
    answer({});
    for (const f of [{ ...good, entryNodeUrn: '' }, { ...good, zone: '' }, { ...good, time: '' }, { ...good, when: '' }]) expect(await post(f)).toEqual({ state: 'incomplete' });
    expect(request).not.toHaveBeenCalled();
  });
  it('a refusal is plain words with no server vocabulary', async () => {
    answer(() => { throw gqlError('FORBIDDEN'); });
    const r = await post(good);
    expect(r).toMatchObject({ state: 'refused' });
    expect(r.message).toMatch(/Only an organization admin can create a schedule/);
    expect(r.message).not.toMatch(/run-as|raw/);
  });
  it('an unexpected failure is not turned into a message', async () => {
    answer(() => { throw gqlError('INTERNAL_SERVER_ERROR'); });
    await expect(post(good)).rejects.toBeTruthy();
  });
  it('an outcome it does not know is never shown as adoptable', async () => {
    answer({ outcome: 'SOMETHING_NEW', reason: null, hash: 'h', summary });
    await expect(post(good)).rejects.toThrow(/unreadable outcome/);
  });
  it('ADOPTABLE with no summary is not adoptable either', async () => {
    answer({ outcome: 'ADOPTABLE', reason: null, hash: 'h', summary: null });
    await expect(post(good)).rejects.toThrow();
  });
});
