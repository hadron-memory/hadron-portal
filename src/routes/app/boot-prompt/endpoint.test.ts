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
  it('bad provenance offsets are refused before a read', async () => {
    const response = await GET({ url: new URL('https://portal.invalid/app/boot-prompt?node=c&revision=3&offset=-1'), locals: { token: 'viewer' } } as never);
    expect(response.status).toBe(400); expect(request).not.toHaveBeenCalled();
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
