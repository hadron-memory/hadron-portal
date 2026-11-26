/**
 * portal#2634: a member creates their own personal or private memory in an App. The class choices are exactly
 * App.viewerAppUserMemoryClasses; the server names the memory and decides every outcome (cor:dmo:060:20, cor:api:240:01).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSchema, parse, validate } from 'graphql';
import { readFileSync } from 'node:fs';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
beforeEach(() => { request.mockReset(); });

async function submit(fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  expect(typeof actions.createOwnMemory).toBe('function');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return actions.createOwnMemory({ request: { formData: async () => fd }, params: { appId: 'route-app' }, locals: { token: 'synthetic' } } as never);
}
const valid = { _kind: 'createOwnAppMemory', memoryClass: 'private', agentId: 'agent-1' };
const refusal = (code: string) => ({ response: { errors: [{ message: 'secret SQL /private/path: already holds one', extensions: { code } }] } });

describe('createOwnMemory action', () => {
  it('calls createMemoryInApp on the route App with the chosen class, and shows the memory the server returns', async () => {
    request.mockResolvedValue({ createMemoryInApp: { id: 'm1', urn: 'hrn:mem:alice:tutor-alice-private-2', name: 'tutor-alice-private-2' } });
    const result = await submit({ ...valid, appRef: 'other-app', organizationId: 'org-x' }) as any;
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][0]).toContain('createMemoryInApp');
    expect(request.mock.calls[0][1]).toMatchObject({ appRef: 'route-app', agentRef: 'agent-1', memoryClass: 'private' });
    expect(JSON.stringify(request.mock.calls[0][1])).not.toContain('other-app');
    expect(result.form.message.type).toBe('success');
    // the server's name and URN as returned: a numeric tail and the user's root are not rebuilt
    expect(result.form.message.created).toEqual({ id: 'm1', urn: 'hrn:mem:alice:tutor-alice-private-2', name: 'tutor-alice-private-2' });
  });
  it.each(['system', 'app', 'knowledge', 'group', '', 'Personal'])('rejects class %j without a call', async (memoryClass) => {
    const result = await submit({ ...valid, memoryClass }) as any;
    expect(result.status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it('rejects a missing Agent and a foreign kind without a call', async () => {
    expect(((await submit({ ...valid, agentId: '' })) as any).status).toBe(400);
    expect(((await submit({ ...valid, _kind: 'deleteApp' })) as any).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
  });
  it.each([
    ['APP_USER_MEMORY_ALREADY_EXISTS', 409, 'already have'],
    ['FORBIDDEN', 403, 'member'],
    ['UNAUTHENTICATED', 401, 'Sign in'],
    ['AGENT_NOT_INSTALLED', 409, 'Install'],
    ['APP_UNINSTALLED', 409, 'Install'],
    ['UNSUPPORTED_MEMORY_CLASS', 400, 'isn’t available'],
    ['FUTURE_CODE', 500, 'try again'],
  ])('maps %s to its own fixed copy, never the server text', async (code, status, copy) => {
    request.mockRejectedValue(refusal(code));
    const result = await submit(valid) as any;
    expect(result.status).toBe(status);
    expect(result.data.form.message.text).toContain(copy);
    expect(JSON.stringify(result)).not.toContain('secret SQL');
  });
  it('the already-holds-one refusal has copy no other refusal shares, and keys on the code not the text', async () => {
    request.mockRejectedValue(refusal('APP_USER_MEMORY_ALREADY_EXISTS'));
    const held = (await submit(valid) as any).data.form.message.text;
    request.mockRejectedValue({ response: { errors: [{ message: 'already holds one', extensions: { code: 'FUTURE_CODE' } }] } });
    const other = (await submit(valid) as any).data.form.message.text;
    expect(held).not.toBe(other);
  });
  it('a transport error leaks nothing', async () => {
    request.mockRejectedValue(new Error('secret SQL /private/path'));
    const result = await submit(valid) as any;
    expect(result.status).toBe(500);
    expect(JSON.stringify(result)).not.toContain('secret SQL');
  });
});

describe('readViewerMemoryClasses', () => {
  it('returns the server list as is, and null (not an empty list) when the read fails', async () => {
    const { readViewerMemoryClasses } = await import('./app-memories');
    request.mockResolvedValue({ app: { viewerAppUserMemoryClasses: ['personal'] } });
    expect(await readViewerMemoryClasses({ request } as never, 'a1')).toEqual(['personal']);
    request.mockResolvedValue({ app: { viewerAppUserMemoryClasses: [] } });
    expect(await readViewerMemoryClasses({ request } as never, 'a1')).toEqual([]);
    request.mockRejectedValue(new Error('down'));
    expect(await readViewerMemoryClasses({ request } as never, 'a1')).toBeNull();
    request.mockResolvedValue({ app: null });
    expect(await readViewerMemoryClasses({ request } as never, 'a1')).toBeNull();
  });
  it('drops a class that is not personal or private rather than offering it', async () => {
    const { readViewerMemoryClasses } = await import('./app-memories');
    request.mockResolvedValue({ app: { viewerAppUserMemoryClasses: ['personal', 'system'] } });
    expect(await readViewerMemoryClasses({ request } as never, 'a1')).toEqual(['personal']);
  });
});

describe('the operations select fields the committed snapshot has', () => {
  it('both documents validate against schema/schema.graphql', async () => {
    const { CREATE_MEMORY_IN_APP_MUTATION, APP_USER_MEMORY_CLASSES_QUERY } = await import('./app-memories');
    const schema = buildSchema(readFileSync('schema/schema.graphql', 'utf8').replace(/^#.*$/m, ''));
    for (const doc of [CREATE_MEMORY_IN_APP_MUTATION, APP_USER_MEMORY_CLASSES_QUERY]) expect(validate(schema, parse(doc))).toEqual([]);
  });
});
