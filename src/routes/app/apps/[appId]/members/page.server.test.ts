import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APP_WITH_MEMBERS_QUERY,
  ENSURE_APP_MEMBER_MUTATION,
  ORG_CHROME_QUERY,
  REMOVE_APP_MEMBER_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
const mockFetchAllItems = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: mockFetchAllItems,
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

const fakeOrg = {
  id: 'org-1',
  name: 'Acme',
  urn: 'hrn:org:acme',
  members: [],
  memories: [],
  agents: [],
  subscriptions: [],
};

const fakeUsers = [
  { id: 'user-existing', handle: 'existing', githubUsername: 'existing', name: 'Existing', avatarUrl: null, email: null },
  { id: 'user-new', handle: 'new', githubUsername: 'new', name: 'New User', avatarUrl: null, email: 'new@example.test' },
];

const fakeApp = {
  id: 'app-1',
  name: 'Digest',
  urn: 'hrn:app:acme::digest',
  organizationId: 'org-1',
  members: [
    {
      appId: 'app-1',
      userId: 'user-existing',
      role: 'reader',
      user: fakeUsers[0],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: null,
    },
  ],
  agent: {
    id: 'agent-1',
    name: 'Digest Agent',
    urn: 'hrn:agent:acme::digest',
    installationPolicy: { memberRoles: ['reader', 'editor'], maxMembers: '10' },
  },
};

beforeEach(() => {
  mockRequest.mockReset();
  mockFetchAllItems.mockReset();
  mockFetchAllItems.mockResolvedValue(fakeUsers);
});

async function importMod() {
  return import('./+page.server');
}

function loadEv(opts: { orgId?: string; appId?: string } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-1', appId: opts.appId ?? 'app-1' },
    locals: { token: 'test-token' },
    parent: async () => ({}),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['load']>[0];
}

function actionEv(fields: Record<string, string>, opts: { orgId?: string; appId?: string } = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { id: opts.orgId ?? 'org-1', appId: opts.appId ?? 'app-1' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['add']>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

async function runAdd(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.add(actionEv(fields));
}

async function runEnsure(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.ensure(actionEv(fields));
}

async function runRemove(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.remove(actionEv(fields));
}

function gqlError(code: string, message = 'GraphQL failed') {
  return {
    response: {
      errors: [{ message, extensions: { code } }],
    },
  };
}

describe('app members load()', () => {
  it('loads app members and seeds the add form (empty userId — the picker searches on demand)', async () => {
    mockRequest
      .mockResolvedValueOnce({ app: fakeApp })
      .mockResolvedValueOnce({ organization: fakeOrg });

    const { load } = await importMod();
    const result = await load(loadEv());

    expect(mockRequest).toHaveBeenNthCalledWith(1, APP_WITH_MEMBERS_QUERY, { ref: 'app-1' });
    expect(mockRequest).toHaveBeenNthCalledWith(2, ORG_CHROME_QUERY, { ref: 'org-1' });
    expect(result).toMatchObject({ app: fakeApp, org: fakeOrg, members: fakeApp.members });
    // #653: no bulk user list is loaded any more.
    expect(result).not.toHaveProperty('allUsers');
    expect(mockFetchAllItems).not.toHaveBeenCalled();
    expect((result as { addForm: { data: Record<string, string>; errors: Record<string, string[]> } }).addForm.data).toMatchObject({
      _kind: 'addAppMember',
      userId: '',
      role: 'reader',
    });
    expect((result as { addForm: { errors: Record<string, string[]> } }).addForm.errors).toEqual({});
  });
});

describe('app members add action', () => {
  it('rejects add payloads with the wrong action discriminator', async () => {
    const result = await runAdd({ _kind: 'ensureAppMember', userId: 'user-new', role: 'reader' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an empty user before calling the API', async () => {
    const result = await runAdd({ userId: '', role: 'reader' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'userId')).toBe('User is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an omitted user before calling the API', async () => {
    const result = await runAdd({ role: 'reader' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'userId')).toBe('User is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an empty role before calling the API', async () => {
    const result = await runAdd({ userId: 'user-new', role: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'role')).toBe('Role is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('adds the app member with trimmed form data', async () => {
    mockRequest.mockResolvedValueOnce({ ensureAppMember: { appId: 'app-1', userId: 'user-new', role: 'editor' } });

    const result = await runAdd({ userId: '  user-new  ', role: '  editor  ' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Member added.' });
    expect(superFormFrom(result)?.valid).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith(ENSURE_APP_MEMBER_MUTATION, {
      appId: 'app-1',
      userId: 'user-new',
      role: 'editor',
    });
  });

  it('returns typed app-member failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('MaxMembersExceededError'));

    const result = await runAdd({ userId: 'user-new', role: 'reader' });

    expect(result).toMatchObject({ status: 409 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'This App is at the member limit set by the Agent author. Remove a member or ask the Agent author to raise the cap.',
    });
  });

  it('returns invalid roles as role field errors', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('InvalidRoleError'));

    const result = await runAdd({ userId: 'user-new', role: 'admin' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'role')).toBe(
      'That role isn’t permitted by this Agent. Pick one of the roles offered by the Agent author.',
    );
  });
});

describe('app members ensure/remove actions', () => {
  it('rejects ensure payloads with the wrong action discriminator', async () => {
    const result = await runEnsure({ _kind: 'removeAppMember', userId: 'user-existing', role: 'editor' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects ensure payloads with an omitted role before calling the API', async () => {
    const result = await runEnsure({ userId: 'user-existing' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'role')).toBe('Role is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('updates an app member role with trimmed Superforms data', async () => {
    mockRequest.mockResolvedValueOnce({ ensureAppMember: { appId: 'app-1', userId: 'user-existing', role: 'editor' } });

    const result = await runEnsure({ userId: ' user-existing ', role: ' editor ' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Member updated.' });
    expect(mockRequest).toHaveBeenCalledWith(ENSURE_APP_MEMBER_MUTATION, {
      appId: 'app-1',
      userId: 'user-existing',
      role: 'editor',
    });
  });

  it('returns typed ensure failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('MaxMembersExceededError'));

    const result = await runEnsure({ userId: 'user-existing', role: 'editor' });

    expect(result).toMatchObject({ status: 409 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'This App is at the member limit set by the Agent author. Remove a member or ask the Agent author to raise the cap.',
    });
  });

  it('returns invalid ensure roles as role field errors', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('InvalidRoleError'));

    const result = await runEnsure({ userId: 'user-existing', role: 'admin' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'role')).toBe(
      'That role isn’t permitted by this Agent. Pick one of the roles offered by the Agent author.',
    );
  });

  it('rejects remove without a selected user before calling the API', async () => {
    const result = await runRemove({ userId: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'userId')).toBe('User is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects remove with an omitted user before calling the API', async () => {
    const result = await runRemove({});

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'userId')).toBe('User is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('removes an app member with a typed success message', async () => {
    mockRequest.mockResolvedValueOnce({ removeAppMember: true });

    const result = await runRemove({ userId: 'user-existing' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Member removed.' });
    expect(mockRequest).toHaveBeenCalledWith(REMOVE_APP_MEMBER_MUTATION, {
      appId: 'app-1',
      userId: 'user-existing',
    });
  });

  it('returns typed remove failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('Forbidden', 'nope'));

    const result = await runRemove({ userId: 'user-existing' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'nope' });
  });
});

/**
 * #851 — the org lookup classifies its failures.
 *
 * Same defect and same fix as the App detail page: a bare
 * `.catch(() => ({ organization: null }))` classified nothing, so an outage
 * rendered "Organization not found" for the App's own members page.
 *
 * Both directions share `orgRefusal`, so a builder producing a shape
 * `extractGqlErrorCode` cannot read fails the 404 cases rather than silently
 * passing the rethrow ones.
 */
describe('#851 — the members-page org lookup classifies its failures', () => {
  function orgRefusal(code: string, message = 'nope') {
    return Object.assign(new Error(`${message}: ${JSON.stringify({ code })}`), {
      response: { errors: [{ message, extensions: { code } }] },
    });
  }

  async function loadAndCatch() {
    const { load } = await importMod();
    try {
      return { thrown: undefined as unknown, result: await load(loadEv()) };
    } catch (e) {
      return { thrown: e, result: undefined };
    }
  }

  it.each([
    ['ORGANIZATION_NOT_FOUND'],
    ['FORBIDDEN'],
  ])('%s → the pre-existing 404', async (code) => {
    mockRequest
      .mockResolvedValueOnce({ app: fakeApp })
      .mockRejectedValueOnce(orgRefusal(code));
    const { thrown } = await loadAndCatch();
    expect((thrown as { status: number }).status).toBe(404);
    expect((thrown as { body?: { message?: string } }).body?.message).toBe('Organization not found');
  });

  it('INTERNAL_SERVER_ERROR is rethrown, not reported as a missing org', async () => {
    const crash = orgRefusal('INTERNAL_SERVER_ERROR', 'boom');
    mockRequest.mockResolvedValueOnce({ app: fakeApp }).mockRejectedValueOnce(crash);
    const { thrown } = await loadAndCatch();
    expect(thrown).toBe(crash);
    expect((thrown as { status?: number }).status).toBeUndefined();
  });

  it('a transport failure with no GraphQL payload is rethrown — the outage case', async () => {
    const boom = new Error('fetch failed');
    mockRequest.mockResolvedValueOnce({ app: fakeApp }).mockRejectedValueOnce(boom);
    const { thrown } = await loadAndCatch();
    expect(thrown).toBe(boom);
    expect((thrown as { status?: number }).status).toBeUndefined();
  });

  it('an org-less (spec 047) app returns org: null and never queries an org', async () => {
    // The distinction the 404 above exists to preserve: no organizationId is a
    // personal App, not a failed lookup, and it must not 404.
    mockRequest.mockResolvedValueOnce({ app: { ...fakeApp, organizationId: null } });
    const { result, thrown } = await loadAndCatch();
    expect(thrown).toBeUndefined();
    expect((result as { org: unknown }).org).toBeNull();
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('asks for the chrome slice, not a list it never renders', () => {
    // This page reads `org.id` for the back link. ORGANIZATION_QUERY invoked
    // five non-null lists to produce it, any one of which could null the org
    // and 404 the page —
    // hrn:node:hadronmemory.com:hadron-portal:review:a-route-must-not-invoke-a-resolver-it-does-not-render
    for (const unrendered of ['members', 'memories', 'agents', 'subscriptions', 'exchangeConnections']) {
      expect(ORG_CHROME_QUERY).not.toMatch(new RegExp(`\\b${unrendered}\\b`));
    }
    expect(ORG_CHROME_QUERY).toMatch(/\bid\b/);
  });
});
