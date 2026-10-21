import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INSTALL_AGENT_INTO_APP_MUTATION, ORGANIZATIONS_QUERY, ORG_APPS_FOR_REGISTER_QUERY } from '$lib/server/queries';
const request = vi.fn();
const list = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: list }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn() }));
const org = { id: 'org-1', urn: 'hrn:org:acme.com', name: 'Acme', agents: [{ id: 'agent-1', urn: 'hrn:agent:acme.com:helper', name: 'Helper' }], apps: [] };
const app = { id: 'app-1', name: 'Existing', urn: 'hrn:app:acme.com:existing' };
beforeEach(() => {
  request.mockReset(); request.mockResolvedValue({});
  list.mockReset(); list.mockImplementation(async (_client, query) => query === ORGANIZATIONS_QUERY ? [org] : [app]);
});
async function install(appId = 'app-1') {
  const { actions } = await import('./+page.server');
  const fd = new FormData(); fd.set('_kind', 'installExistingApp'); fd.set('appId', appId);
  try { return await actions.installExisting!({ params: { id: 'org-1', aid: 'agent-1' }, locals: { token: 'tok' }, request: { formData: async () => fd } } as never); }
  catch (e) { return e; }
}
describe('#1003 install into an existing App', () => {
  it('uses the existing install mutation with no App creation or override', async () => {
    expect(await install()).toMatchObject({ status: 303, location: '/app/apps/app-1' });
    expect(request).toHaveBeenCalledExactlyOnceWith(INSTALL_AGENT_INTO_APP_MUTATION, { appRef: 'app-1', agentRef: 'agent-1' });
    expect(list).toHaveBeenCalledWith(expect.anything(), ORG_APPS_FOR_REGISTER_QUERY, 'apps', { orgId: 'org-1' });
  });
  it('refuses an app outside the refreshed org list', async () => {
    expect(await install('foreign-app')).toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });
  it('a failed app read is an error, not an empty list', async () => {
    list.mockImplementation(async (_client, query) => { if (query === ORGANIZATIONS_QUERY) return [org]; throw new Error('gateway'); });
    expect(await install()).toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
  });
  it('retains selection on a duplicate install and writes only once', async () => {
    request.mockRejectedValueOnce({ response: { errors: [{ extensions: { code: 'DUPLICATE_APP_AGENT' } }] } });
    const result = await install() as { status: number; data: { form: { data: { appId: string }; errors: { appId: string[] } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.data.appId).toBe('app-1');
    expect(result.data.form.errors.appId[0]).toContain('already installed');
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('does not mistake a failed admission read for a missing agent', async () => {
    list.mockRejectedValueOnce(new Error('gateway'));
    expect(await install()).toMatchObject({ status: 503 });
    expect(request).not.toHaveBeenCalled();
  });

});
