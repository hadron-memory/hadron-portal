/**
 * #1451 — the App page offers the create-memory form to the owner of a
 * user-owned App (no organization), and only to them. The loader's offer rule
 * reads the viewer's manage right on the App; the server stays the gate.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_QUERY, APP_MEMBERS_QUERY, SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';

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


async function loadAs(canManage: boolean) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === APP_QUERY) return { app: APP };
    if (query === APP_MEMBERS_QUERY) return { app: { members: [] } };
    if (query === SELF_CAN_MANAGE_QUERY) return { effectiveAccess: { canManage } };
    return {};
  });
  const { load } = await import('./+page.server');
  return (await load({
    params: { id: 'org-1', appId: 'app-1' },
    locals: { token: 'tok', user: { id: 'user-1' } },
    parent: async () => ({}),
    depends: () => {},
    url: new URL('http://localhost/app/apps/app-1'),
  } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>;
}

describe('create-memory offer on a user-owned App', () => {
  it('is offered to the owner (manage right)', async () => {
    expect((await loadAs(true)).canCreateMemory).toBe(true);
  });
  it('is not offered to a viewer who cannot manage the App', async () => {
    expect((await loadAs(false)).canCreateMemory).toBe(false);
  });
});
