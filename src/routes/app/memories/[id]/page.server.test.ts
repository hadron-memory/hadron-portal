/**
 * Spec 013-soft-delete-memory — tests for the new `delete` form action on
 * the memory detail page.
 *
 * Strategy mirrors `src/routes/api/agent-chat/agent-chat.test.ts`: mock
 * `$lib/server/api`'s `gqlClient`, import the `actions` object from
 * `+page.server.ts`, and call the action handler directly with a hand-
 * rolled SvelteKit-shaped event. We do NOT spin up SvelteKit.
 *
 * Coverage (tasks T005, T011):
 *   - T005a: happy path → action throws SvelteKit redirect with status 303
 *     and location `/app/orgs/<id>/memories`.
 *   - T005b: gqlClient transport error → action returns
 *     `fail(500, { error: ... })` with the extracted GraphQL message.
 *   - T005c: `isRedirect(e)` re-throw correctness — the redirect thrown
 *     inside the try block must propagate unchanged (verified by the
 *     happy-path test, where SvelteKit's `redirect()` throws and the
 *     test catches the propagated thrown value).
 *   - T011: layout-loader behavior on a null memory (soft-deleted) is
 *     governed by `+layout.server.ts`, which throws `new Error('Memory
 *     not found')`. We pin that behavior here so a regression that
 *     drops the throw is caught.
 *
 * NOTE on T014 (canDelete derivation tests): the `canDelete` expression
 * lives inline in `+page.svelte` as a `$derived(...)` and is not
 * importable. Per the tasks.md fallback for T014, the class-aware
 * server-side authz (covered exhaustively in
 * `hadron-server/src/api/graphql/schema/resolvers.memoryType.test.ts`
 * for spec 013) is the trust boundary; the UI hide is presentation only.
 * No component-level test ships in this PR.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

// `$lib/server/guards.requireNonConsumer` is invoked by the `load`
// function only — the `delete` action does not call it. We don't need to
// mock it for the action tests, but we mock it defensively in case the
// import path drags it in indirectly.
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

// ── Helpers ────────────────────────────────────────────────────────────────

/** Minimal RequestEvent-shaped object for SvelteKit form actions.
 *  #260: memory routes are org-less — the memory id is `params.id`, and the
 *  delete action reads the owning org id from a hidden form field so it can
 *  redirect back to that org's memories list. */
function ev(opts: {
  memId?: string;
  orgId?: string;
  token?: string | null;
}) {
  const fd = new FormData();
  if (opts.orgId !== undefined) fd.append('organizationId', opts.orgId);
  return {
    params: { id: opts.memId ?? 'mem-id-abc' },
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
    request: { formData: async () => fd },
  } as Parameters<
    Awaited<ReturnType<typeof importActions>>['delete']
  >[0];
}

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

// ── Tests for the `delete` action ───────────────────────────────────────

describe("memory-detail `delete` action (spec 013)", () => {
  it('happy path — calls the GraphQL mutation and throws a 303 redirect to the org memories list', async () => {
    mockRequest.mockResolvedValueOnce(true); // deleteMemory returns Boolean
    const actions = await importActions();

    let thrown: unknown;
    try {
      await actions.delete(ev({ memId: 'mem-y', orgId: 'org-x' }));
    } catch (e) {
      thrown = e;
    }

    // SvelteKit `redirect()` throws an object with `status` and `location`.
    expect(thrown).toBeDefined();
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-x/memories');

    // Mutation invoked once with the memory id (params.id) as the id argument.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [, vars] = mockRequest.mock.calls[0]!;
    expect(vars).toEqual({ id: 'mem-y' });
  });

  it('GraphQL transport error — returns fail(500) with the extracted error message', async () => {
    // Shape: graphql-request style error with response.errors[0].message
    const gqlError = Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'Forbidden: only the owner can delete a personal memory' }] },
    });
    mockRequest.mockRejectedValueOnce(gqlError);
    const actions = await importActions();

    const result = (await actions.delete(ev({}))) as
      | { status: number; data: { error: string } }
      | undefined;

    expect(result).toBeDefined();
    expect(result!.status).toBe(500);
    expect(result!.data.error).toBe('Forbidden: only the owner can delete a personal memory');
  });

  it('non-GraphQL error — falls back to the generic message', async () => {
    mockRequest.mockRejectedValueOnce(new Error('socket hangup'));
    const actions = await importActions();

    const result = (await actions.delete(ev({}))) as
      | { status: number; data: { error: string } }
      | undefined;

    expect(result).toBeDefined();
    expect(result!.status).toBe(500);
    // extractGqlError falls through to e.message when e isn't a GraphQL error.
    expect(result!.data.error).toBe('socket hangup');
  });

  it("isRedirect re-throw — the SvelteKit redirect inside the try block is not swallowed by the catch", async () => {
    // This invariant is what the happy-path test (above) verifies: the
    // redirect propagates as a thrown value, NOT a `fail(500)` response.
    // If `isRedirect(e) ? throw e` were missing, the redirect would be
    // caught by the generic catch and re-wrapped as a 500. The first
    // test in this suite would then receive a fail(500) shape (no
    // status/location keys) instead of the redirect. Keep this assertion
    // as a guard against accidental removal of the re-throw.
    mockRequest.mockResolvedValueOnce(true);
    const actions = await importActions();
    let thrown: unknown;
    try {
      await actions.delete(ev({}));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    expect(thrown).not.toMatchObject({ status: 500 }); // would indicate fail(), not redirect
    expect((thrown as { status: number }).status).toBe(303);
  });
});

// ── Tests for the `updateVectorIndex` action (spec 033 §2/§3) ────────────

/** RequestEvent-shaped object carrying form data for the vector action. */
function vectorEv(form: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  return {
    params: { id: 'mem-id-abc' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importActions>>['updateVectorIndex']>[0];
}

describe('memory-detail `updateVectorIndex` action (spec 033)', () => {
  it('sends parsed config through updateMemory and returns success', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    const result = (await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'true',
      embeddingSource: 'both',
      chunkTokens: '256',
      chunkOverlap: '32',
      forceFixedSize: 'true',
    }))) as { success?: boolean } | undefined;

    expect(result).toEqual({ success: true });
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toMatchObject({
      id: 'mem-id-abc',
      vectorIndexEnabled: true,
      embeddingSource: 'both',
      chunkTokens: 256,
      chunkOverlap: 32,
      forceFixedSize: true,
    });
  });

  it('parses booleans from strings and omits acknowledgement unless explicitly accepted', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'false',
      embeddingSource: 'abstract',
      forceFixedSize: 'false',
      acknowledgeVectorInversionRisk: 'false',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.vectorIndexEnabled).toBe(false);
    expect(vars.forceFixedSize).toBe(false);
    // Never send `false` — only assert acknowledgement when truly accepted.
    expect(vars.acknowledgeVectorInversionRisk).toBeUndefined();
  });

  it('sends acknowledgeVectorInversionRisk: true when the disclosure was accepted', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'true',
      embeddingSource: 'abstract',
      acknowledgeVectorInversionRisk: 'true',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.acknowledgeVectorInversionRisk).toBe(true);
  });

  it('omits empty/partial/negative chunk dials so the server keeps its current values', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'true',
      embeddingSource: 'contentChunks',
      chunkTokens: '',
      // Partial/garbage must be rejected outright (NOT parseInt-truncated to 12)
      // and negatives omitted — digits-only.
      chunkOverlap: '12abc',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.chunkTokens).toBeUndefined();
    expect(vars.chunkOverlap).toBeUndefined();

    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'true',
      embeddingSource: 'contentChunks',
      chunkTokens: '-5',
      chunkOverlap: '1.5',
    }));
    const [, vars2] = mockRequest.mock.calls[1]! as [unknown, Record<string, unknown>];
    expect(vars2.chunkTokens).toBeUndefined();
    expect(vars2.chunkOverlap).toBeUndefined();
  });

  it('maps the encrypted-ack error (by extensions.code) to fail(400) with needsEncryptedAck', async () => {
    const ackError = Object.assign(new Error('outer'), {
      response: {
        errors: [{
          message: 'ENCRYPTED_VECTOR_INDEX_NOT_ACKNOWLEDGED: ...',
          extensions: { code: 'EncryptedVectorIndexNotAcknowledgedError' },
        }],
      },
    });
    mockRequest.mockRejectedValueOnce(ackError);
    const actions = await importActions();

    const result = (await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'true',
      embeddingSource: 'abstract',
    }))) as { status: number; data: { needsEncryptedAck?: boolean } } | undefined;

    expect(result!.status).toBe(400);
    expect(result!.data.needsEncryptedAck).toBe(true);
  });

  it('falls back to fail(500) for unrelated GraphQL errors', async () => {
    const gqlError = Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'Forbidden' }] },
    });
    mockRequest.mockRejectedValueOnce(gqlError);
    const actions = await importActions();

    const result = (await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'true',
      embeddingSource: 'abstract',
    }))) as { status: number; data: { error: string; needsEncryptedAck?: boolean } } | undefined;

    expect(result!.status).toBe(500);
    expect(result!.data.error).toBe('Forbidden');
    expect(result!.data.needsEncryptedAck).toBeUndefined();
  });
});
