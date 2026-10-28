import { describe, expect, it, vi } from 'vitest';
import { readNodeAdvice, INCLUDE_PIN_UNKEPT, INCLUDE_PIN_UNKEPT_TEXT } from '$lib/node-advice';
import { captureNodeAdvice, nodeAdviceHandle, takeNodeAdvice } from './node-advice';

const warning = (path = 'save', extra = {}) => ({ path, code: INCLUDE_PIN_UNKEPT, text: INCLUDE_PIN_UNKEPT_TEXT, ...extra });
const response = (extra = {}) => ({ data: { save: { id: 'saved' } }, extensions: { warnings: [warning()] }, ...extra });
const cookieName = 'hadron_node_advice_user-a';
function event(method = 'POST', userId = 'user-a') {
  const jar = new Map<string, string>();
  const cookies = { get: vi.fn((key: string) => jar.get(key)), set: vi.fn((key: string, value: string) => { jar.set(key, value); }), delete: vi.fn((key: string) => { jar.delete(key); }), serialize: vi.fn((key: string, value: string) => `${key}=${value}; Path=/app; HttpOnly; SameSite=Lax`) };
  return { request: new Request('https://portal.test/app/nodes/save', { method }), url: new URL('https://portal.test/app/nodes/save'), locals: { user: userId ? { id: userId } : null }, cookies, jar };
}
async function run(e: ReturnType<typeof event>, work: () => void | Promise<void>, status = 200) {
  const r = await nodeAdviceHandle({ event: e, resolve: async () => { await work(); return new Response(null, { status }); } } as never);
  for (const c of r.headers.getSetCookie()) { const [name, value] = c.split(';')[0].split('='); e.jar.set(name, value); }
  return r;
}

describe('node response advice (#1363)', () => {
  it('keeps only fixed node advice on this successful root response key (including aliases)', () => {
    expect(readNodeAdvice(response())).toEqual([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(readNodeAdvice(response({ data: { alias: { id: 'saved' } }, extensions: { warnings: [warning('alias')] } }))).toEqual([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(readNodeAdvice(response({ extensions: { warnings: [warning('other')] } }))).toEqual([]);
  });
  it('keeps a successful bulk root without probing targets or depending on result shape', () => {
    expect(readNodeAdvice(response({ data: { save: 3 } }))).toEqual([INCLUDE_PIN_UNKEPT_TEXT]);
  });
  it('never turns a failed root or transport error into success advice', () => {
    for (const r of [new Error('network'), response({ data: { save: null } }), response({ errors: [{ path: ['save'], message: 'refused' }] }), response({ errors: [{ message: 'unknown failure' }] }), response({ data: null })]) expect(readNodeAdvice(r)).toEqual([]);
    expect(readNodeAdvice(response({ errors: [{ path: ['other'], message: 'other field' }] }))).toEqual([INCLUDE_PIN_UNKEPT_TEXT]);
  });
  it('tolerates malformed/unknown advice and coalesces bulk duplicates', () => {
    for (const ext of [null, {}, { warnings: 'bad' }, { warnings: [null, 1, {}, warning('save', { code: 'future.code' }), warning('save', { text: '<img src=x>' }), warning('save', { text: null })] }]) expect(readNodeAdvice(response({ extensions: ext }))).toEqual([]);
    expect(readNodeAdvice(response({ extensions: { warnings: Array.from({ length: 20 }, () => warning()) } }))).toEqual([INCLUDE_PIN_UNKEPT_TEXT]);
  });
  it('normal success stays normal; no advice means no cookie', async () => {
    const e = event(); const r = await run(e, () => captureNodeAdvice({ data: { save: {} } }));
    expect(r.status).toBe(200); expect(e.cookies.serialize).not.toHaveBeenCalled();
  });
  it.each([200, 303])('preserves committed status %s and carries advice through the next page load', async (status) => {
    const e = event(); const r = await run(e, () => captureNodeAdvice(response()), status);
    expect(r.status).toBe(status);
    expect(e.cookies.serialize).toHaveBeenCalledWith(cookieName, '1', expect.objectContaining({ path: '/app', httpOnly: true, sameSite: 'lax', secure: true, maxAge: 60 }));
    expect(takeNodeAdvice(e.cookies, 'user-b')).toEqual([]);
    expect(takeNodeAdvice(e.cookies, 'user-a')).toEqual([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(takeNodeAdvice(e.cookies, 'user-a')).toEqual([]);
  });
  it('does not publish advice when the portal operation fails, or for signed-out requests', async () => {
    for (const e of [event(), event('POST', '')]) {
      await run(e, () => captureNodeAdvice(response()), e.locals.user ? 500 : 200);
      expect(e.cookies.serialize).not.toHaveBeenCalled();
    }
  });
  it('isolates overlapping requests and never inherits a previous request warning', async () => {
    const a = event(), b = event(); let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    await Promise.all([run(a, async () => { captureNodeAdvice(response()); await held; }), run(b, async () => { release(); })]);
    expect(a.cookies.serialize).toHaveBeenCalledTimes(1); expect(b.cookies.serialize).not.toHaveBeenCalled();
  });
  it('renders native POST advice in that page without also flashing it on the next page', async () => {
    const e = event();
    await run(e, () => { captureNodeAdvice(response()); expect(takeNodeAdvice(e.cookies, 'user-a')).toEqual([INCLUDE_PIN_UNKEPT_TEXT]); });
    expect(e.cookies.serialize).not.toHaveBeenCalled();
  });
  it('an unavailable presentation carrier cannot turn a saved write into a rejected response', async () => {
    const e = event(); e.cookies.serialize.mockImplementation(() => { throw new Error('cookie budget'); });
    expect((await run(e, () => captureNodeAdvice(response()))).status).toBe(200);
  });
});
