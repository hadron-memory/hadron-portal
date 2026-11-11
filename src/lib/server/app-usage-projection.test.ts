import { describe, expect, it, vi } from 'vitest';
import { loadUsageView, accountKey } from './app-usage-projection';

const now = '2026-11-11T01:00:00Z';
const a = { account: 'shared', host: 'one', family: 'codex', newestSnapshotAt: now, workers: ['Ruth'], workersConfigured: true };
const b = { ...a, host: 'two', workers: ['Mia'] };
const projection = { account: a.account, host: a.host, family: a.family, asOf: now, newestSnapshotAt: now, workers: a.workers, workersConfigured: true, windows: [], whatIf: null };
const failure = (code?: string) => ({ response: code ? { errors: [{ extensions: { code }, message: 'SECRET WIRE TEXT' }] } : {} });
function client(over: { list?: unknown; base?: unknown; whatIf?: unknown; failList?: unknown; failWhatIf?: unknown } = {}) {
  const request = vi.fn(async (_q: string, v: Record<string, unknown>) => {
    if (!('account' in v)) {
      if (over.failList) throw over.failList;
      return { accountUsageAccounts: over.list ?? { asOf: now, complete: true, accounts: [a, b] } };
    }
    if (v.whatIf) {
      if (over.failWhatIf) throw over.failWhatIf;
      return { accountUsageProjection: over.whatIf ?? projection };
    }
    return { accountUsageProjection: over.base ?? projection };
  });
  return { request };
}
const run = (c: ReturnType<typeof client>, q = '') => loadUsageView(c as never, 'app', new URLSearchParams(q));
describe('token use server view #1908', () => {
  it('loads only the selected account (default first), fully qualified, never all fifty', async () => {
    const c = client(); const v = await run(c);
    expect(v.kind).toBe('ok');
    expect(c.request).toHaveBeenCalledTimes(2);
    expect(c.request.mock.calls[1][1]).toEqual({ appRef: 'app', account: 'shared', host: 'one', family: 'codex' });
    await run(c, new URLSearchParams({ account: accountKey(b) }).toString());
    expect(c.request.mock.calls[3][1]).toMatchObject({ host: 'two', family: 'codex' });
  });
  it('sends exactly one add input and preserves baseline and adjusted answers', async () => {
    const c = client({ whatIf: { ...projection, whatIf: { adjusted: [], target: null } } });
    const v = await run(c, 'add=2');
    expect(c.request.mock.calls[2][1]).toMatchObject({ whatIf: { addWorkers: 2 } });
    expect(v.kind === 'ok' && v.whatIf?.kind === 'ok' && v.whatIf.value.whatIf?.adjusted).toEqual([]);
  });
  it('move resolves worker and target from lists and sends all identity dimensions', async () => {
    const c = client(); await run(c, new URLSearchParams({ move: 'Ruth', to: accountKey(b) }).toString());
    expect(c.request.mock.calls[2][1]).toMatchObject({ whatIf: { moveWorker: { worker: 'Ruth', toAccount: 'shared', toHost: 'two', toFamily: 'codex' } } });
  });
  it.each(['add=0', 'add=51', 'add=1.1', 'add=NaN', 'add=2&move=Ruth', 'move=NotListed&to=bad', 'account=unlisted&add=2', 'add=2&add=3'])('never sends a what-if for invalid URL choices: %s', async q => {
    const c = client(); await run(c, q);
    expect(c.request.mock.calls.every(call => !call[1].whatIf)).toBe(true);
  });
  it.each([
    ['unlisted worker', 'NotListed', accountKey(b)],
    ['unlisted target', 'Ruth', 'unlisted'],
  ])('rejects %s independently of the other list guard', async (_name, move, to) => {
    const c = client();
    const v = await run(c, new URLSearchParams({ move, to }).toString());
    expect(v.kind === 'ok' && v.invalid).toBe(true);
    expect(c.request.mock.calls.every(call => !call[1].whatIf)).toBe(true);
  });
  it('same target account is rejected without asking the server', async () => {
    const c = client(); await run(c, new URLSearchParams({ move: 'Ruth', to: accountKey(a) }).toString());
    expect(c.request).toHaveBeenCalledTimes(2);
  });
  it.each(['APP_NOT_FOUND', 'FORBIDDEN'])('refusal %s hides the view', async code => {
    expect(await run(client({ failList: failure(code) }))).toEqual({ kind: 'hidden' });
  });
  it.each(['INTERNAL_SERVER_ERROR', 'GRAPHQL_VALIDATION_FAILED', undefined])('outage %s is failed, never empty/hidden', async code => {
    expect(await run(client({ failList: failure(code) }))).toEqual({ kind: 'failed' });
  });
  it('known empty and incomplete list remain successful server answers', async () => {
    const v = await run(client({ list: { asOf: now, complete: false, accounts: [] } }));
    expect(v.kind === 'ok' && v.accounts).toEqual([]);
    expect(v.kind === 'ok' && v.complete).toBe(false);
  });
  it('BAD_USER_INPUT retains base projection but only a code for the what-if', async () => {
    const v = await run(client({ failWhatIf: failure('BAD_USER_INPUT') }), 'add=2');
    expect(v.kind === 'ok' && v.projection?.kind).toBe('ok');
    expect(v.kind === 'ok' && v.whatIf).toEqual({ kind: 'refused' });
    expect(JSON.stringify(v)).not.toContain('SECRET');
  });
  it('a refused projection hides account metadata rather than masquerading as empty', async () => {
    const c = client(); c.request.mockImplementationOnce(async () => ({ accountUsageAccounts: { asOf: now, complete: true, accounts: [a] } }) as never).mockRejectedValueOnce(failure('APP_NOT_FOUND'));
    expect(await run(c)).toEqual({ kind: 'hidden' });
  });
});
