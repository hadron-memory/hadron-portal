import { beforeEach, describe, expect, it, vi } from 'vitest';
import { INVITE_USER_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importMod() {
  return import('./+page.server');
}

function loadEvent(url = 'https://portal.example.test/app/account/invite') {
  return {
    url: new URL(url),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['load']>[0];
}

function actionEvent(fields: Record<string, string>, url = 'https://portal.example.test/app/account/invite') {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
    url: new URL(url),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['invite']>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

async function runInvite(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.invite(actionEvent(fields));
}

describe('account invite load()', () => {
  it('seeds the invite form from the email query parameter without initial errors', async () => {
    const { load } = await importMod();

    const result = await load(loadEvent('https://portal.example.test/app/account/invite?email=ada%40example.test'));

    expect(result).toMatchObject({ prefillEmail: 'ada@example.test' });
    expect((result as { form: { data: Record<string, string>; errors: Record<string, string[]> } }).form.data).toMatchObject({
      inviteName: '',
      inviteEmail: 'ada@example.test',
      inviteGithub: '',
    });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
  });
});

describe('account invite action', () => {
  it('rejects an invalid email before calling the API', async () => {
    const result = await runInvite({ inviteName: '', inviteEmail: 'not-an-email', inviteGithub: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'inviteEmail')).toBe('Enter a valid email address.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('creates an invite with trimmed form data', async () => {
    mockRequest.mockResolvedValueOnce({ inviteUser: { slug: 'invite-slug' } });

    const result = await runInvite({
      inviteName: '  Ada  ',
      inviteEmail: '  ada@example.test  ',
      inviteGithub: '  ada-dev  ',
    });

    expect(result).toMatchObject({
      invited: true,
      inviteUrl: 'https://portal.example.test/invite/invite-slug',
    });
    expect(superFormFrom(result)?.valid).toBe(true);
    expect(mockRequest).toHaveBeenCalledWith(INVITE_USER_MUTATION, {
      name: 'Ada',
      email: 'ada@example.test',
      githubUsername: 'ada-dev',
      maxActivations: 1,
      expiresInDays: 30,
    });
  });

  it('preserves blank generic invites as null variables', async () => {
    mockRequest.mockResolvedValueOnce({ inviteUser: { slug: 'generic-slug' } });

    await runInvite({ inviteName: '', inviteEmail: '', inviteGithub: '' });

    expect(mockRequest).toHaveBeenCalledWith(INVITE_USER_MUTATION, {
      name: null,
      email: null,
      githubUsername: null,
      maxActivations: 1,
      expiresInDays: 30,
    });
  });

  it('returns GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));

    const result = await runInvite({ inviteName: 'Ada', inviteEmail: '', inviteGithub: '' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toBe('boom');
  });
});
