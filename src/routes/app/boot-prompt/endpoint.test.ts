import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { POST, GET } from './+server';
beforeEach(() => { request.mockReset(); });
const owner = { level: 'worker', worker: 'w', app: 'a', agent: 'g' };
const post = (body: unknown, locals: unknown = { token: 'viewer', user: { id: 'person' } }) => POST({ request: new Request('https://portal.invalid/app/boot-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), locals } as never);
describe('compile endpoint', () => {
  it('a forged impersonation POST is refused before a provider request', async () => {
    expect((await post({ owner, intent: 'compile' }, { token: 'viewer', user: { id: 'person' }, impersonation: true })).status).toBe(403);
    expect(request).not.toHaveBeenCalled();
  });
  it('no person or malformed intent/revision is refused without a request', async () => {
    expect((await post({ owner, intent: 'compile' }, { token: 'worker' })).status).toBe(403);
    expect((await post({ owner, intent: 'other' })).status).toBe(400);
    expect((await post({ owner, intent: 'approve', nodeId: 'x', revision: 0 })).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it('a non-manager forged compile is refused by the provider with fixed copy', async () => {
    request.mockResolvedValueOnce({ worker: { id: 'w', app: { id: 'a' }, agent: { id: 'g' }, bootPromptRef: null } }).mockRejectedValueOnce({ response: { errors: [{ message: 'hidden worker', extensions: { code: 'BOOT_PROMPT_COMPILE_NOT_PERMITTED' } }] } }).mockResolvedValueOnce({ worker: { bootPromptServe: null } });
    const response = await post({ owner, intent: 'compile' });
    expect(response.status).toBe(403);
    expect(JSON.stringify(await response.json())).not.toContain('hidden worker');
  });
  it('bad provenance offsets are refused before a read, privately and uncacheably', async () => {
    const setHeaders = vi.fn();
    const response = await GET({ url: new URL('https://portal.invalid/app/boot-prompt?node=c&revision=3&offset=-1'), locals: { token: 'viewer' }, setHeaders } as never);
    expect(response.status).toBe(400); expect(request).not.toHaveBeenCalled();
    expect(setHeaders).toHaveBeenCalledWith({ 'Cache-Control': 'private, no-store' });
  });
  // #2210: GraphQL Int is signed 32-bit, so the server cannot accept a larger revNo.
  describe('provenance revision upper bound (#2210)', () => {
    const read = (revision: string) => GET({ url: new URL(`https://portal.invalid/app/boot-prompt?node=c&revision=${revision}`), locals: { token: 'viewer' }, setHeaders: vi.fn() } as never);
    it('the largest GraphQL Int is forwarded as the revision', async () => {
      request.mockResolvedValueOnce({ compiledPromptProvenance: { items: [], total: 0, hasMore: false, pruned: false } });
      expect((await read('2147483647')).status).toBe(200);
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0][1]).toMatchObject({ revNo: 2147483647 });
    });
    it.each(['2147483648', '1e300'])('revision=%s is refused 400 before any upstream call', async (revision) => {
      const response = await read(revision);
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ failed: true });
      expect(request).not.toHaveBeenCalled();
    });
  });
  it('marks viewer-specific reads private and uncacheable', async () => {
    request.mockResolvedValueOnce({ app: { id: 'a', appAgents: [{ agent: { id: 'g' }, bootPromptRef: null }] } }).mockResolvedValueOnce({ installMemory: null });
    const setHeaders = vi.fn();
    const response = await GET({ url: new URL('https://portal.invalid/app/boot-prompt?level=app&app=a&agent=g'), locals: { token: 'viewer' }, setHeaders } as never);
    expect(response.status).toBe(200);
    const cacheHeaders = setHeaders.mock.calls.map(([headers]) => headers).filter(headers => 'Cache-Control' in headers);
    expect(cacheHeaders.at(-1)).toEqual({ 'Cache-Control': 'private, no-store' });
  });
  it('marks successful provenance reads private and uncacheable', async () => {
    request.mockResolvedValueOnce({ compiledPromptProvenance: { items: [], total: 0, hasMore: false, pruned: false } });
    const setHeaders = vi.fn();
    const response = await GET({ url: new URL('https://portal.invalid/app/boot-prompt?node=c&revision=3'), locals: { token: 'viewer' }, setHeaders } as never);
    expect(response.status).toBe(200);
    expect(setHeaders).toHaveBeenCalledWith({ 'Cache-Control': 'private, no-store' });
  });
  it('marks failed provenance reads private and uncacheable', async () => {
    request.mockRejectedValueOnce(new Error('private upstream detail'));
    const setHeaders = vi.fn();
    const response = await GET({ url: new URL('https://portal.invalid/app/boot-prompt?node=c&revision=3'), locals: { token: 'viewer' }, setHeaders } as never);
    expect(response.status).toBe(502);
    expect(setHeaders).toHaveBeenCalledWith({ 'Cache-Control': 'private, no-store' });
  });
});


describe('POST JSON media-type boundary', () => {
  const person = { token: 'viewer', user: { id: 'person' } };
  function event(contentType: string | null, locals: unknown = person) {
    const headers = new Headers();
    if (contentType !== null) headers.set('Content-Type', contentType);
    const req = new Request('https://portal.invalid/app/boot-prompt', {
      method: 'POST', headers,
      body: JSON.stringify({ owner, intent: 'start' }),
    });
    // A missing header must stay missing (Request adds text/plain for a string body).
    if (contentType === null) req.headers.delete('Content-Type');
    const read = vi.spyOn(req, 'json');
    return { args: { request: req, locals } as never, read };
  }

  it.each([
    'application/jsonp', 'application/json-seq', 'application/jsonl',
    'APPLICATION/JSONP; charset=x', 'application/json-extra; charset=utf-8',
    'application/problem+json', 'text/json', 'text/plain',
    'application/json, text/plain', 'application/json /', '', null,
  ])('refuses %s before reading the body or calling GraphQL', async (contentType) => {
    const { args, read } = event(contentType);
    const response = await POST(args);
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({ ok: false });
    expect(read).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    'application/json', 'application/json; charset=utf-8', 'Application/JSON',
    'APPLICATION/JSON ; charset=UTF-8',
  ])('accepts the exact JSON essence %s and reaches the write', async (contentType) => {
    request.mockResolvedValueOnce({ worker: { id: 'w', app: { id: 'a' }, agent: { id: 'g' }, bootPromptRef: null } })
      .mockResolvedValueOnce({ createNode: { id: 'source' } });
    const { args, read } = event(contentType);
    const response = await POST(args);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
    expect(read).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][1]).toMatchObject({ input: { loc: 'boot:workers:w:source' } });
  });

  it.each([
    { token: 'worker' },
    { token: 'viewer', user: { id: 'person' }, impersonation: true },
  ])('preserves the person/impersonation 403 before the media-type boundary: %j', async (locals) => {
    const { args, read } = event('application/jsonp', locals);
    expect((await POST(args)).status).toBe(403);
    expect(read).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });
});

// portal#1754 bullets 1 and 2: boundary refusals, with the file's own bodies (POST { ok: false }, GET { failed: true }).
describe('portal#1754 POST body that is not a plain object', () => {
  const rawPost = (raw: string) => POST({ request: new Request('https://portal.invalid/app/boot-prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw }), locals: { token: 'viewer', user: { id: 'person' } } } as never);
  it.each(['null', 'true', '0', '"x"', '[]'])('a JSON body of %s answers 400 { ok: false } with no upstream call', async raw => {
    const response = await rawPost(raw);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false });
    expect(request).not.toHaveBeenCalled();
  });
});
describe('portal#1754 malformed GET node', () => {
  const get = (query: string) => GET({ url: new URL(`https://portal.invalid/app/boot-prompt?${query}`), locals: { token: 'viewer' }, setHeaders: vi.fn() } as never);
  it.each([['blank', 'node='], ['whitespace', 'node=%20%20']])('a %s node answers 400 { failed: true } before any upstream call', async (_n, query) => {
    const response = await get(`${query}&revision=3`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ failed: true });
    expect(request).not.toHaveBeenCalled();
  });
  it.each([['a primary key', 'node=01a1e92c5cfa75c3badb2091328545e1'], ['a URN', 'node=hrn:node:hadronmemory.com:m:a:b'], ['a 546-character qualified URN', `node=hrn:node:example.com:mem:${'a:'.repeat(260)}z`]])('%s is not refused', async (_n, query) => {
    request.mockResolvedValueOnce({ compiledPromptProvenance: { items: [], total: 0, hasMore: false, pruned: false } });
    expect((await get(`${query}&revision=3`)).status).toBe(200);
    expect(request).toHaveBeenCalledOnce();
  });
  it('forwards the trimmed value it validated, never the padded one', async () => {
    request.mockResolvedValueOnce({ compiledPromptProvenance: { items: [], total: 0, hasMore: false, pruned: false } });
    expect((await get('node=%20c%20&revision=3')).status).toBe(200);
    expect(JSON.stringify(request.mock.calls[0][1])).toContain('"c"');
    expect(JSON.stringify(request.mock.calls[0][1])).not.toContain('" c');
  });
});
