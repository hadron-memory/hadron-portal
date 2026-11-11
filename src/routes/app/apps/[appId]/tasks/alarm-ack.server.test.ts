import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';

const rawRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ rawRequest }) }));
const eventId = '01a194a3127e7084ba7e044c67b1e795';
async function ack(impersonation: unknown = null, id = eventId) {
  const { actions } = await import('./+page.server');
  const fd = new FormData(); fd.set('eventId', id);
  return actions.acknowledgeAlarm({ locals: { token: 'tok', impersonation }, request: { formData: async () => fd } } as never) as Promise<any>;
}
function refused(code: string, message = 'server refusal') {
  return new ClientError({ status: 200, data: null, errors: [{ message, extensions: { code } }] }, { query: 'mutation { sensitive }', variables: { private: 'marker' } });
}
beforeEach(() => rawRequest.mockReset());
describe('portal#1941 acknowledgement action', () => {
  it('calls only the existing mutation as the person and preserves the response warnings', async () => {
    rawRequest.mockResolvedValue({ data: { acknowledgeAlarm: { id: eventId, acknowledgedAt: '2026-11-11T18:00:00Z' } } });
    expect(await ack()).toMatchObject({ alarmAck: { eventId, kind: 'acknowledged' } });
    expect(rawRequest).toHaveBeenCalledWith(expect.stringContaining('acknowledgeAlarm(eventId: $eventId)'), { eventId });
  });
  it('renders a second ack as information rather than an error', async () => {
    rawRequest.mockRejectedValue(refused('ALARM_ALREADY_ACKNOWLEDGED'));
    expect(await ack()).toMatchObject({ alarmAck: { eventId, kind: 'already-acknowledged' } });
  });
  it.each(['ALARM_NOT_IN_CHAIN', 'ALARM_NOT_FOUND', 'NOT_AN_ALARM'])('surfaces the typed %s refusal', async (code) => {
    rawRequest.mockRejectedValue(refused(code));
    expect(await ack()).toMatchObject({ status: expect.any(Number), data: { alarmAck: { kind: 'refused', code, message: 'server refusal' } } });
  });
  it.each(['INTERNAL_SERVER_ERROR', 'UNKNOWN', 'FORBIDDEN'])('suppresses unsafe prose for %s', async (code) => {
    rawRequest.mockRejectedValue(refused(code, 'secret SQL marker'));
    const r = await ack();
    expect(r).toMatchObject({ status: 502, data: { alarmAck: { kind: 'uncertain', eventId } } });
    expect(JSON.stringify(r)).not.toMatch(/secret|SQL|marker|sensitive/);
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
