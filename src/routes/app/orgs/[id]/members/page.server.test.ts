import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_USER_INVITATION_MUTATION } from '$lib/server/queries';

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

function actionEv(fields: Record<string, string>, opts: { orgId?: string; origin?: string } = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { id: opts.orgId ?? 'org-id-123' },
    locals: { token: 'test-token' },
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

async function runInvite(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.invite(actionEv(fields));
}

describe('org members load()', () => {
  it('loads the organization, current user, and quiet empty invite form', async () => {
    mockRequest.mockResolvedValueOnce({ organization: fakeOrg });
    const { load } = await importMod();

    const result = await load(loadEv({ userId: 'user-1' }));

    expect(result).toMatchObject({ org: fakeOrg, currentUserId: 'user-1' });
    expect((result as { inviteForm: { data: Record<string, string> } }).inviteForm.data).toMatchObject({
      name: '',
      email: '',
      memberRole: 'READER',
    });
    expect((result as { inviteForm: { errors: Record<string, string[]> } }).inviteForm.errors).toEqual({});
  });
});

describe('org members invite action', () => {
  it('rejects an empty recipient before calling the API', async () => {
    const result = await runInvite({ name: '', email: '', memberRole: 'READER' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'name')).toBe('Enter a name or email address.');
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
      maxActivations: 1,
      expiresInDays: 30,
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
    expect(superFormFrom(result)?.message).toBe('boom');
  });
});
