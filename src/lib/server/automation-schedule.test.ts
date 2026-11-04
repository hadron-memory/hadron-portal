import { ClientError } from 'graphql-request';
import { describe, expect, it, vi } from 'vitest';
import { createSchedule, loadSchedules, setScheduleEnabled, updateSchedule } from './automation-schedule';

const refusal = (code: string, message = 'raw server words') =>
  new ClientError({ status: 200, errors: [{ message, extensions: { code } }] } as never, { query: 'mutation SECRET { x }', variables: { id: 'sched-secret' } });

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `S${id}`, entryNodeUrn: 'hrn:node:a:b:c', cron: '0 9 * * *', runAt: null, timezone: 'UTC', enabled: true,
  nextRunAt: '2026-11-05T09:00:00.000Z', lastRunAt: null, userId: 'u1', createdBy: 'u1', ...over,
});

const clientOf = (request: (q: string, v: Record<string, unknown>) => Promise<unknown>) => ({ request }) as never;

describe('loadSchedules', () => {
  it('reads every page of the App\'s schedules by their own total', async () => {
    const request = vi.fn(async (_q: string, v: Record<string, unknown>) => ({
      agentSchedules: { total: 3, items: v.offset === 0 ? [row('1'), row('2')] : [row('3')] },
    }));
    const r = await loadSchedules(clientOf(request), 'app-1');
    expect(r).toEqual({ visible: true, schedules: [expect.objectContaining({ id: '1' }), expect.objectContaining({ id: '2' }), expect.objectContaining({ id: '3' })] });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map((c) => c[1])).toEqual([
      { appRef: 'app-1', limit: 200, offset: 0 },
      { appRef: 'app-1', limit: 200, offset: 2 },
    ]);
  });

  it('stops when a page comes back empty even if the total says more (no endless loop)', async () => {
    const request = vi.fn(async (_q: string, v: Record<string, unknown>) => ({ agentSchedules: { total: 9, items: v.offset === 0 ? [row('1')] : [] } }));
    expect((await loadSchedules(clientOf(request), 'app-1')).schedules).toHaveLength(1);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('a reader the server refuses sees no timing, not an error and not an empty-looking list', async () => {
    const request = vi.fn(async () => { throw refusal('FORBIDDEN'); });
    expect(await loadSchedules(clientOf(request), 'app-1')).toEqual({ visible: false, schedules: [] });
  });

  it('rethrows anything it does not know', async () => {
    await expect(loadSchedules(clientOf(async () => { throw refusal('INTERNAL_SERVER_ERROR'); }), 'app-1')).rejects.toBeInstanceOf(ClientError);
  });
});

describe('writes', () => {
  it('create sends the input as given and returns the new schedule id', async () => {
    const request = vi.fn(async (_q: string, _v: Record<string, unknown>) => ({ createAgentSchedule: { id: 'new-1' } }));
    const input = { appRef: 'app-1', name: 'n', entryNodeUrn: 'u', cron: '0 9 * * *', timezone: 'Europe/Berlin' };
    expect(await createSchedule(clientOf(request), input)).toEqual({ ok: true, id: 'new-1' });
    expect(request.mock.calls[0][1]).toEqual({ input });
  });

  it('update sends the id and only the given fields', async () => {
    const request = vi.fn(async (_q: string, _v: Record<string, unknown>) => ({ updateAgentSchedule: { id: 's1' } }));
    expect(await updateSchedule(clientOf(request), 's1', { cron: '0 10 * * *' })).toEqual({ ok: true, id: 's1' });
    expect(request.mock.calls[0][1]).toEqual({ id: 's1', input: { cron: '0 10 * * *' } });
  });

  it('pause sends exactly {enabled:false}; resume sends exactly {enabled:true}', async () => {
    const request = vi.fn(async (_q: string, _v: Record<string, unknown>) => ({ updateAgentSchedule: { id: 's1' } }));
    await setScheduleEnabled(clientOf(request), 's1', false);
    await setScheduleEnabled(clientOf(request), 's1', true);
    expect(request.mock.calls.map((c) => c[1])).toEqual([{ id: 's1', input: { enabled: false } }, { id: 's1', input: { enabled: true } }]);
  });

  it.each([
    ['FORBIDDEN', 'forbidden'],
    ['NOT_FOUND', 'not-found'],
    ['BAD_USER_INPUT', 'invalid'],
  ] as const)('maps %s to %s and carries none of the server\'s words', async (code, reason) => {
    const failing = clientOf(async () => { throw refusal(code, 'Only the stored run-as user may change this trigger.'); });
    for (const result of [
      await createSchedule(failing, { appRef: 'a', name: 'n', entryNodeUrn: 'u', cron: '0 9 * * *', timezone: 'UTC' }),
      await updateSchedule(failing, 's1', { name: 'x' }),
      await setScheduleEnabled(failing, 's1', true),
    ]) {
      expect(result).toEqual({ ok: false, reason });
    }
  });

  it('rethrows an unknown failure instead of calling it a refusal', async () => {
    await expect(setScheduleEnabled(clientOf(async () => { throw refusal('INTERNAL_SERVER_ERROR'); }), 's1', false)).rejects.toBeInstanceOf(ClientError);
  });
});
