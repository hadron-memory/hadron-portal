import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import {
  ADD_MEMBER_MUTATION,
  CREATE_USER_INVITATION_MUTATION,
  REMOVE_MEMBER_MUTATION,
  UPDATE_MEMBER_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

const fakeOrg = {
  id: 'org-id-123',
  name: 'Acme',
  urn: 'hrn:org:acme',
  members: [],
  memories: [],
  agents: [],
  subscriptions: [],
};

beforeEach(() => {
  mockRequest.mockReset();
});

async function importMod() {
  return import('./+page.server');
}

function loadEv(opts: { orgId?: string; userId?: string | null } = {}) {
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: {
      token: 'test-token',
      user: opts.userId === undefined ? { id: 'user-1' } : opts.userId ? { id: opts.userId } : null,
    },
    parent: async () => ({ org: fakeOrg }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['load']>[0];
}

function actionEv(
  fields: Record<string, string>,
  opts: { orgId?: string; origin?: string; userId?: string | null } = {},
) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: {
      token: 'test-token',
      user: opts.userId === undefined ? { id: 'user-1' } : opts.userId ? { id: opts.userId } : null,
    },
    request: { formData: async () => fd },
    url: new URL(opts.origin ?? 'https://portal.example.test/app/orgs/org-id-123/members'),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['invite']>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

function formError(result: unknown): string | undefined {
  return superFormFrom(result)?.errors?._errors?.[0];
}

async function runInvite(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.invite(actionEv(fields));
}

async function runAdd(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.add(actionEv(fields));
}

async function runUpdate(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.update(actionEv(fields));
}

async function runRemove(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.remove(actionEv(fields));
}

async function runLeave(fields: Record<string, string>, opts: { userId?: string | null } = {}) {
  const { actions } = await importMod();
  return actions.leave(actionEv(fields, opts));
}

describe('org members load()', () => {
  it('loads the organization, current user, and quiet empty invite form', async () => {
    mockRequest.mockResolvedValueOnce({ organization: fakeOrg });
    const { load } = await importMod();

    const result = await load(loadEv({ userId: 'user-1' }));

    expect(result).toMatchObject({ org: fakeOrg, currentUserId: 'user-1' });
    expect((result as { inviteForm: { data: Record<string, string> } }).inviteForm.data).toMatchObject({
      _kind: 'inviteOrgMember',
      name: '',
      email: '',
      memberRole: 'READER',
    });
    expect((result as { inviteForm: { errors: Record<string, string[]> } }).inviteForm.errors).toEqual({});
  });

  // #1297: Superforms keys a form's client store by its id, and an id defaults to a
  // hash of the schema's SHAPE. Remove and Impersonate are both { _kind, userId }, so
  // they got the same id, shared one store, and Impersonate submitted with the Remove
  // form's `_kind` ("expected impersonateMember"; no request). Every form on this page
  // needs an id of its own.
  it('gives every form on the page its own Superforms id', async () => {
    mockRequest.mockResolvedValueOnce({ organization: fakeOrg });
    const { load } = await importMod();

    expectDistinctFormIds(await load(loadEv({ userId: 'user-1' })), 6);
  });

  // #1318 pinned impersonate only. Each action must answer under the id its form was
  // loaded with, or the result reaches a different form's store (#1320).
  it.each([
    ['add', 'addForm'],
    ['update', 'updateForm'],
    ['remove', 'removeForm'],
    ['invite', 'inviteForm'],
    ['leave', 'leaveForm'],
    ['impersonate', 'impersonateForm'],
  ] as const)('the %s action answers under the same id its form was loaded with', async (action, formName) => {
    mockRequest.mockResolvedValueOnce({ organization: fakeOrg });
    const { load, actions } = await importMod();
    const loaded = (await load(loadEv({ userId: 'user-1' }))) as unknown as Record<string, { id: string }>;

    // An empty post fails validation, so no mutation runs and the action returns its form.
    const result = await actions[action](actionEv({ _kind: '' }));

    expect(superFormFrom(result)).toBeDefined();
    expect((superFormFrom(result) as { id: string }).id).toBe(loaded[formName].id);
  });
});

describe('org members add/update/remove/leave actions', () => {
  it('adds an existing org member with trimmed form data', async () => {
    mockRequest.mockResolvedValueOnce({ addOrganizationMember: true });

    const result = await runAdd({ userId: '  user-2  ', role: 'ADMIN' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Member added.' });
    expect(mockRequest).toHaveBeenCalledWith(ADD_MEMBER_MUTATION, {
      orgId: 'org-id-123',
      userId: 'user-2',
      role: 'ADMIN',
    });
  });

  it('returns add GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('add failed'));

    const result = await runAdd({ userId: 'user-2', role: 'ADMIN' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'add failed' });
  });

  it('rejects add payloads with the wrong action discriminator', async () => {
    const result = await runAdd({ _kind: 'removeOrgMember', userId: 'user-2', role: 'ADMIN' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects add payloads with an omitted user before calling the API', async () => {
    const result = await runAdd({ role: 'ADMIN' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'userId')).toBe('User is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('updates a member role with Superforms validation', async () => {
    mockRequest.mockResolvedValueOnce({ updateOrganizationMember: true });

    const result = await runUpdate({ userId: 'user-2', role: 'CONTRIBUTOR' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Member updated.' });
    expect(mockRequest).toHaveBeenCalledWith(UPDATE_MEMBER_MUTATION, {
      orgId: 'org-id-123',
      userId: 'user-2',
      role: 'CONTRIBUTOR',
    });
  });

  it('returns update GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('update failed'));

    const result = await runUpdate({ userId: 'user-2', role: 'CONTRIBUTOR' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'update failed' });
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

  it('removes a member with a typed success message', async () => {
    mockRequest.mockResolvedValueOnce({ removeOrganizationMember: true });

    const result = await runRemove({ userId: 'user-2' });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Member removed.' });
    expect(mockRequest).toHaveBeenCalledWith(REMOVE_MEMBER_MUTATION, {
      orgId: 'org-id-123',
      userId: 'user-2',
    });
  });

  it('returns remove GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('remove failed'));

    const result = await runRemove({ userId: 'user-2' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'remove failed' });
  });

  it('leaves the organization as the current user', async () => {
    mockRequest.mockResolvedValueOnce({ removeOrganizationMember: true });

    await expect(runLeave({ _kind: 'leaveOrg' }, { userId: 'user-self' }))
      .rejects
      .toMatchObject({ status: 303, location: '/app/orgs' });
    expect(mockRequest).toHaveBeenCalledWith(REMOVE_MEMBER_MUTATION, {
      orgId: 'org-id-123',
      userId: 'user-self',
    });
  });

  it('returns unauthenticated leave failures as Superforms messages', async () => {
    const result = await runLeave({ _kind: 'leaveOrg' }, { userId: null });

    expect(result).toMatchObject({ status: 401 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Not authenticated' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns 401 for unauthenticated leave even when the body is invalid', async () => {
    const result = await runLeave({ _kind: 'removeOrgMember' }, { userId: null });

    expect(result).toMatchObject({ status: 401 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Not authenticated' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns leave GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('leave failed'));

    const result = await runLeave({ _kind: 'leaveOrg' }, { userId: 'user-self' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'leave failed' });
  });
});

describe('org members invite action', () => {
  it('rejects invite payloads with the wrong action discriminator', async () => {
    const result = await runInvite({ _kind: 'addOrgMember', name: 'Ada', email: '', memberRole: 'READER' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an empty recipient before calling the API', async () => {
    const result = await runInvite({ name: '', email: '', memberRole: 'READER' });

    expect(result).toMatchObject({ status: 400 });
    expect(formError(result)).toBe('Enter a name or email address.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an invalid email before calling the API', async () => {
    const result = await runInvite({ name: '', email: 'not-an-email', memberRole: 'READER' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Enter a valid email address.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('creates an invite link with trimmed form data', async () => {
    mockRequest.mockResolvedValueOnce({ createUserInvitation: { slug: 'invite-slug' } });

    const result = await runInvite({
      name: '  Ada  ',
      email: '  ada@example.test  ',
      memberRole: 'ADMIN',
    });

    expect(result).toMatchObject({
      inviteUrl: 'https://portal.example.test/invite/invite-slug',
      inviteName: 'Ada',
    });
    expect(superFormFrom(result)?.valid).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith(CREATE_USER_INVITATION_MUTATION, {
      orgId: 'org-id-123',
      memberRole: 'ADMIN',
      name: 'Ada',
      email: 'ada@example.test',
      maxActivations: 2,
      expiresInDays: 10,
    });
  });

  it('allows a name-only invite and sends a null email', async () => {
    mockRequest.mockResolvedValueOnce({ createUserInvitation: { slug: 'name-only' } });

    await runInvite({ name: 'Ada', email: '', memberRole: 'CONTRIBUTOR' });

    expect(mockRequest).toHaveBeenCalledWith(CREATE_USER_INVITATION_MUTATION, expect.objectContaining({
      name: 'Ada',
      email: null,
      memberRole: 'CONTRIBUTOR',
    }));
  });

  it('returns GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));

    const result = await runInvite({ name: 'Ada', email: '', memberRole: 'READER' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'boom' });
  });
});
