/**
 * portal#1168 (hadron-server#2178 / #2138) — the AI Team grid's Pause/Unpause.
 *
 * The action sends PAUSE INTENT ONLY: an explicit user-selected `pausedUntil`,
 * or `clearPause`. Never `mentions`, never anything else in the wake settings,
 * and no default duration. The server's gate decides who may; a refusal is a
 * fixed message, never a raw provider payload, and never success.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SET_WORKER_WAKE_SETTINGS_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: vi.fn() }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

import { actions } from './+page.server';

beforeEach(() => {
  mockRequest.mockReset();
});

async function run(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return (await actions.setWorkerPause({
    request: { formData: async () => fd },
    params: { appId: 'app-1' },
    locals: { token: 'tok' },
  } as never)) as { status?: number; data?: Record<string, unknown> } | Record<string, unknown>;
}
const future = () => new Date(Date.now() + 3 * 3600_000).toISOString();
const sent = () => mockRequest.mock.calls[0] as [string, { workerRef: string; input: Record<string, unknown> }];

describe('setWorkerPause (#1168)', () => {
  it('pause sends only pausedUntil, exactly as the user chose it', async () => {
    mockRequest.mockResolvedValueOnce({ setWorkerWakeSettings: { pausedUntil: 'x' } });
    const until = future();
    await run({ workerId: 'w1', mode: 'pause', until });
    const [doc, vars] = sent();
    expect(doc).toBe(SET_WORKER_WAKE_SETTINGS_MUTATION);
    expect(vars.workerRef).toBe('w1');
    expect(vars.input).toEqual({ pausedUntil: until });
  });

  it('unpause sends only clearPause', async () => {
    mockRequest.mockResolvedValueOnce({ setWorkerWakeSettings: { pausedUntil: null } });
    await run({ workerId: 'w1', mode: 'clear' });
    expect(sent()[1].input).toEqual({ clearPause: true });
  });

  it('refuses a pause with no end, or one in the past, without calling the server', async () => {
    const none = (await run({ workerId: 'w1', mode: 'pause' })) as { status: number };
    expect(none.status).toBe(400);
    const past = (await run({ workerId: 'w1', mode: 'pause', until: '2020-01-01T00:00:00.000Z' })) as { status: number };
    expect(past.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses a missing worker id or an unknown mode', async () => {
    expect(((await run({ mode: 'clear' })) as { status: number }).status).toBe(400);
    expect(((await run({ workerId: 'w1', mode: 'mentions' })) as { status: number }).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a FORBIDDEN refusal is a fixed 403 message, not success and not the raw payload', async () => {
    mockRequest.mockRejectedValueOnce({ response: { errors: [{ message: 'SECRET provider text', extensions: { code: 'FORBIDDEN' } }] }, request: { headers: { authorization: 'Bearer tok' } } });
    const r = (await run({ workerId: 'w1', mode: 'clear' })) as { status: number; data: { pauseResult: { ok: boolean; message: string } } };
    expect(r.status).toBe(403);
    expect(r.data.pauseResult.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SECRET');
    expect(JSON.stringify(r)).not.toContain('Bearer');
  });

  it('any other failure is a generic failure, never success', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const r = (await run({ workerId: 'w1', mode: 'clear' })) as { status: number; data: { pauseResult: { ok: boolean } } };
    expect(r.status).toBe(500);
    expect(r.data.pauseResult.ok).toBe(false);
  });

  it('success reports ok for that worker', async () => {
    mockRequest.mockResolvedValueOnce({ setWorkerWakeSettings: { pausedUntil: null } });
    const r = (await run({ workerId: 'w1', mode: 'clear' })) as { pauseResult: { ok: boolean; workerId: string } };
    expect(r.pauseResult).toMatchObject({ ok: true, workerId: 'w1' });
  });
});
