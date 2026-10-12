import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importActions>>['update']>>[0];
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

function deleteActionEv(opts: {
  fields?: Record<string, string>;
  locals?: Record<string, unknown>;
} = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(opts.fields ?? {})) fd.set(k, v);
  const cookies = { delete: vi.fn() };
  const ev = {
    locals: opts.locals ?? { token: 'test-token', user: { id: 'u1' } },
    request: { formData: async () => fd },
    cookies,
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importActions>>['deleteAccount']>>[0];
  return { ev, cookies };
}

describe('account update action', () => {
  it('rejects an invalid handle before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: 'Ada Lovelace', email: 'ada@example.com' }));
    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'handle')).toEqual(expect.stringContaining('Handle'));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an invalid email before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: 'ada', email: 'not-an-email' }));
    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Enter a valid email address.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('allows clearing the handle', async () => {
    mockRequest.mockResolvedValueOnce({ updateMyProfile: { id: 'u1' } });
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: '', email: 'ada@example.com' }));
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Profile updated.' });
    expect(superFormFrom(result)?.valid).toBe(true);
    expect(mockRequest).toHaveBeenCalledOnce();
  });
});

describe('account update action — a refused email change (hadron-server#1801)', () => {
  it('shows the refusal as an error on the email field, not a banner, and writes nothing else', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'email cannot be changed here', extensions: { code: 'BAD_USER_INPUT' } }] },
    });
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: 'ada', email: 'new@example.com' }));
    expect(fieldError(result, 'email')).toBe('Changing your email address is not supported here.');
    expect(superFormFrom(result)?.message).toBeUndefined();
    expect(result).toMatchObject({ status: 400 });
  });

  it('keeps other BAD_USER_INPUT refusals as the banner', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'handle is taken', extensions: { code: 'BAD_USER_INPUT' } }] },
    });
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: 'ada', email: 'ada@example.com' }));
    expect(fieldError(result, 'email')).toBeUndefined();
    expect(superFormFrom(result)?.message).toMatchObject({ type: 'error', text: 'handle is taken' });
  });
});

describe('account deleteAccount action', () => {
  it('redirects an unauthenticated caller to signin without calling the API', async () => {
    const actions = await importActions();
    const { ev, cookies } = deleteActionEv({
      fields: { confirm: 'DELETE' },
      locals: { token: null, user: null },
    });
    await expect(actions.deleteAccount(ev)).rejects.toMatchObject({
      status: 303,
      location: '/signin?redirect=/app/account',
    });
    expect(mockRequest).not.toHaveBeenCalled();
    expect(cookies.delete).not.toHaveBeenCalled();
  });

  it('rejects a missing/wrong confirmation before calling the API', async () => {
    const actions = await importActions();
    const cases: Record<string, string>[] = [{}, { confirm: 'delete' }, { confirm: 'nope' }];
    for (const fields of cases) {
      const { ev } = deleteActionEv({ fields });
      const result = await actions.deleteAccount(ev);
      expect(result).toMatchObject({ status: 400, data: { deleteError: 'Type DELETE to confirm.' } });
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('deletes the account, clears the session cookie, and redirects to /goodbye', async () => {
    mockRequest.mockResolvedValueOnce({ deleteUser: true });
    const actions = await importActions();
    const { ev, cookies } = deleteActionEv({ fields: { confirm: 'DELETE' } });
    await expect(actions.deleteAccount(ev)).rejects.toMatchObject({ status: 303, location: '/goodbye' });
    expect(mockRequest).toHaveBeenCalledOnce();
    expect(cookies.delete).toHaveBeenCalledWith('hadron_token', { path: '/' });
  });

  it('surfaces the blocking orgs on a SOLE_ORG_OWNER failure and keeps the session', async () => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{
          message: 'You are the sole owner of organizations with other members',
          extensions: {
            code: 'SOLE_ORG_OWNER',
            orgs: [
              { id: 'org-1', name: 'Acme' },
              { id: 'org-2', name: 'Mentor Co' },
            ],
          },
        }],
      },
    });
    const actions = await importActions();
    const { ev, cookies } = deleteActionEv({ fields: { confirm: 'DELETE' } });
    const result = await actions.deleteAccount(ev);
    expect(result).toMatchObject({ status: 409 });
    const data = (result as { data: { deleteError: string; blockingOrgs: { id: string; name: string }[] } }).data;
    expect(data.deleteError).toContain('sole owner');
    expect(data.blockingOrgs).toEqual([
      { id: 'org-1', name: 'Acme' },
      { id: 'org-2', name: 'Mentor Co' },
    ]);
    expect(cookies.delete).not.toHaveBeenCalled();
  });

  it('finds the blocking-org list under a nonstandard extensions key', async () => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{
          message: 'sole owner',
          extensions: {
            code: 'SOLE_ORG_OWNER',
            soleOwnedOrganizations: [{ id: 'org-9', name: 'Client Co' }],
          },
        }],
      },
    });
    const actions = await importActions();
    const { ev } = deleteActionEv({ fields: { confirm: 'DELETE' } });
    const result = await actions.deleteAccount(ev);
    expect(result).toMatchObject({ status: 409 });
    expect((result as { data: { blockingOrgs: unknown } }).data.blockingOrgs).toEqual([
      { id: 'org-9', name: 'Client Co' },
    ]);
  });

  it('returns a standard error on other GraphQL failures and keeps the session', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] },
    });
    const actions = await importActions();
    const { ev, cookies } = deleteActionEv({ fields: { confirm: 'DELETE' } });
    const result = await actions.deleteAccount(ev);
    expect(result).toMatchObject({ status: 500, data: { deleteError: 'boom' } });
    expect(cookies.delete).not.toHaveBeenCalled();
  });
});
