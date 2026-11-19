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

  it("keeps the server's own words beside the fixed copy (#1080, item 3)", async () => {
    // A different BAD_USER_INPUT that mentions email (a format check, say) would
    // otherwise be shown only as "not supported here", which is a mislabel. The
    // original text rides along, so the reader always sees what the server said.
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'email is not a valid address', extensions: { code: 'BAD_USER_INPUT' } }] },
    });
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: 'ada', email: 'x@example.com' }));
    expect(superFormFrom(result)?.errors?.email).toEqual([
      'Changing your email address is not supported here.',
      'The server said: email is not a valid address',
    ]);
  });

  it('keeps an email-mentioning error with any OTHER code in the banner (#1080, item 2)', async () => {
    // The guard's code half: only BAD_USER_INPUT is a refused change. A
    // FORBIDDEN that happens to mention email is a banner error like any other.
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'not allowed to change email settings', extensions: { code: 'FORBIDDEN' } }] },
    });
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: 'ada', email: 'ada@example.com' }));
    expect(fieldError(result, 'email')).toBeUndefined();
    expect(superFormFrom(result)?.message).toMatchObject({ type: 'error', text: 'not allowed to change email settings' });
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
    expect(result).toMatchObject({ status: 500, data: { deleteError: 'Something went wrong on our side.' } });
    expect(cookies.delete).not.toHaveBeenCalled();
  });
});

describe('account load — the user URN (#998)', () => {
  it('selects urn in ME_QUERY and passes it through to the page', async () => {
    const { ME_QUERY } = await import('$lib/server/queries');
    expect(ME_QUERY).toMatch(/\burn\b/);
    mockRequest.mockResolvedValueOnce({
      me: { id: 'u1', handle: 'ada', urn: 'hrn:user:ada', githubUsername: null, name: 'Ada', avatarUrl: null, email: 'a@x.io', roles: [] },
    });
    const { load } = await import('./+page.server');
    const out = (await load({ locals: { token: 't', user: { id: 'u1' } } } as never)) as { user: { urn?: string | null } };
    expect(out.user.urn).toBe('hrn:user:ada');
  });
});

/**
 * #1117: the account loader awaits `me` and then falls back to `locals.user`.
 * The root layout, loading in parallel, clears `locals.user` when its own `me`
 * fails, so the fallback spread `null` and built a user with no id. The loader
 * must fall back to the user it started with.
 */
describe('account load: the root layout clears locals.user mid-load (#1117)', () => {
  it('falls back to the user it started with, not the cleared value', async () => {
    const locals: { token: string | null; user: unknown } = {
      token: 't',
      user: { id: 'u1', name: 'Ada', email: 'a@x.io', roles: ['user'], githubUsername: null, avatarUrl: null },
    };
    mockRequest.mockImplementationOnce(async () => {
      await Promise.resolve();
      locals.user = null;
      locals.token = null;
      throw new Error('HTTP 500');
    });
    const { load } = await import('./+page.server');
    const out = (await load({ locals } as never)) as { user: { id?: string; name?: string | null; handle: string | null } };
    expect(out.user).toMatchObject({ id: 'u1', name: 'Ada', handle: null });
  });
});

/**
 * portal#1022 links half: the account page links to the server-hosted passkey
 * registration page. The link exists only while the deployment's
 * `passkey-registration` switch is on — a switched-off surface must not show
 * that the feature exists — and its URL is the portal's PUBLIC_SERVER_URL
 * (the same browser-facing base the Microsoft OAuth hand-over uses), not the
 * internal server-to-server LOCAL_SERVER_URL.
 */
// Registered with a default (registration off) because vi.mock hoists this
// factory above the const: every OTHER loader test in this file runs against
// it too, and a bare vi.fn() would answer undefined and throw mid-load.
const capabilities = vi.fn().mockResolvedValue(new Set<string>());
vi.mock('$lib/server/signing-capability', () => ({
  deploymentCapabilities: () => capabilities(),
}));
import { env as publicEnv } from '$env/dynamic/public';

describe('account load: the passkey-registration link (portal#1022)', () => {
  beforeEach(() => {
    capabilities.mockReset().mockResolvedValue(new Set(['passkey-registration']));
    mockRequest.mockReset().mockResolvedValue({ me: null });
    // portal#1985: with a documented local `.env` (both names shipped in
    // `.env.example`), svelte-kit sync types PUBLIC_SERVER_URL as REQUIRED in
    // the generated ambient — and `delete` on a required property is TS2790,
    // so the documented configuration broke `pnpm check` while CI (no `.env`,
    // template-literal index signature) stayed green. Reflect.deleteProperty
    // is the function form of the delete operator, typed against PropertyKey:
    // legal under both ambient shapes, and it still removes the own property,
    // so the "unset" test below sees a genuine absence after the tests above
    // assigned synthetic bases.
    Reflect.deleteProperty(publicEnv, 'PUBLIC_SERVER_URL');
  });

  it('links to the server-hosted registration page while the switch is on', async () => {
    publicEnv.PUBLIC_SERVER_URL = 'https://server.example';
    const { load } = await import('./+page.server');
    const out = (await load({ locals: { token: 't', user: { id: 'u1' } } } as never)) as { passkeysUrl: Promise<string | null> };
    expect(await out.passkeysUrl).toBe('https://server.example/passkeys/register');
  });

  // Dorian's BLIND P3 (#1860): a configured base may legitimately carry a
  // trailing slash (`https://server.example/`); joining blindly produced
  // `https://server.example//passkeys/register`.
  it('joins one path separator even when the configured base ends in a slash', async () => {
    publicEnv.PUBLIC_SERVER_URL = 'https://server.example/';
    const { load } = await import('./+page.server');
    const out = (await load({ locals: { token: 't', user: { id: 'u1' } } } as never)) as { passkeysUrl: Promise<string | null> };
    expect(await out.passkeysUrl).toBe('https://server.example/passkeys/register');
  });

  it('falls back to the local default base when the env var is unset', async () => {
    const { load } = await import('./+page.server');
    const out = (await load({ locals: { token: 't', user: { id: 'u1' } } } as never)) as { passkeysUrl: Promise<string | null> };
    expect(await out.passkeysUrl).toBe('http://localhost:4000/passkeys/register');
  });

  it('renders no link while registration is switched off', async () => {
    capabilities.mockResolvedValue(new Set(['node-signing']));
    const { load } = await import('./+page.server');
    const out = (await load({ locals: { token: 't', user: { id: 'u1' } } } as never)) as { passkeysUrl: Promise<string | null> };
    expect(await out.passkeysUrl).toBeNull();
  });

  it('streams the link instead of blocking the page on a slow capabilities endpoint', async () => {
    // The loader must return before the capability answer resolves: a hung
    // endpoint (up to CAPABILITIES_DEADLINE_MS before failing closed) may
    // never hold the profile hostage. The promise is still derivable later.
    let answer: (caps: Set<string>) => void = () => {};
    capabilities.mockReturnValue(new Promise((resolve) => { answer = resolve; }));
    const { load } = await import('./+page.server');
    let settled: string | null | undefined;
    const out = (await load({ locals: { token: 't', user: { id: 'u1' } } } as never)) as { passkeysUrl: Promise<string | null> };
    out.passkeysUrl.then((url) => { settled = url; });
    expect(settled).toBeUndefined(); // not resolved yet — and the page is already returned
    answer(new Set(['passkey-registration']));
    await expect(out.passkeysUrl).resolves.toBe('http://localhost:4000/passkeys/register');
  });
});
