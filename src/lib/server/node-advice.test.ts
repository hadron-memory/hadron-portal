import { describe, expect, it, vi } from 'vitest';
import { readNodeAdvice, INCLUDE_PIN_UNKEPT, INCLUDE_PIN_UNKEPT_TEXT } from '$lib/node-advice';
import { captureNodeAdvice, nodeAdviceHandle, takeNodeAdvice } from './node-advice';

const warning = (path = 'save', extra = {}) => ({ path, code: INCLUDE_PIN_UNKEPT, text: INCLUDE_PIN_UNKEPT_TEXT, ...extra });
const response = (extra = {}) => ({ data: { save: { id: 'saved' } }, extensions: { warnings: [warning()] }, ...extra });
const cookieName = 'hadron_node_advice_user-a';
function event(method = 'POST', userId = 'user-a', url = 'https://portal.test/app/nodes/save', headers: HeadersInit = {}) {
  // Path-aware, like a browser: a delete only removes the cookie set on the same path.
  const jar = new Map<string, { value: string; path: string }>();
  const cookies = {
    get: vi.fn((key: string) => jar.get(key)?.value),
    set: vi.fn((key: string, value: string, o: { path: string }) => { jar.set(key, { value, path: o.path }); }),
    delete: vi.fn((key: string, o: { path: string }) => { if (jar.get(key)?.path === o.path) jar.delete(key); }),
    serialize: vi.fn((key: string, value: string, o: { path: string }) => `${key}=${value}; Path=${o.path}; HttpOnly; SameSite=Lax`),
  };
  return { request: new Request(url, { method, headers }), url: new URL(url), locals: { user: userId ? { id: userId } : null }, cookies, jar };
}
async function run(e: ReturnType<typeof event>, work: () => void | Promise<void>, status = 200) {
  const r = await nodeAdviceHandle({ event: e, resolve: async () => { await work(); return new Response(null, { status }); } } as never);
  for (const c of r.headers.getSetCookie()) {
    const [pair, ...attrs] = c.split('; '); const [name, value] = pair.split('=');
    e.jar.set(name, { value, path: attrs.find((a) => a.startsWith('Path='))!.slice(5) });
  }
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

describe('node advice guard pins (#1371)', () => {
  const throwing = () => { throw new Error('getter'); };
  it('a throwing response getter is swallowed: presentation never rejects a saved write', async () => {
    for (const r of [{ get data() { return throwing(); } }, { data: { get save() { return throwing(); } } }, { data: { save: {} }, get extensions() { return throwing(); } }]) {
      const e = event();
      let threw: unknown = null;
      const res = await run(e, () => { try { captureNodeAdvice(r); } catch (err) { threw = err; } });
      expect(threw).toBeNull(); expect(res.status).toBe(200);
      expect(e.cookies.serialize).not.toHaveBeenCalled();
    }
  });
  it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('only a POST carries advice forward, never %s', async (method) => {
    const e = event(method); await run(e, () => captureNodeAdvice(response()));
    expect(e.cookies.serialize).not.toHaveBeenCalled();
  });
  it.each([[400, false], [399, true]])('an unsuccessful POST (status %s) carries no advice; success below 400 does', async (status, carried) => {
    const e = event(); await run(e, () => captureNodeAdvice(response()), status);
    expect(e.cookies.serialize).toHaveBeenCalledTimes(carried ? 1 : 0);
  });
  it('an in-request take for another user (impersonation drift) neither shows nor consumes the writer\'s advice', async () => {
    const e = event();
    await run(e, () => { captureNodeAdvice(response()); expect(takeNodeAdvice(e.cookies, 'user-b')).toEqual([]); });
    expect(e.cookies.serialize).toHaveBeenCalledTimes(1);
    expect(takeNodeAdvice(e.cookies, 'user-a')).toEqual([INCLUDE_PIN_UNKEPT_TEXT]);
  });
  it('the flash is deleted on the path it was set on, so it is one-use in a real cookie jar', async () => {
    const e = event(); await run(e, () => captureNodeAdvice(response()));
    const setPath = e.cookies.serialize.mock.calls[0][2].path;
    expect(takeNodeAdvice(e.cookies, 'user-a')).toEqual([INCLUDE_PIN_UNKEPT_TEXT]);
    expect(e.cookies.delete).toHaveBeenCalledWith(cookieName, { path: setPath });
    expect(e.jar.has(cookieName)).toBe(false);
    expect(takeNodeAdvice(e.cookies, 'user-a')).toEqual([]);
  });
  it('the per-user cookie name is a legal cookie token for the user ids the server issues', async () => {
    // locals.user.id is the session JWT's `sub`: a server user id (32 hex, or a hyphenated UUID).
    for (const id of ['01a11a5043bc78449cd5ff5fd08527e5', '019ff5f3-1e91-7d1b-9308-a80f97c9faeb']) {
      const e = event('POST', id); await run(e, () => captureNodeAdvice(response()));
      expect(e.cookies.serialize.mock.calls[0][0]).toMatch(/^hadron_node_advice_[A-Za-z0-9_-]+$/);
    }
  });
  it.each([
    ['https://portal.test/app/save', {}, true],
    ['http://localhost:5173/app/save', {}, false],
    ['http://portal.internal/app/save', { 'x-forwarded-proto': 'https' }, false],
  ])('Secure follows the request URL protocol (%s), never a forwarded header', async (url, headers, secure) => {
    const e = event('POST', 'user-a', url, headers); await run(e, () => captureNodeAdvice(response()));
    expect(e.cookies.serialize.mock.calls[0][2]).toMatchObject({ secure });
  });
  it('accepts only the exact fixed server text: a reworded advisory fails closed, silently', () => {
    // Deliberate coupling to hadron-server's fixed include.pin.unkept wording (#2681). A server
    // rewording must drop the banner, never render substituted or unvetted text.
    for (const text of [`${INCLUDE_PIN_UNKEPT_TEXT} `, INCLUDE_PIN_UNKEPT_TEXT.toLowerCase(), INCLUDE_PIN_UNKEPT_TEXT.replace('pruned', 'deleted')]) {
      expect(readNodeAdvice(response({ extensions: { warnings: [warning('save', { text })] } }))).toEqual([]);
    }
  });
});

