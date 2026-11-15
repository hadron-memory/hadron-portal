/**
 * portal#2194 (hadron-server#4242): mark or clear a worker's leave-alone marker.
 * A person acts as themselves, so no instruction is sent; a clear sends no
 * reason; the server's documented refusals are shown as they come back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_WORKER_LEAVE_ALONE_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ setWorkerLeaveAlone: { workerId: 'w1', leaveAlone: true, reason: null, by: null, at: null } });
});

async function run(fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return actions.setLeaveAlone({ request: { formData: async () => fd }, params: { id: 'w1' }, locals: { token: 'tok' } } as never);
}
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });
const sent = () => mockRequest.mock.calls.filter(([q]) => q === SET_WORKER_LEAVE_ALONE_MUTATION);

describe('worker leave-alone action (portal#2194)', () => {
  it('marks with a trimmed reason and no instruction', async () => {
    const result = await run({ leaveAlone: 'true', reason: '  migrating  ' });
    expect(sent()[0][1]).toEqual({ input: { worker: 'w1', leaveAlone: true, reason: 'migrating' } });
    expect(result).toEqual({ leaveAloneSaved: true });
  });

  it('marks without a reason when none is given', async () => {
    await run({ leaveAlone: 'true', reason: '' });
    expect(sent()[0][1]).toEqual({ input: { worker: 'w1', leaveAlone: true } });
  });

  it('clears without ever sending a reason', async () => {
    const result = await run({ leaveAlone: 'false', reason: 'stale text' });
    expect(sent()[0][1]).toEqual({ input: { worker: 'w1', leaveAlone: false } });
    expect(result).toEqual({ leaveAloneSaved: false });
  });

  it('refuses a bad choice and an over-long reason before any request', async () => {
    expect(((await run({ leaveAlone: 'maybe' })) as { status: number }).status).toBe(400);
    expect(((await run({ leaveAlone: 'true', reason: 'x'.repeat(501) })) as { status: number }).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('shows WORKER_LEAVE_ALONE_NOT_PERMITTED as the server worded it', async () => {
    mockRequest.mockRejectedValue(gqlError('WORKER_LEAVE_ALONE_NOT_PERMITTED', 'Only a manager of the App may mark a worker.'));
    const result = (await run({ leaveAlone: 'true' })) as { status: number; data: { leaveAloneError: string } };
    expect(result.status).toBe(403);
    expect(result.data.leaveAloneError).toBe('Only a manager of the App may mark a worker.');
  });

  it('a transport failure may have committed: marked uncertain, never "Not saved"', async () => {
    mockRequest.mockRejectedValueOnce(new TypeError('fetch failed'));
    const result = (await run({ leaveAlone: 'true' })) as { status: number; data: { leaveAloneError: string; uncertain?: boolean } };
    expect(result.status).toBe(502);
    expect(result.data.uncertain).toBe(true);
    expect(result.data.leaveAloneError).toMatch(/couldn.t confirm/i);
    expect(result.data.leaveAloneError).not.toMatch(/not saved/i);
  });


  it.each(['INTERNAL_SERVER_ERROR', 'SOMETHING_ELSE'])('GraphQL code %s can come after a commit: outcome unknown, locked, never "Not saved", no server text', async (code) => {
    mockRequest.mockRejectedValueOnce(gqlError(code, 'secret internals'));
    const result = (await run({ leaveAlone: 'true' })) as { status: number; data: { leaveAloneError: string; uncertain?: boolean } };
    expect(result.status).toBe(502);
    expect(result.data.uncertain).toBe(true);
    expect(result.data.leaveAloneError).toMatch(/couldn.t confirm/i);
    expect(result.data.leaveAloneError).not.toMatch(/not saved|secret internals/i);
  });

  it('a recognised refusal did not commit: released with its status, not uncertain', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('WORKER_RETIRED', 'Refused.'));
    const result = (await run({ leaveAlone: 'true' })) as { status: number; data: { leaveAloneError: string; uncertain?: boolean } };
    expect(result.status).toBe(404);
    expect(result.data.uncertain).toBeUndefined();
  });
});
