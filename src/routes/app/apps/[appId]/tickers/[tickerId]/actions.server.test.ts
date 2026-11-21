/**
 * portal#1151 (Tickers S7b) — the ticker page's update and delete actions: the
 * patch (only what changed, reasons omitted unless edited), the refusals, the
 * stale control and the uncertain outcome that is never retried. The wire is
 * mocked at the client, so a test sees the exact document and variables sent.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE_TICKER_MUTATION, UPDATE_TICKER_MUTATION } from '$lib/server/ticker-writes';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

const gqlError = (code: string, message = code) => ({ response: { errors: [{ message, extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
});

describe('portal#1151 — the update and delete actions', () => {
  function event(fields: Record<string, string | string[]>, impersonation: unknown = null) {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) for (const x of Array.isArray(v) ? v : [v]) fd.append(k, x);
    return {
      request: { formData: async () => fd },
      params: { appId: 'app-1', tickerId: 'tk-1' },
      locals: { token: 'tok', user: { id: 'u1' }, impersonation },
    } as never;
  }
  type Actions = Record<string, (e: never) => Promise<unknown>>;
  const run = async (name: 'update' | 'delete', fields: Record<string, string | string[]>, impersonation: unknown = null) => {
    const { actions } = (await import('./+page.server')) as unknown as { actions: Actions };
    return actions[name](event(fields, impersonation));
  };
  const was = { nameWas: 'standup', cadenceSecondsWas: '600', reasonsWas: 'READ_TEAM_CHANNEL', reasonsShown: '1' };
  const same = { name: 'standup', cadenceSeconds: '600', reasons: ['READ_TEAM_CHANNEL'] };
  const imp = { sessionId: 's', actorUserId: 'a', orgId: 'o', expiresAt: 0 };

  it('an update sends only the changed field; reasons the reader did not touch are omitted', async () => {
    request.mockResolvedValue({ updateTicker: { id: 'tk-1' } });
    expect(await run('update', { ...was, ...same, cadenceSeconds: '300' })).toEqual({ action: 'update', ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(UPDATE_TICKER_MUTATION, { ref: 'tk-1', input: { cadenceSeconds: 300 } });
  });

  it('adding a reason sends the whole explicit set and never enabled', async () => {
    request.mockResolvedValue({ updateTicker: { id: 'tk-1' } });
    await run('update', { ...was, ...same, reasons: ['READ_TEAM_CHANNEL', 'EVERY_TICK'] });
    expect(request).toHaveBeenCalledWith(UPDATE_TICKER_MUTATION, { ref: 'tk-1', input: { reasons: ['READ_TEAM_CHANNEL', 'EVERY_TICK'] } });
    expect(JSON.stringify(request.mock.calls)).not.toContain('enabled');
  });

  it.each(['EVERY_TICK', 'LIVE_CHECK'])('the consent refusal on adding %s writes nothing and is portal copy naming neither reason alone', async (added) => {
    request.mockRejectedValueOnce(gqlError('TICKER_CADENCE_NEEDS_CONSENT', `adding ${added} needs consent`));
    const r = (await run('update', { ...was, ...same, reasons: ['READ_TEAM_CHANNEL', added] })) as { status: number; data: { refusal: { code: string; message: string } } };
    expect(r.status).toBe(409);
    expect(r.data.refusal.code).toBe('TICKER_CADENCE_NEEDS_CONSENT');
    expect(r.data.refusal.message).not.toContain(added);
    expect(r.data).not.toHaveProperty('ok');
  });

  it('removing a reason is sent plainly (the portal does no consent check of its own)', async () => {
    request.mockResolvedValue({ updateTicker: { id: 'tk-1' } });
    await run('update', { ...was, reasonsWas: 'EVERY_TICK,READ_TEAM_CHANNEL', ...same, reasons: ['READ_TEAM_CHANNEL'] });
    expect(request).toHaveBeenCalledWith(UPDATE_TICKER_MUTATION, { ref: 'tk-1', input: { reasons: ['READ_TEAM_CHANNEL'] } });
  });

  it('clearing every reason answers 400 and calls nothing', async () => {
    const r = (await run('update', { ...was, name: 'standup', cadenceSeconds: '600' })) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(400);
    expect(r.data).toMatchObject({ action: 'update', refusal: { kind: 'invalid', field: 'reasons' } });
    expect(request).not.toHaveBeenCalled();
  });

  it.each(['update', 'delete'] as const)('a FORBIDDEN on %s renders as that action’s own sentence, 403', async (name) => {
    request.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Forbidden'));
    const r = (await run(name, name === 'update' ? { ...was, ...same, name: 'b' } : {})) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(403);
    expect(r.data).toMatchObject({ action: name, refusal: { kind: 'refused', code: 'FORBIDDEN' } });
    expect(JSON.stringify(r.data)).not.toContain('"Forbidden"');
  });

  it.each(['update', 'delete'] as const)('a stale control: %s of a ticker that is gone answers 404 with the server sentence', async (name) => {
    request.mockRejectedValueOnce(gqlError('TICKER_NOT_FOUND'));
    const r = (await run(name, name === 'update' ? { ...was, ...same, name: 'b' } : {})) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(404);
    expect(r.data).toMatchObject({ action: name, refusal: { kind: 'refused', code: 'TICKER_NOT_FOUND' } });
  });

  it('delete calls deleteTicker once for this ticker and answers ok', async () => {
    request.mockResolvedValue({ deleteTicker: true });
    expect(await run('delete', {})).toEqual({ action: 'delete', ok: true });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(DELETE_TICKER_MUTATION, { ref: 'tk-1' });
  });

  it('a delete answered false is not a success', async () => {
    request.mockResolvedValue({ deleteTicker: false });
    const r = (await run('delete', {})) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(502);
    expect(r.data).toMatchObject({ action: 'delete', refusal: { kind: 'uncertain' } });
  });

  it.each(['update', 'delete'] as const)('an uncertain %s is shown as uncertain and never retried', async (name) => {
    request.mockRejectedValue(new Error('socket hang up'));
    const r = (await run(name, name === 'update' ? { ...was, ...same, name: 'b' } : {})) as { status: number; data: Record<string, unknown> };
    expect(r.status).toBe(502);
    expect(r.data).toMatchObject({ refusal: { kind: 'uncertain' } });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['update', 'delete'] as const)('an impersonation session %s writes nothing', async (name) => {
    const r = (await run(name, { ...was, ...same, name: 'b' }, imp)) as { status: number };
    expect(r.status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
});
