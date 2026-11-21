/**
 * portal#2194 (hadron-server#4242): set the App's sweep mode. Sends exactly
 * appRef and mode, refuses a value that is not a mode before any request, and
 * shows the server's refusal as text.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_APP_SWEEP_MODE_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ setAppSweepMode: { sweepMode: 'OBSERVE' } });
});

async function run(mode?: string) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  if (mode !== undefined) fd.set('mode', mode);
  return actions.setSweepMode({ request: { formData: async () => fd }, params: { appId: 'app-1' }, locals: { token: 'tok' } } as never);
}
const gqlError = (code: string, message: string) => ({ response: { errors: [{ message, extensions: { code } }] } });
const sent = () => mockRequest.mock.calls.filter(([q]) => q === SET_APP_SWEEP_MODE_MUTATION);

describe('App sweep-mode action (portal#2194)', () => {
  it.each(['OFF', 'OBSERVE', 'APPLY'])('round-trips %s: sends exactly appRef and mode', async (mode) => {
    const result = await run(mode);
    expect(sent()).toHaveLength(1);
    expect(sent()[0][1]).toEqual({ appRef: 'app-1', mode });
    expect(result).toEqual({ sweepModeSaved: mode });
  });

  it('refuses a value that is not a mode before any request', async () => {
    for (const bad of [undefined, '', 'apply', 'ON']) {
      expect(((await run(bad)) as { status: number }).status).toBe(400);
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('shows a FORBIDDEN refusal as text, with its status', async () => {
    mockRequest.mockRejectedValue(gqlError('FORBIDDEN', 'Forbidden'));
    const result = (await run('APPLY')) as { status: number; data: { sweepModeError: string } };
    expect(result.status).toBe(403);
    expect(result.data.sweepModeError).toBeTruthy();
  });

  it('a transport failure may have committed: marked uncertain, never "Not saved"', async () => {
    mockRequest.mockRejectedValueOnce(new TypeError('fetch failed'));
    const result = (await run('APPLY')) as { status: number; data: { sweepModeError: string; uncertain?: boolean } };
    expect(result.status).toBe(502);
    expect(result.data.uncertain).toBe(true);
    expect(result.data.sweepModeError).toMatch(/couldn.t confirm/i);
    expect(result.data.sweepModeError).not.toMatch(/not saved/i);
  });


  it.each(['INTERNAL_SERVER_ERROR', 'SOMETHING_ELSE', 'FOO_NOT_FOUND'])('GraphQL code %s can come after a commit: outcome unknown, locked, never "Not saved", no server text', async (code) => {
    mockRequest.mockRejectedValueOnce(gqlError(code, 'secret internals'));
    const result = (await run('APPLY')) as { status: number; data: { sweepModeError: string; uncertain?: boolean } };
    expect(result.status).toBe(502);
    expect(result.data.uncertain).toBe(true);
    expect(result.data.sweepModeError).toMatch(/couldn.t confirm/i);
    expect(result.data.sweepModeError).not.toMatch(/not saved|secret internals/i);
  });

  it('a recognised refusal did not commit: released with its status, not uncertain', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('APP_NOT_FOUND', 'Refused.'));
    const result = (await run('APPLY')) as { status: number; data: { sweepModeError: string; uncertain?: boolean } };
    expect(result.status).toBe(404);
    expect(result.data.uncertain).toBeUndefined();
  });
});
