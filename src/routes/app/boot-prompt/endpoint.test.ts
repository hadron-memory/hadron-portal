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
