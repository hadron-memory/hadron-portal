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

// ── Tests for the `update` action — visibility handling (spec 034) ───────

/** RequestEvent-shaped object carrying form data for the metadata update. */
function updateEv(form: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  return {
    params: { id: 'mem-id-abc' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importActions>>['update']>[0];
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

function successMessage(result: unknown): unknown {
  return superFormFrom(result)?.message;
}

describe('memory-detail `update` action — visibility (spec 034)', () => {
  it('passes visibility through when the control is present (knowledge memory)', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.update(updateEv({ displayName: 'Kb', visibility: 'ORGANIZATION' }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.visibility).toBe('ORGANIZATION');
  });

  it('omits visibility when the control is absent (owner-only/group/system) so the stored value is untouched', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.update(updateEv({ displayName: 'Private mem' }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.visibility).toBeUndefined();
  });

  // The settings form prefills the URN slug from the canonical `hrn:memory:…`
  // urn, which doesn't round-trip through the server's legacy URN composition.
  // Resubmitting it unchanged (e.g. a visibility-only edit) used to fail
  // server-side FR-020 validation — so the action must omit `urn` unless the
  // slug actually changed.
  it('omits urn when the slug is unchanged (visibility-only edit)', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.update(updateEv({
      displayName: 'Experiments',
      visibility: 'PUBLIC',
      urnSlug: 'memory:hadronmemory.com::experiments',
      originalUrnSlug: 'memory:hadronmemory.com::experiments',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.urn).toBeUndefined();
    expect(vars.visibility).toBe('PUBLIC');
  });

  it('forwards urn only when the user actually edited the slug', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.update(updateEv({
      displayName: 'Experiments',
      urnSlug: 'renamed',
      originalUrnSlug: 'experiments',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.urn).toBe('renamed');
  });

  // A user may paste a full/prefixed URN into the slug field; the action must
  // cut the bare slug out of it and send only that (never a prefixed value,
  // which the server's bare-slug guard rejects).
  it.each([
    ['hrn:memory:hadronmemory.com::renamed', 'canonical hrn scheme'],
    ['urn:memory:hadronmemory.com::renamed', 'legacy urn scheme'],
    ['memory:hadronmemory.com::renamed', 'type marker, no scheme'],
    ['hadronmemory.com::renamed', 'bare org::slug path'],
    ['hrn:memory:hadronmemory.com::renamed::priv', 'trailing role marker'],
  ])('extracts the bare slug from a pasted full URN (%s — %s)', async (pasted) => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.update(updateEv({
      displayName: 'Experiments',
      urnSlug: pasted,
      originalUrnSlug: 'experiments',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.urn).toBe('renamed');
  });

  // Clearing the field (or pasting something with no extractable slug) must be
  // a hard error, not a silent no-op that keeps the old URN.
  it.each([
    ['', 'empty string'],
    ['   ', 'whitespace only'],
    ['memory:', 'prefix with no slug'],
  ])('rejects a submitted-but-empty slug with a 400 (%s — %s)', async (cleared) => {
    const actions = await importActions();

    const result = await actions.update(updateEv({
      displayName: 'Experiments',
      urnSlug: cleared,
      originalUrnSlug: 'experiments',
    }));

    expect((result as { status: number }).status).toBe(400);
    expect(fieldError(result, 'urnSlug')).toContain('cannot be empty');
    // Rejected before any network call.
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('treats a pasted full URN whose slug is unchanged as a no-op (omits urn)', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    // Field holds the full canonical URN; the original was the bare slug. Same
    // slug → no recomposition.
    await actions.update(updateEv({
      displayName: 'Experiments',
      urnSlug: 'hrn:memory:hadronmemory.com::experiments',
      originalUrnSlug: 'experiments',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.urn).toBeUndefined();
  });

  it('rejects an invalid memory slug before calling the API', async () => {
    const actions = await importActions();

    const result = await actions.update(updateEv({
      displayName: 'Experiments',
      urnSlug: 'Bad Slug',
      originalUrnSlug: 'experiments',
    }));

    expect((result as { status: number }).status).toBe(400);
    expect(fieldError(result, 'urnSlug')).toContain('lowercase');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// ── Tests for the `update` action — URN-collision pre-check ──────────────

describe('memory-detail `update` action — URN collision pre-check', () => {
  it('blocks the save with a 409 when the composed URN already belongs to another memory', async () => {
    // First request is resolveUrn — return a hit on a DIFFERENT memory id.
    mockRequest.mockResolvedValueOnce({ resolveUrn: { id: 'some-other-memory' } });
    const actions = await importActions();

    const result = await actions.update(updateEv({
      displayName: 'Experiments',
      urnSlug: 'taken',
      originalUrnSlug: 'experiments',
      currentUrn: 'hrn:memory:hadronmemory.com::experiments',
    }));

    expect((result as { status: number }).status).toBe(409);
    expect(fieldError(result, 'urnSlug')).toContain('hrn:memory:hadronmemory.com::taken');
    // The collision short-circuits BEFORE updateMemory — only resolveUrn ran,
    // and it was asked about the composed candidate URN.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toEqual({ urn: 'hrn:memory:hadronmemory.com::taken' });
  });

  it('preserves a trailing role marker when composing the candidate URN', async () => {
    // currentUrn carries a `::system` role marker — the candidate must keep it
    // (replace only the slug segment), or the pre-check queries the wrong URN.
    mockRequest.mockResolvedValueOnce({ resolveUrn: { id: 'some-other-memory' } });
    const actions = await importActions();

    const result = (await actions.update(updateEv({
      urnSlug: 'taken',
      originalUrnSlug: 'experiments',
      currentUrn: 'hrn:memory:hadronmemory.com::experiments::system',
    }))) as { status: number; data: { error: string } } | undefined;

    expect(result!.status).toBe(409);
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toEqual({ urn: 'hrn:memory:hadronmemory.com::taken::system' });
  });

  it('proceeds with the save when the composed URN is free (resolveUrn → null)', async () => {
    mockRequest
      .mockResolvedValueOnce({ resolveUrn: null }) // free
      .mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    const result = await actions.update(updateEv({
      displayName: 'Experiments',
      urnSlug: 'fresh',
      originalUrnSlug: 'experiments',
      currentUrn: 'hrn:memory:hadronmemory.com::experiments',
    }));

    expect(successMessage(result)).toBe('Changes saved.');
    expect(superFormFrom(result)?.valid).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
    const [, updateVars] = mockRequest.mock.calls[1]! as [unknown, Record<string, unknown>];
    expect(updateVars.urn).toBe('fresh');
  });

  it('does not treat the memory resolving to itself as a collision', async () => {
    mockRequest
      .mockResolvedValueOnce({ resolveUrn: { id: 'mem-id-abc' } }) // same id as params.id
      .mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    const result = await actions.update(updateEv({
      urnSlug: 'renamed',
      originalUrnSlug: 'experiments',
      currentUrn: 'hrn:memory:hadronmemory.com::experiments',
    }));

    expect(successMessage(result)).toBe('Changes saved.');
    expect(superFormFrom(result)?.valid).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('saves anyway when the pre-check itself errors (best-effort, server backstops)', async () => {
    mockRequest
      .mockRejectedValueOnce(new Error('resolveUrn transport error'))
      .mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    const result = await actions.update(updateEv({
      urnSlug: 'renamed',
      originalUrnSlug: 'experiments',
      currentUrn: 'hrn:memory:hadronmemory.com::experiments',
    }));

    expect(successMessage(result)).toBe('Changes saved.');
    expect(superFormFrom(result)?.valid).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('skips the pre-check when the org is also changing (candidate head would differ)', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.update(updateEv({
      urnSlug: 'renamed',
      originalUrnSlug: 'experiments',
      currentUrn: 'hrn:memory:hadronmemory.com::experiments',
      organizationId: 'new-org',
      currentOrganizationId: 'old-org',
    }));

    // Only updateMemory ran — no resolveUrn pre-check.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.urn).toBe('renamed');
    expect(vars.organizationId).toBe('new-org');
  });

  it('skips the pre-check when the slug is unchanged', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.update(updateEv({
      urnSlug: 'experiments',
      originalUrnSlug: 'experiments',
      currentUrn: 'hrn:memory:hadronmemory.com::experiments',
    }));

    // No slug change → no resolveUrn call, just the metadata update.
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});
