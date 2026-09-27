/**
 * #942 slice 4 — the on-demand effective-register endpoint.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ATTENDEE_REGISTER_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

const VIEW = [{
  namedBy: 'AGENT', lastSeenSeq: 3, canRead: true, canPost: false, disclosure: 'DRIVER_NOT_PARTICIPANT',
  attendeeUrn: 'hrn:worker:acme.com:team:ada',
  entry: { id: 're-1', ownerType: 'APP', role: 'BOTH', mentionOnly: false, installDefault: true },
  channel: { id: 'ch', name: 'team', loc: 'chats:team', hostMemoryUrn: 'hrn:mem:acme.com:shared', lastSeq: 12, lastMessageAt: null, deleted: false },
}];

async function get(qs: string) {
  const { GET } = await import('./+server');
  const res = await GET({ params: { appId: 'app-1' }, url: new URL(`http://x/effective?${qs}`), locals: { token: 'tok' } } as never);
  return { status: res.status, body: await res.json() };
}

describe('GET effective', () => {
  it('a Worker is asked by workerRef; an Agent by agentRef + THIS App', async () => {
    mockRequest.mockResolvedValue({ attendeeRegister: VIEW });
    await get('attendee=w-ada&kind=worker');
    await get('attendee=ag-1&kind=agent');
    expect(mockRequest.mock.calls.map(([d, v]) => [d === ATTENDEE_REGISTER_QUERY, v])).toEqual([
      [true, { workerRef: 'w-ada' }],
      [true, { agentRef: 'ag-1', appRef: 'app-1' }],
    ]);
  });

  it('returns only attendee facts: the caller’s canPost / disclosure never leave the server', async () => {
    mockRequest.mockResolvedValue({ attendeeRegister: VIEW });
    const { status, body } = await get('attendee=w-ada&kind=worker');
    expect(status).toBe(200);
    expect(body.rows[0]).toMatchObject({ channel: 'team', because: 'Their agent’s row', readUpTo: 'Read up to #3 of #12' });
    expect(JSON.stringify(body)).not.toMatch(/canPost|canRead|disclosure|DRIVER_NOT_PARTICIPANT/);
  });

  it('for an Agent, a namedBy AGENT row is their own row, not "their agent’s"', async () => {
    mockRequest.mockResolvedValue({ attendeeRegister: VIEW });
    const { body } = await get('attendee=ag-1&kind=agent');
    expect(body.rows[0].because).toBe('Their own row');
  });

  it.each(['', 'attendee=w-ada', 'attendee=w-ada&kind=user', 'kind=worker'])('refuses %j without asking the server', async (qs) => {
    const { status } = await get(qs);
    expect(status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a failed read is REPORTED (502), not an empty register', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockRequest.mockRejectedValue(new Error('boom'));
    const { status, body } = await get('attendee=w-ada&kind=worker');
    expect(status).toBe(502);
    expect(body).toEqual({ loadFailed: true, reason: 'fetch-failed' });
    warn.mockRestore();
  });
});
