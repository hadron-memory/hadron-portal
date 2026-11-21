import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppSecret, loadAppSecrets, loadChangeRequest, SECRETS_MAX_PAGES, SECRETS_PAGE } from './secrets';

const request = vi.fn();
const client = { request } as never;
const err = (code: string, message = 'private wire prose') => ({ response: { errors: [{ message, extensions: { code } }] }, request: { query: '', variables: {} } });
const item = (i: number) => ({ id: `s${i}`, name: `k${i}` });
beforeEach(() => { request.mockReset(); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); });
const logged = () => (console.error as unknown as { mock: { calls: unknown[][] } }).mock.calls;

describe('portal#2436 item 8: the secrets list reads every page', () => {
  it('walks pages with an offset until the total is reached', async () => {
    const total = SECRETS_PAGE + 5;
    request.mockImplementation(async (_q: string, v: { offset: number }) => ({
      secrets: { total, items: Array.from({ length: Math.min(SECRETS_PAGE, total - v.offset) }, (_, i) => item(v.offset + i)) },
    }));
    const r = await loadAppSecrets(client, 'app-1');
    expect(r).toMatchObject({ kind: 'ok', total });
    expect(r.kind === 'ok' && r.secrets).toHaveLength(total);
    expect(request.mock.calls.map((c) => c[1].offset)).toEqual([0, SECRETS_PAGE]);
  });
  it('stops at the page cap and reports the real total, so the page can say it shows part', async () => {
    request.mockImplementation(async (_q: string, v: { offset: number }) => ({ secrets: { total: 99999, items: Array.from({ length: SECRETS_PAGE }, (_, i) => item(v.offset + i)) } }));
    const r = await loadAppSecrets(client, 'app-1');
    expect(request).toHaveBeenCalledTimes(SECRETS_MAX_PAGES);
    expect(r).toMatchObject({ kind: 'ok', total: 99999 });
  });
  it('an empty page ends the walk even if the total is larger (no endless loop)', async () => {
    request.mockResolvedValue({ secrets: { total: 7, items: [] } });
    await loadAppSecrets(client, 'app-1');
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe('portal#2436 item 8: a failed read leaves a bounded trace, never the wire text', () => {
  it.each([
    ['list', () => loadAppSecrets(client, 'a'), 'app-secrets'],
    ['one secret', () => loadAppSecret(client, 'a', 's'), 'app-secret'],
    ['change request', () => loadChangeRequest(client, 'r'), 'change-request'],
  ])('%s', async (_n, run, op) => {
    request.mockRejectedValue(err('SOMETHING_NEW'));
    const r = await run();
    expect(r === 'failed' || (typeof r === 'object' && r !== null && 'kind' in r && r.kind === 'failed')).toBe(true);
    expect(logged()).toEqual([['[secrets] read failed:', { op, code: 'SOMETHING_NEW' }]]);
    expect(JSON.stringify(logged())).not.toContain('private wire prose');
  });
  it('an out-of-shape code is logged as a fixed marker', async () => {
    request.mockRejectedValue(err('some prose with content'));
    await loadAppSecrets(client, 'a');
    expect(logged()[0][1]).toEqual({ op: 'app-secrets', code: 'unrecognized' });
  });
  it('a NOT_FOUND or FORBIDDEN refusal of the single read is "missing", not a fault', async () => {
    for (const code of ['NOT_FOUND', 'FORBIDDEN']) {
      request.mockRejectedValue(err(code));
      expect(await loadAppSecret(client, 'a', 's')).toEqual({ kind: 'missing' });
    }
    expect(logged()).toEqual([]);
  });
});
