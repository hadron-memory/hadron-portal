import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCEPT_INVITATION_MUTATION, INVITATION_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
const mockStartBoundMagicLink = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/emailLogin', () => ({
  startBoundMagicLink: mockStartBoundMagicLink,
}));

const fakeInvitation = {
  organization: { name: 'Acme', urn: 'hrn:org:acme' },
  sender: { name: 'Ada', githubUsername: 'ada-dev' },
  memberRole: 'READER',
  name: 'Grace',
  expiresAt: '2099-01-01T00:00:00.000Z',
  activationCount: 0,
  maxActivations: 1,
};

beforeEach(() => {
  mockRequest.mockReset();
  mockStartBoundMagicLink.mockReset();
});

async function importMod() {
  return import('./+page.server');
}

function loadEvent(opts: { token?: string; user?: unknown; authToken?: string } = {}) {
  return {
    params: { token: opts.token ?? 'invite-token' },
    locals: { user: opts.user ?? null, token: opts.authToken },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['load']>[0];
}

function actionEvent(
  fields: Record<string, string>,
  opts: { token?: string; user?: unknown; authToken?: string } = {},
) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { token: opts.token ?? 'invite-token' },
    locals: { user: opts.user ?? null, token: opts.authToken },
    cookies: { set: vi.fn() },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['sendEmail']>[0];
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

async function runSendEmail(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.sendEmail(actionEvent(fields));
}

describe('invite load()', () => {
  it('loads the invitation and seeds the email form without initial errors', async () => {
    mockRequest.mockResolvedValueOnce({ invitation: fakeInvitation });

    const { load } = await importMod();
    const result = await load(loadEvent({ user: { id: 'user-1' }, authToken: 'test-token' }));

    expect(mockRequest).toHaveBeenCalledWith(INVITATION_QUERY, { slug: 'invite-token' });
    expect(result).toMatchObject({ invitation: fakeInvitation, isSignedIn: true, slug: 'invite-token' });
    expect((result as { form: { data: Record<string, string>; errors: Record<string, string[]> } }).form.data).toEqual({
      email: '',
    });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
  });

  it('returns a null invitation when the lookup fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('not found'));

    const { load } = await importMod();
    const result = await load(loadEvent());

    expect(result).toMatchObject({ invitation: null, isSignedIn: false, slug: 'invite-token' });
  });
});

describe('invite sendEmail action', () => {
  it('rejects an empty email before starting the magic-link flow', async () => {
    const result = await runSendEmail({ email: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Email is required.');
    expect(mockStartBoundMagicLink).not.toHaveBeenCalled();
  });

  it('rejects an invalid email before starting the magic-link flow', async () => {
    const result = await runSendEmail({ email: 'not-an-email' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Enter a valid email address.');
    expect(mockStartBoundMagicLink).not.toHaveBeenCalled();
  });

  it('starts a bound magic-link flow with trimmed email and invite redirect', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: true });

    const result = await runSendEmail({ email: '  ada@example.test  ' });

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'success',
      text: 'Check your inbox — we sent you a sign-in link.',
    });
    expect(mockStartBoundMagicLink).toHaveBeenCalledWith(expect.anything(), 'ada@example.test', '/invite/invite-token');
  });

  it('returns magic-link failures as Superforms messages', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: false, status: 502, error: 'Could not reach the server.' });

    const result = await runSendEmail({ email: 'ada@example.test' });

    expect(result).toMatchObject({ status: 502 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Could not reach the server.' });
  });

  it('passes through upstream 4xx and 5xx magic-link failure statuses', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: false, status: 503, error: 'Temporarily unavailable.' });

    const result = await runSendEmail({ email: 'ada@example.test' });

    expect(result).toMatchObject({ status: 503 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Temporarily unavailable.' });
  });

  it('falls back to 500 for non-error magic-link failure statuses', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: false, status: 302, error: 'Unexpected redirect.' });

    const result = await runSendEmail({ email: 'ada@example.test' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Unexpected redirect.' });
  });
});

describe('invite accept action', () => {
  it('requires a signed-in user before accepting the invitation', async () => {
    const { actions } = await importMod();
    const result = await actions.accept(actionEvent({}));

    expect(result).toMatchObject({ status: 401 });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('accepts the invitation for a signed-in user', async () => {
    mockRequest.mockResolvedValueOnce({ acceptInvitation: true });

    const { actions } = await importMod();
    await expect(
      actions.accept(actionEvent({}, { user: { id: 'user-1' }, authToken: 'test-token' })),
    ).rejects.toMatchObject({ status: 303, location: '/app/dashboard' });
    expect(mockRequest).toHaveBeenCalledWith(ACCEPT_INVITATION_MUTATION, { slug: 'invite-token' });
  });
});
