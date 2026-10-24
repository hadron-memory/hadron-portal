import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

async function actions() {
  return (await import('./+page.server')).actions;
}
async function load() {
  return (await import('./+page.server')).load;
}

function ev(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return { locals: { token: 't' }, params: { id: 'agent-1' }, request: { formData: async () => fd } } as any;
}
const gqlErr = (code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error('boom'), { response: { errors: [{ message: 'RAW', extensions: { code, ...extra } }] } });
const formOf = (r: any) => (r?.data?.form ?? r?.form);

describe('clone action', () => {
  it('redirects 303 to the new agent and sends blank name/slug as absent', async () => {
    mockRequest.mockResolvedValue({ cloneAgent: { id: 'new-9' } });
    const a = await actions();
    await expect(a.default(ev({ target: 'org-2', name: '', slug: '' }))).rejects.toMatchObject({ status: 303, location: '/app/agents/new-9' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ source: 'agent-1', target: 'org-2' });
  });
  it('forwards a provided name and slug', async () => {
    mockRequest.mockResolvedValue({ cloneAgent: { id: 'n' } });
    const a = await actions();
    await Promise.resolve(a.default(ev({ target: 'org-2', name: 'My copy', slug: 'my-copy' }))).catch(() => {});
    expect(mockRequest.mock.calls[0][1]).toEqual({ source: 'agent-1', target: 'org-2', name: 'My copy', slug: 'my-copy' });
  });
  it('requires a target without calling the server', async () => {
    const a = await actions();
    const r: any = await a.default(ev({ target: '', name: '', slug: '' }));
    expect(r.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });
  it('AGENT_URN_TAKEN becomes a slug field error (a mutant dropping it fails here)', async () => {
    mockRequest.mockRejectedValue(gqlErr('AGENT_URN_TAKEN'));
    const a = await actions();
    const r: any = await a.default(ev({ target: 'org-2', name: '', slug: 'taken' }));
    expect(r.status).toBe(409);
    expect(formOf(r).errors.slug?.length).toBeGreaterThan(0);
  });
  it('a blocker refusal returns its blockers and a localized message', async () => {
    mockRequest.mockRejectedValue(gqlErr('CLONE_BASE_UNUSABLE', { blockers: [{ code: 'BASE_NOT_LICENSED', count: 1, subjects: [{ position: 0, name: 'Base' }] }] }));
    const a = await actions();
    const r: any = await a.default(ev({ target: 'org-2', name: '', slug: '' }));
    expect(formOf(r).message.type).toBe('error');
    expect(formOf(r).message.text).not.toContain('RAW');
    expect(r.data.blockers).toEqual([{ code: 'BASE_NOT_LICENSED', count: 1, subjects: [{ position: 0, name: 'Base' }] }]);
  });
  it('a transport error shows generic text and leaks no payload', async () => {
    mockRequest.mockRejectedValue(new Error('Authorization: Bearer tok_123'));
    const a = await actions();
    const r: any = await a.default(ev({ target: 'org-2', name: '', slug: '' }));
    expect(JSON.stringify(r)).not.toContain('tok_123');
    expect(formOf(r).message.type).toBe('error');
  });
});

describe('clone load', () => {
  const parent = async () => ({
    user: { id: 'me' },
    navOrgs: [
      { id: 'a', urn: 'u:a', name: 'A', members: [{ id: 'm1', role: 'ADMIN', user: { id: 'me' } }] },
      { id: 'b', urn: 'u:b', name: 'B', members: [{ id: 'm2', role: 'MEMBER', user: { id: 'me' } }] },
    ],
  });
  it('404s an unreadable (null) source exactly like not-found', async () => {
    mockRequest.mockResolvedValue({ agent: null });
    const l = await load();
    await expect(l({ params: { id: 'x' }, locals: { token: 't' }, parent } as any)).rejects.toMatchObject({ status: 404 });
  });
  it('lists only OWNER/ADMIN orgs as targets', async () => {
    mockRequest.mockResolvedValue({ agent: { id: 'agent-1', urn: 'hrn:agent:x:y', name: 'Y', visibility: 'PUBLIC', organizationId: 'z' } });
    const l = await load();
    const d: any = await l({ params: { id: 'agent-1' }, locals: { token: 't' }, parent } as any);
    expect(d.targets.map((o: any) => o.id)).toEqual(['a']);
    expect(d.agent.id).toBe('agent-1');
  });
  it('a typed FORBIDDEN read is a plain 404; an internal error is a 500', async () => {
    const l = await load();
    mockRequest.mockRejectedValue(gqlErr('FORBIDDEN'));
    await expect(l({ params: { id: 'x' }, locals: { token: 't' }, parent } as any)).rejects.toMatchObject({ status: 404 });
    mockRequest.mockRejectedValue(gqlErr('INTERNAL_SERVER_ERROR'));
    await expect(l({ params: { id: 'x' }, locals: { token: 't' }, parent } as any)).rejects.toMatchObject({ status: 500 });
  });
  it('a transport failure is a 500, not a not-found', async () => {
    mockRequest.mockRejectedValue(new Error('down'));
    const l = await load();
    await expect(l({ params: { id: 'x' }, locals: { token: 't' }, parent } as any)).rejects.toMatchObject({ status: 500 });
  });
});
