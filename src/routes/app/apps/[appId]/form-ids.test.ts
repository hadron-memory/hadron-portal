/**
 * #1320 — every form the App page's loader returns has a Superforms id of its
 * own. Add member and Ensure member were both `{ _kind, userId, role }`, so they
 * hashed to one id and shared one client store.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_QUERY, APP_MEMBERS_QUERY, SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';
import { expectDistinctFormIds, formIdsOf } from '$lib/test/expectDistinctFormIds';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/paginate', () => ({ fetchAllItems: vi.fn().mockResolvedValue([]) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

const APP = {
  id: 'app-1', name: 'Demo App', urn: 'hadronmemory.com:demo-org:demo-app', organizationId: null,
  appType: 'CHATBOT', role: 'ADMIN', description: null, systemPrompt: null, createUserPermission: 'DENY',
  identifyUserMethod: 'USER_ID', sessionTimeoutSeconds: 3600, anonymousTtlDays: 14, agentId: null, agent: null,
};

// Restored per test: the config sets no restoreMocks, so an unrestored spy
// would swallow console output for every later test in the worker.
const consoleSpies: Array<{ mockRestore: () => void }> = [];
afterEach(() => {
  while (consoleSpies.length) consoleSpies.pop()!.mockRestore();
});

beforeEach(() => {
  mockRequest.mockReset();
  consoleSpies.push(
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  );
  // The App is the one read the forms hang off; every other read is empty, which
  // the loader treats as "none".
  mockRequest.mockImplementation(async (query: string) => {
    if (query === APP_QUERY) return { app: APP };
    if (query === APP_MEMBERS_QUERY) return { app: { members: [] } };
    if (query === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage: true } };
    return {};
  });
});

describe('App page loader', () => {
  it('#1320 gives every form its own Superforms id', async () => {
    const { load } = await import('./+page.server');
    const data = await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0]);
    expectDistinctFormIds(data, 10);
  });

  // The result of an action reaches the form whose id it carries, so it must
  // answer under the id its form was loaded with.
  it.each([
    ['addMember', 'addMemberForm'],
    ['ensureMember', 'ensureMemberForm'],
  ] as const)('the %s action answers under the id its form was loaded with', async (action, formName) => {
    const { load, actions } = await import('./+page.server');
    const data = await load({
      params: { id: 'org-1', appId: 'app-1' },
      locals: { token: 'tok', user: { id: 'user-1' } },
      parent: async () => ({}),
      depends: () => {},
      url: new URL('http://localhost/app/apps/app-1'),
    } as unknown as Parameters<typeof load>[0]);
    const body = new FormData();
    // An empty post fails validation, so no mutation runs and the action returns its form.
    const result = (await actions[action]({ request: new Request('http://localhost/', { method: 'POST', body }), params: { appId: 'app-1' }, locals: { token: 'tok' } } as never)) as unknown as { data: { form: { id: string } } };
    expect(result.data.form.id).toBe(formIdsOf(data).find((f) => f.key === formName)?.id);
  });
});
