/**
 * Spec 025-oauth-for-mcp US2 / T048 — /app/account/api-keys server tests.
 *
 * Pattern matches `src/routes/app/agents/page.server.test.ts`: import the
 * `load` + `actions` from +page.server, exercise with mocked `locals` +
 * stubbed GraphQL client, assert the returned shape (no real network).
 *
 * The GraphQL client (`gqlClient` from `$lib/server/api`) is mocked at
 * module level via `vi.mock` so the test doesn't need a running
 * hadron-server. The mock's `.request()` is spied per-test for return-
 * value control + call-signature assertion (mutation variables, etc.).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the GraphQL client BEFORE importing the module under test.
// Vitest hoists vi.mock to the top of the file; the factory runs lazily.
const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: vi.fn(() => ({ request: mockRequest })),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importMod() {
  return await import('./+page.server');
}

function loadEvent(token: string | null) {
  return { locals: { token } } as unknown as Parameters<
    Awaited<ReturnType<typeof importMod>>['load']
  >[0];
}

function actionEvent(token: string | null, formData: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(formData)) fd.set(k, v);
  return {
    locals: { token },
    request: { formData: async () => fd },
  } as unknown as Parameters<
    Awaited<ReturnType<typeof importMod>>['actions']['create']
  >[0];
}

// ── load() ──────────────────────────────────────────────────────────

describe('load /app/account/api-keys', () => {
  it('returns { keys } from the GraphQL response', async () => {
    const sampleKeys = [
      {
        id: 'uak_1',
        keyPreview: 'abcd',
        label: 'macbook',
        createdAt: '2026-05-20T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
        issuedVia: 'portal',
      },
    ];
    mockRequest.mockResolvedValueOnce({ myUserApiKeys: sampleKeys });
    const { load } = await importMod();
    const result = await load(loadEvent('jwt-token'));
    expect(result).toEqual({ keys: sampleKeys });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('returns empty list (no GraphQL call) when locals.token is missing', async () => {
    const { load } = await importMod();
    const result = await load(loadEvent(null));
    expect(result).toEqual({ keys: [] });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('surfaces a friendly loadError on GraphQL failure (does not throw)', async () => {
    mockRequest.mockRejectedValueOnce(new Error('upstream down'));
    const { load } = await importMod();
    const result = await load(loadEvent('jwt-token'));
    expect((result as { keys: unknown[] }).keys).toEqual([]);
    expect((result as { loadError: string }).loadError).toMatch(/upstream down/);
  });

  it('extracts the first GraphQL errors[0].message when present', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'UNAUTHENTICATED' }] },
    });
    const { load } = await importMod();
    const result = await load(loadEvent('jwt-token'));
    expect((result as { loadError: string }).loadError).toBe('UNAUTHENTICATED');
  });
});

// ── actions.create ──────────────────────────────────────────────────

describe('actions.create (mint)', () => {
  it('returns { success, rawKey, userApiKey } on happy path', async () => {
    const created = {
      userApiKey: {
        id: 'uak_new',
        keyPreview: 'wxyz',
        label: 'cli',
        createdAt: '2026-05-20T00:00:00Z',
        lastUsedAt: null,
        revokedAt: null,
        issuedVia: 'portal',
      },
      rawKey: 'hdr_user_' + 'a'.repeat(64),
    };
    mockRequest.mockResolvedValueOnce({ createUserApiKey: created });

    const { actions } = await importMod();
    const result = await actions.create(actionEvent('jwt-token', { label: 'cli' }));
    expect(result).toMatchObject({
      success: 'mint',
      rawKey: created.rawKey,
      userApiKey: created.userApiKey,
    });
    // The mutation must carry the trimmed label as a String, not the
    // raw form value.
    expect(mockRequest).toHaveBeenCalledWith(expect.anything(), { label: 'cli' });
  });

  it('passes label: null when the form value is empty / whitespace', async () => {
    mockRequest.mockResolvedValueOnce({
      createUserApiKey: {
        userApiKey: {
          id: 'uak_x',
          keyPreview: 'xxxx',
          label: null,
          createdAt: '2026-05-20T00:00:00Z',
          lastUsedAt: null,
          revokedAt: null,
          issuedVia: 'portal',
        },
        rawKey: 'hdr_user_' + 'b'.repeat(64),
      },
    });
    const { actions } = await importMod();
    await actions.create(actionEvent('jwt-token', { label: '   ' }));
    expect(mockRequest).toHaveBeenCalledWith(expect.anything(), { label: null });
  });

  it('returns 400 fail when label exceeds 200 chars (server cap mirrored client-side)', async () => {
    const tooLong = 'x'.repeat(201);
    const { actions } = await importMod();
    const result = (await actions.create(
      actionEvent('jwt-token', { label: tooLong }),
    )) as { status: number; data: { error: string } };
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/200 characters/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns 401 fail when locals.token is missing', async () => {
    const { actions } = await importMod();
    const result = (await actions.create(actionEvent(null, { label: 'x' }))) as {
      status: number;
      data: { error: string };
    };
    expect(result.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns 500 fail + extracted GraphQL message on upstream failure', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'rate limit exceeded' }] },
    });
    const { actions } = await importMod();
    const result = (await actions.create(
      actionEvent('jwt-token', { label: 'cli' }),
    )) as { status: number; data: { error: string } };
    expect(result.status).toBe(500);
    expect(result.data.error).toBe('rate limit exceeded');
  });
});

// ── actions.revoke ──────────────────────────────────────────────────

describe('actions.revoke', () => {
  it('returns { success: "revoke" } on happy path', async () => {
    mockRequest.mockResolvedValueOnce({
      revokeUserApiKey: {
        id: 'uak_1',
        keyPreview: 'abcd',
        label: 'x',
        createdAt: '2026-05-20T00:00:00Z',
        lastUsedAt: null,
        revokedAt: '2026-05-20T00:01:00Z',
        issuedVia: 'portal',
      },
    });
    const { actions } = await importMod();
    const result = await actions.revoke(actionEvent('jwt-token', { id: 'uak_1' }));
    expect(result).toEqual({ success: 'revoke' });
    expect(mockRequest).toHaveBeenCalledWith(expect.anything(), { id: 'uak_1' });
  });

  it('returns 400 fail when id is missing', async () => {
    const { actions } = await importMod();
    const result = (await actions.revoke(actionEvent('jwt-token', {}))) as {
      status: number;
      data: { error: string };
    };
    expect(result.status).toBe(400);
    expect(result.data.error).toMatch(/Missing key id/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns 401 fail when locals.token is missing', async () => {
    const { actions } = await importMod();
    const result = (await actions.revoke(actionEvent(null, { id: 'uak_1' }))) as {
      status: number;
    };
    expect(result.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns 500 fail with extracted error on upstream NOT_FOUND (cross-user revoke)', async () => {
    // The server collapses cross-user revoke to NOT_FOUND (id-enumeration
    // mitigation, PR #145). The portal surfaces it as a 500 with the
    // extracted GraphQL message — same shape as any other upstream error,
    // doesn't carve out a separate "forbidden" branch.
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'NOT_FOUND' }] },
    });
    const { actions } = await importMod();
    const result = (await actions.revoke(
      actionEvent('jwt-token', { id: 'uak_belongs_to_other_user' }),
    )) as { status: number; data: { error: string } };
    expect(result.status).toBe(500);
    expect(result.data.error).toBe('NOT_FOUND');
  });
});
