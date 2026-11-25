import { beforeEach, describe, expect, it, vi } from 'vitest';
const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
import { POST } from './+server';
import { loadRulebook, loadTemplates, mutateTemplate, CONFIG_QUERY, TEMPLATES_QUERY } from '$lib/server/memory-config/service';
const url = new URL('http://localhost/api/memory-config');
function event(body: unknown, impersonation: unknown = null) {
  return { url, request: new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', origin: url.origin }, body: JSON.stringify(body) }), locals: { token: 'caller', impersonation } } as Parameters<typeof POST>[0];
}
beforeEach(() => { request.mockReset(); });
describe('organization default on the template write (portal#1743)', () => {
  it('the template read, and both writes, select orgDefault', async () => {
    expect(TEMPLATES_QUERY).toContain('orgDefault');
    request.mockResolvedValue({});
    const c = { request };
    await mutateTemplate(c, { impersonating: false, ownerType: 'ORGANIZATION', ownerRef: 'o', op: 'create', input: { name: 'a', required: false } });
    await mutateTemplate(c, { impersonating: false, ownerType: 'ORGANIZATION', ownerRef: 'o', op: 'update', ref: 't', revision: 3, input: { name: 'a', required: false } });
    expect(request.mock.calls[0][0]).toContain('orgDefault');
    expect(request.mock.calls[1][0]).toContain('orgDefault');
  });
  it('the switch rides on the update with the expected revision, and an unset switch is not sent', async () => {
    request.mockResolvedValue({});
    await POST(event({ kind: 'templates', op: 'update', ownerType: 'ORGANIZATION', ownerRef: 'o', ref: 't', revision: 3, input: { name: 'a', required: false, orgDefault: true } }));
    expect(request.mock.calls[0][1]).toMatchObject({ ref: 't', expectedRevision: 3, input: { orgDefault: true } });
    await POST(event({ kind: 'templates', op: 'update', ownerType: 'USER', ownerRef: 'u', ref: 't', revision: 3, input: { name: 'a', required: false } }));
    expect(request.mock.calls[1][1].input).not.toHaveProperty('orgDefault');
  });
  it('impersonation never writes the switch', async () => {
    const response = await POST(event({ kind: 'templates', op: 'update', ownerType: 'ORGANIZATION', ownerRef: 'o', ref: 't', revision: 3, input: { name: 'a', required: false, orgDefault: true } }, { sessionId: 'imp' }));
    expect(response.status).toBe(403); expect(request).not.toHaveBeenCalled();
  });
  it('answers the server\'s own limit text with its reason, naming no cap of its own', async () => {
    request.mockRejectedValue({ response: { errors: [{ message: 'An organization can have at most 4 default templates.', extensions: { code: 'BAD_USER_INPUT', reason: 'ORG_DEFAULT_LIMIT' } }] } });
    const res = await POST(event({ kind: 'templates', op: 'create', ownerType: 'ORGANIZATION', ownerRef: 'o', input: { name: 'a', required: false, orgDefault: true } }));
    const body = await res.json();
    expect(body).toMatchObject({ code: 'BAD_USER_INPUT', reason: 'ORG_DEFAULT_LIMIT', error: 'An organization can have at most 4 default templates.' });
  });
  it('the rules read asks for defaultSkips, and the page data keeps what the server sent', async () => {
    expect(CONFIG_QUERY).toContain('defaultSkips');
    const skip = { role: 'review', field: 'authorTask', reason: 'REFERENCE_UNAVAILABLE', ref: null, refState: 'BROKEN', sourceTemplate: null, createdAt: '2026-11-01T00:00:00Z' };
    request.mockResolvedValue({ memory: { config: { id: 'c', rules: [], defaultSkips: [skip] } } });
    expect((await loadRulebook({ request }, 'm'))?.defaultSkips).toEqual([skip]);
  });
  it('reads every template page with orgDefault intact', async () => {
    request.mockResolvedValue({ memoryConfigTemplates: { total: 1, items: [{ id: 't', orgDefault: true }] } });
    expect((await loadTemplates({ request }, 'ORGANIZATION', 'o'))[0]).toMatchObject({ orgDefault: true });
  });
});
