import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';

const rawRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ rawRequest }) }));
const eventId = '01a194a3127e7084ba7e044c67b1e795';
async function ack(impersonation: unknown = null, id = eventId, token: string | null = 'tok') {
  const { actions } = await import('./+page.server');
  const fd = new FormData(); fd.set('eventId', id);
  return actions.acknowledgeAlarm({ locals: { token, impersonation }, request: { formData: async () => fd } } as never) as Promise<any>;
}
function refused(code: string, message = 'server refusal') {
  return new ClientError({ status: 200, headers: new Headers(), body: '', data: null, errors: [new GraphQLError(message, { extensions: { code } })] }, { query: 'mutation { sensitive }', variables: { private: 'marker' } });
}
beforeEach(() => { rawRequest.mockReset(); });
afterEach(() => { vi.useRealTimers(); });
describe('portal#1941 acknowledgement action', () => {
  it('calls only the existing mutation as the person and preserves the response warnings', async () => {
    rawRequest.mockResolvedValue({ data: { acknowledgeAlarm: { id: eventId, acknowledgedAt: '2026-11-11T18:00:00Z' } } });
    expect(await ack()).toMatchObject({ alarmAck: { eventId, kind: 'acknowledged' } });
    expect(rawRequest).toHaveBeenCalledWith(expect.stringContaining('acknowledgeAlarm(eventId: $eventId)'), { eventId });
  });
  it('renders a second ack as information rather than an error', async () => {
    rawRequest.mockImplementation(async () => { throw refused('ALARM_ALREADY_ACKNOWLEDGED'); });
    const r = await ack(); expect(r).toMatchObject({ alarmAck: { eventId, kind: 'already-acknowledged' } });
  });
  it.each(['ALARM_NOT_IN_CHAIN', 'ALARM_NOT_FOUND', 'NOT_AN_ALARM'])('surfaces the typed %s refusal', async (code) => {
    rawRequest.mockImplementation(async () => { throw refused(code); });
    expect(await ack()).toMatchObject({ status: expect.any(Number), data: { alarmAck: { kind: 'refused', code, message: 'server refusal' } } });
  });
  it.each(['INTERNAL_SERVER_ERROR', 'UNKNOWN', 'FORBIDDEN'])('suppresses unsafe prose for %s', async (code) => {
    rawRequest.mockImplementation(async () => { throw refused(code, 'secret SQL marker'); });
    const r = await ack();
    expect(r).toMatchObject({ status: 502, data: { alarmAck: { kind: 'uncertain', eventId } } });
    expect(JSON.stringify(r)).not.toMatch(/secret|SQL|marker|sensitive/);
  });
  it('keeps committed outside-chain warnings even if a post-commit read fails', async () => {
    const warning = { path: 'acknowledgeAlarm', code: 'alarm.ack.outside-chain', text: 'Acknowledged outside the owner chain.' };
    const e = refused('INTERNAL_SERVER_ERROR', 'private readback failure');
    e.response.extensions = { warnings: [warning] };
    rawRequest.mockImplementation(async () => { throw e; });
    expect(await ack()).toMatchObject({ alarmAck: { kind: 'acknowledged', warnings: [{ code: warning.code, text: warning.text }] } });
  });
  it('a transport failure and a hung request are uncertain, never automatically replayed', async () => {
    rawRequest.mockImplementation(async () => { throw new Error('private transport'); });
    expect(await ack()).toMatchObject({ status: 502, data: { alarmAck: { kind: 'uncertain' } } });
    rawRequest.mockClear();
    vi.useFakeTimers();
    rawRequest.mockImplementation(() => new Promise(() => {}));
    const pending = ack();
    await vi.advanceTimersByTimeAsync(15001);
    expect(await pending).toMatchObject({ status: 502, data: { alarmAck: { kind: 'uncertain' } } });
    expect(rawRequest).toHaveBeenCalledTimes(1);
  });
  it('redirects an expired or missing session before making any mutation call', async () => {
    await expect(ack(null, eventId, null)).rejects.toMatchObject({ status: 303, location: '/signin' });
    expect(rawRequest).not.toHaveBeenCalled();
  });
  it('does not write while impersonating or for an empty id', async () => {
    expect(await ack({ actorUserId: 'admin' })).toMatchObject({ status: 403 });
    expect(await ack(null, '')).toMatchObject({ status: 400 });
    expect(rawRequest).not.toHaveBeenCalled();
  });
  it('does not claim success for a missing mutation result', async () => {
    rawRequest.mockResolvedValue({ data: { acknowledgeAlarm: null } });
    expect(await ack()).toMatchObject({ status: 502, data: { alarmAck: { kind: 'uncertain' } } });
  });
});
