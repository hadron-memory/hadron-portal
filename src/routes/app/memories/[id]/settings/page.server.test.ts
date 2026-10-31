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
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';

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

// #652 — the loader fetches the org list through this; stubbed so the owner
// tests below exercise only the owner read.
const mockFetchAllItems = vi.fn();
vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: (...args: unknown[]) => mockFetchAllItems(...args),
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

  it('encodes the submitted org id before building the redirect path', async () => {
    mockRequest.mockResolvedValueOnce(true);
    const actions = await importActions();

    let thrown: unknown;
    try {
      await actions.delete(ev({ memId: 'mem-y', orgId: 'org/with space' }));
    } catch (e) {
      thrown = e;
    }

    expect(thrown).toBeDefined();
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org%2Fwith%20space/memories');
  });

  it('uncoded GraphQL error returns fail(500) with generic copy', async () => {
    // Shape: graphql-request style error with response.errors[0].message
    const gqlError = Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'Forbidden: only the owner can delete a personal memory' }] },
    });
    mockRequest.mockRejectedValueOnce(gqlError);
    const actions = await importActions();

    const result = (await actions.delete(ev({}))) as
      | { status: number; data: { form?: { message?: App.Superforms.Message } } }
      | undefined;

    expect(result).toBeDefined();
    expect(result!.status).toBe(500);
    expect(result!.data.form?.message).toEqual({
      type: 'error',
      text: 'Something went wrong on our side.',
    });
  });

  it('non-GraphQL error — falls back to the generic message', async () => {
    mockRequest.mockRejectedValueOnce(new Error('socket hangup'));
    const actions = await importActions();

    const result = (await actions.delete(ev({}))) as
      | { status: number; data: { form?: { message?: App.Superforms.Message } } }
      | undefined;

    expect(result).toBeDefined();
    expect(result!.status).toBe(500);
    // extractGqlError falls through to e.message when e isn't a GraphQL error.
    expect(result!.data.form?.message).toEqual({ type: 'error', text: 'socket hangup' });
  });

  it('rejects a delete submission with the wrong form discriminator', async () => {
    const actions = await importActions();

    const result = await actions.delete({
      ...ev({ orgId: 'org-x' }),
      request: {
        formData: async () => {
          const fd = new FormData();
          fd.append('_kind', 'updateVectorIndex');
          fd.append('organizationId', 'org-x');
          return fd;
        },
      },
    } as Parameters<Awaited<ReturnType<typeof importActions>>['delete']>[0]);

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
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

it('#1163 returns canonical persisted settings rather than the submitted defaults', async () => {
  mockRequest.mockResolvedValueOnce({updateMemory: {id: 'mem-id-abc', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 512, chunkOverlap: 64, forceFixedSize: true}});
  const actions = await importActions();
  const response = await actions.updateVectorIndex(vectorEv({vectorIndexEnabled: 'true', embeddingSource: 'abstract', chunkTokens: '', chunkOverlap: '', forceFixedSize: 'false'}));
  expect(superFormFrom(response)?.data).toMatchObject({vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: '512', chunkOverlap: '64', forceFixedSize: true, acknowledgeVectorInversionRisk: false});
});

describe('memory-detail `updateVectorIndex` action (spec 033)', () => {
  it('sends parsed config through updateMemory and returns success', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    const result = await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'true',
      embeddingSource: 'both',
      chunkTokens: '256',
      chunkOverlap: '32',
      forceFixedSize: 'true',
    }));

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Changes saved.' });
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toMatchObject({
      id: 'mem-id-abc',
      vectorIndexEnabled: true,
      embeddingSource: 'both',
      chunkTokens: 256,
      chunkOverlap: 32,
      forceFixedSize: true,
    });
    // #1255: the action stamps the load's memory-bound id, so its result
    // finds THIS form's store and nothing else's.
    expect((superFormFrom(result) as { id?: string })?.id).toBe('updateVectorIndex:mem-id-abc');
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

  it('rejects unexpected boolean strings before calling the API', async () => {
    const actions = await importActions();

    const result = await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'on',
      embeddingSource: 'abstract',
      forceFixedSize: 'false',
    }));

    expect((result as { status: number }).status).toBe(400);
    expect(fieldError(result, 'vectorIndexEnabled')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('omits embeddingSource when the field was not submitted so disabling does not reset it', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    await actions.updateVectorIndex(vectorEv({
      vectorIndexEnabled: 'false',
      forceFixedSize: 'false',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.vectorIndexEnabled).toBe(false);
    expect(vars.embeddingSource).toBeUndefined();
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
    }))) as { status: number; data: { form?: { message?: App.Superforms.Message }; needsEncryptedAck?: boolean } } | undefined;

    expect(result!.status).toBe(400);
    expect(result!.data.needsEncryptedAck).toBe(true);
    expect(result!.data.form?.message).toEqual({
      type: 'error',
      text: 'This encrypted memory requires acknowledging the vector-inversion disclosure before enabling the index.',
    });
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
    }))) as { status: number; data: { form?: { message?: App.Superforms.Message }; needsEncryptedAck?: boolean } } | undefined;

    expect(result!.status).toBe(500);
    expect(result!.data.form?.message).toEqual({ type: 'error', text: 'Something went wrong on our side.' });
    expect(result!.data.needsEncryptedAck).toBeUndefined();
  });

  it('rejects a vector submission with the wrong form discriminator before calling the API', async () => {
    const actions = await importActions();

    const result = await actions.updateVectorIndex(vectorEv({
      _kind: 'deleteMemory',
      vectorIndexEnabled: 'true',
      embeddingSource: 'abstract',
    }));

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
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
    data?: { form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean; data?: Record<string, unknown> } };
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean; data?: Record<string, unknown> };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean; data?: Record<string, unknown> };
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

    expect(successMessage(result)).toEqual({ type: 'success', text: 'Changes saved.' });
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

    expect(successMessage(result)).toEqual({ type: 'success', text: 'Changes saved.' });
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

    expect(successMessage(result)).toEqual({ type: 'success', text: 'Changes saved.' });
    expect(superFormFrom(result)?.valid).toBe(true);
    expect(mockRequest).toHaveBeenCalledTimes(2);
  });

  it('refuses the old organization field so updateMemory cannot bypass transfer preview', async () => {
    const actions = await importActions();

    const result = await actions.update(updateEv({
      urnSlug: 'renamed',
      originalUrnSlug: 'experiments',
      currentUrn: 'hrn:memory:hadronmemory.com::experiments',
      organizationId: 'new-org',
      currentOrganizationId: 'old-org',
    }));

    expect((result as { status: number }).status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
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

// ── Tests for the `updateSchema` action (#588 / server #725) ─────────────

/** RequestEvent-shaped object carrying form data for the schema action. */
function schemaEv(form: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  return {
    params: { id: 'mem-id-abc' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importActions>>['updateSchema']>[0];
}

describe('memory-detail `updateSchema` action (#588)', () => {
  const VALID_SCHEMA = JSON.stringify({
    objectTypes: { competitor: { fields: { name: { type: 'text', required: true } } } },
  });

  it('sends the parsed schema through updateMemory and returns success', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    const result = await actions.updateSchema(schemaEv({ schemaJson: VALID_SCHEMA }));

    expect(successMessage(result)).toEqual({ type: 'success', text: 'Schema saved.' });
    // #1255: the action stamps the load's memory-bound id, so its result
    // finds THIS form's store and nothing else's.
    expect((superFormFrom(result) as { id?: string })?.id).toBe('updateSchema:mem-id-abc');
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toEqual({
      id: 'mem-id-abc',
      schema: JSON.parse(VALID_SCHEMA),
    });
  });

  it('sends null to clear the schema when the editor is empty', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc' } });
    const actions = await importActions();

    const result = await actions.updateSchema(schemaEv({ schemaJson: '   ' }));

    expect(successMessage(result)).toEqual({ type: 'success', text: 'Schema removed.' });
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.schema).toBeNull();
  });

  it('rejects malformed JSON as a field error before calling the API', async () => {
    const actions = await importActions();

    const result = await actions.updateSchema(schemaEv({ schemaJson: '{ not json' }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'schemaJson')).toBe('Not valid JSON.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a structurally invalid schema as a field error before calling the API', async () => {
    const actions = await importActions();

    const result = await actions.updateSchema(schemaEv({
      schemaJson: JSON.stringify({ objectTypes: { c: { fields: {} } } }),
    }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'schemaJson')).toMatch(/non-empty "fields"/);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("surfaces the server's BAD_USER_INPUT verdict verbatim on the field", async () => {
    // The client mirror and the server validator can drift — the server's
    // verdict must still land as an actionable field error.
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{
          message: 'updateMemory.schema: unknown key "requird" in field "name"',
          extensions: { code: 'BAD_USER_INPUT' },
        }],
      },
    });
    const actions = await importActions();

    const result = await actions.updateSchema(schemaEv({ schemaJson: VALID_SCHEMA }));

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'schemaJson')).toBe('updateMemory.schema: unknown key "requird" in field "name"');
  });

  it('returns a form-level error message on non-input server failures', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'boom', extensions: { code: 'INTERNAL' } }] },
    });
    const actions = await importActions();

    const result = await actions.updateSchema(schemaEv({ schemaJson: VALID_SCHEMA }));

    expect(result).toMatchObject({ status: 500 });
    expect(successMessage(result)).toEqual({ type: 'error', text: 'Something went wrong on our side.' });
  });
});

/**
 * #652 — the Owner row. The page used to assert "Access: Only you" for every
 * personal/private memory, which is false for a MemoryShare grantee: they are
 * not the owner, and access is not only theirs.
 *
 * `Memory` has no `user` field, so the owner's handle and URN need a second
 * read through `user(ref:)` — which the server MASKS to null for a caller who
 * shares no organization with the owner (#384 anti-enumeration). That masked
 * case is the one the issue was reported from, so it is pinned here.
 */
describe('memory settings load — the owner (#652)', () => {
  beforeEach(() => {
    mockFetchAllItems.mockReset();
    mockFetchAllItems.mockResolvedValue([]);
  });

  function ev(graph: Record<string, unknown>) {
    return {
      locals: { token: 'tok', user: { id: 'viewer-1' } },
      params: { id: graph.id as string },
      parent: async () => ({ graph, user: { id: 'viewer-1' } }),
    } as never;
  }

  const personal = (over: Record<string, unknown> = {}) => ({
    id: 'mem-1', name: 'Notes', urn: 'hrn:mem:acme.com:notes', class: 'personal',
    organizationId: null, userId: 'owner-9', visibility: null, ...over,
  });

  async function runLoad(graph: Record<string, unknown>) {
    const { load } = await import('./+page.server');
    return (await load(ev(graph))) as {
      owner: { id: string; handle: string | null; urn: string | null } | null;
      ownerUserId: string | null;
      transferCanDelete: boolean;
    };
  }

  it('resolves the owner and returns their handle and URN', async () => {
    mockRequest.mockResolvedValueOnce({
      user: { id: 'owner-9', handle: 'ada', urn: 'hrn:user:ada' },
    });
    const res = await runLoad(personal());
    expect(res.ownerUserId).toBe('owner-9');
    expect(res.owner).toEqual({ id: 'owner-9', handle: 'ada', urn: 'hrn:user:ada' });
  });

  it('reports a MASKED owner as null while keeping the owner id', async () => {
    // The reported case: a grantee opening a memory shared with them by
    // someone they share no org with. The page must say it cannot identify
    // the owner — never "Only you", and never a fabricated name.
    mockRequest.mockResolvedValueOnce({ user: null });
    const res = await runLoad(personal());
    expect(res.owner).toBeNull();
    expect(res.ownerUserId).toBe('owner-9');
  });

  it('does not query for an owner when the memory is org-owned', async () => {
    // `chk_memory_owner_xor` — org and user ownership are mutually exclusive,
    // so a null userId means there is no user owner to look up. Issuing the
    // query anyway would be a request with a null ref on every org memory.
    mockRequest.mockResolvedValueOnce({ effectiveAccess: { canDelete: false } });
    const res = await runLoad(personal({ class: 'knowledge', organizationId: 'org-1', userId: null }));
    expect(res.ownerUserId).toBeNull();
    expect(res.owner).toBeNull();
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest.mock.calls[0]![1]).toEqual({ user: 'viewer-1', resource: 'mem-1' });
  });

  it('uses the effective memory.delete capability for a granted contributor', async () => {
    mockRequest.mockResolvedValueOnce({ effectiveAccess: { canDelete: true } });
    const res = await runLoad(personal({ class: 'knowledge', organizationId: 'org-1', userId: null }));
    expect(res.transferCanDelete).toBe(true);
  });

  it('reads the owner capability for a user-owned knowledge memory', async () => {
    mockRequest.mockResolvedValueOnce({ effectiveAccess: { canDelete: true } });
    const res = await runLoad(personal({ class: 'knowledge', organizationId: null, userId: null }));
    expect(res.transferCanDelete).toBe(true);
    expect(mockRequest.mock.calls[0]![1]).toEqual({ user: 'viewer-1', resource: 'mem-1' });
  });

  it('reports null rather than throwing when the owner read fails', async () => {
    // Denied, missing and broken all render the same honest sentence, so
    // collapsing them claims nothing false — but the loader must not take the
    // page down over a decorative row.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockRequest.mockRejectedValueOnce(new Error('boom'));
      const res = await runLoad(personal());
      expect(res.owner).toBeNull();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

// ── `retryFailedEmbeddings` (#695 / server #882) ────────────────────────────

function retryEv(form: Record<string, string> = {}, memId = 'mem-id-abc') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  return {
    params: { id: memId },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<
    Awaited<ReturnType<typeof importActions>>['retryFailedEmbeddings']
  >[0];
}

function retriedCountOf(result: unknown): unknown {
  return (result as { retriedCount?: unknown } | undefined)?.retriedCount;
}

describe('memory-detail `retryFailedEmbeddings` action (#695 / server #882)', () => {
  it('addresses the memory from params.id, not from the form', async () => {
    // The mutation takes only a memoryRef, and the route already knows it. If
    // it ever came off the form instead, a caller could re-drive a DIFFERENT
    // memory than the page they are on — so the ref's provenance is pinned.
    mockRequest.mockResolvedValueOnce({ retryFailedEmbeddings: 4 });
    const actions = await importActions();

    await actions.retryFailedEmbeddings(retryEv({ memoryRef: 'mem-SOMEONE-ELSE' }, 'mem-real'));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toEqual({ memoryRef: 'mem-real' });
  });

  it('returns the server count as DATA, and sets no success message prose', async () => {
    // The outcome sentence has a number in it, so it must be built at the t()
    // boundary on the client. A server-authored sentence here would be
    // permanently untranslatable — and a success `message` would be dead
    // string competing with the rendered one.
    mockRequest.mockResolvedValueOnce({ retryFailedEmbeddings: 12 });
    const actions = await importActions();

    const result = await actions.retryFailedEmbeddings(retryEv());

    expect(retriedCountOf(result)).toBe(12);
    expect(successMessage(result)).toBeUndefined();
  });

  it('distinguishes zero from absent — 0 is a real answer, not a missing one', async () => {
    // `retriedCount === 0` renders "No failed embeddings to re-drive."; a
    // NULLISH count renders nothing at all. A falsy check would collapse the
    // two and silently swallow the zero case, which is the common one.
    mockRequest.mockResolvedValueOnce({ retryFailedEmbeddings: 0 });
    const actions = await importActions();

    const result = await actions.retryFailedEmbeddings(retryEv());

    expect(retriedCountOf(result)).toBe(0);
    expect(retriedCountOf(result)).not.toBeNull();
    expect(retriedCountOf(result)).not.toBeUndefined();
  });

  it('surfaces a GraphQL failure as a scoped error message and no count', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
    });
    const actions = await importActions();

    const result = await actions.retryFailedEmbeddings(retryEv());

    expect(successMessage(result)).toMatchObject({ type: 'error' });
    // No count on the failure path: a rendered "Queued 0 nodes" beside an
    // error would report work that never happened.
    expect(retriedCountOf(result)).toBeUndefined();
  });

  it('rejects a payload carrying a SIBLING action’s discriminator', async () => {
    // The page posts four forms to four actions. A `_kind` from the wrong one
    // must fail validation rather than re-driving embeddings because a
    // different form was submitted.
    const actions = await importActions();

    const result = await actions.retryFailedEmbeddings(retryEv({ _kind: 'updateVectorIndex' }));

    expect(superFormFrom(result)?.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('accepts an omitted _kind, since the schema defaults it', async () => {
    mockRequest.mockResolvedValueOnce({ retryFailedEmbeddings: 1 });
    const actions = await importActions();

    const result = await actions.retryFailedEmbeddings(retryEv());

    expect(retriedCountOf(result)).toBe(1);
  });
});

// ── Tests for the `updateMarketplaceListing` action (#841) ─────────────
// hrn:node:hadronmemory.com:specs:cor:acl:080:04: the marketplace catalogue is listedOnMarketplace AND
// publicly accessible. Nothing could set the flag from any product surface —
// this action is the portal half.

/** RequestEvent-shaped object carrying form data for the marketplace toggle. */
function marketplaceEv(form: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(form)) fd.append(k, v);
  return {
    params: { id: 'mem-id-abc' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importActions>>['updateMarketplaceListing']>[0];
}

describe('memory-detail `updateMarketplaceListing` action (#841)', () => {
  it('lists a memory on the marketplace through updateMemory', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc', listedOnMarketplace: true } });
    const actions = await importActions();

    const result = await actions.updateMarketplaceListing(marketplaceEv({
      listedOnMarketplace: 'true',
    }));

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Changes saved.' });
    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    // toEqual, not toMatchObject: the evidence map claims the variables
    // carry id + the flag ONLY (Rook's P3 on #1244) — a subset match would
    // let a smuggled extra field pass unnoticed.
    expect(vars).toEqual({ id: 'mem-id-abc', listedOnMarketplace: true });
  });

  it('unlists explicitly — false is sent, not omitted', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc', listedOnMarketplace: false } });
    const actions = await importActions();

    await actions.updateMarketplaceListing(marketplaceEv({
      listedOnMarketplace: 'false',
    }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars.listedOnMarketplace).toBe(false);
  });

  it('rejects a marketplace submission with the wrong form discriminator before calling the API', async () => {
    const actions = await importActions();

    const result = await actions.updateMarketplaceListing(marketplaceEv({
      _kind: 'updateVectorIndex',
      listedOnMarketplace: 'true',
    }));

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns the scoped error message on a failure', async () => {
    mockRequest.mockRejectedValueOnce(new Error('marketplace refused'));
    const actions = await importActions();

    const result = await actions.updateMarketplaceListing(marketplaceEv({
      listedOnMarketplace: 'true',
    }));

    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'marketplace refused' });
  });

  it('stamps the action form with the load form’s MEMORY-BOUND id — results must find their store, and only THIS memory’s', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'mem-id-abc', listedOnMarketplace: true } });
    const actions = await importActions();

    const result = await actions.updateMarketplaceListing(marketplaceEv({ listedOnMarketplace: 'true' }));

    expect((superFormFrom(result) as { id?: string })?.id).toBe('updateMarketplaceListing:mem-id-abc');
  });

  it('an uncoded denied write suppresses server prose and request payload (#468 leak class)', async () => {
    // graphql-request packs the whole query and variables into a
    // ClientError's message; extractGqlError must surface the server's
    // errors[0].message instead.
    const refusal = { message: 'FORBIDDEN: you cannot update this memory', response: { errors: [{ message: 'You do not have write access to this memory.' }] } };
    mockRequest.mockRejectedValueOnce(refusal);
    const actions = await importActions();

    const result = await actions.updateMarketplaceListing(marketplaceEv({ listedOnMarketplace: 'true' }));

    const text = (superFormFrom(result)?.message as { text: string }).text;
    expect(text).toBe('Something went wrong on our side.');
    expect(text).not.toContain('updateMemory');
    expect(text).not.toContain('listedOnMarketplace');
  });

  // Gil's P2 and Gene's P2-2 on #1244, found independently: a missing or
  // malformed mutation result must never read as success. `updateMemory: null`
  // used to show "Changes saved." with the local intent as the saved fact,
  // and a flagless row "confirmed" the listing as false.
  describe('missing or malformed results are refused, never confirmed (#1244)', () => {
    it.each([
      ['a null result', { updateMemory: null }],
      ['a flagless row', { updateMemory: { id: 'mem-id-abc' } }],
      ['another memory’s row', { updateMemory: { id: 'some-other-memory', listedOnMarketplace: true } }],
    ])('returns a safe failure for %s', async (_label, updateMemory) => {
      mockRequest.mockResolvedValueOnce({ updateMemory });
      const actions = await importActions();

      const result = await actions.updateMarketplaceListing(marketplaceEv({ listedOnMarketplace: 'true' }));

      const outcome = superFormFrom(result);
      const msg = outcome?.message as { type?: string; text?: string } | undefined;
      expect(msg?.type).toBe('error');
      expect(msg?.text).not.toBe('Changes saved.');
      // No resync either: a refused confirmation must not touch the form's
      // data — the user's tick stays as an unsaved intent, not a "fact".
      expect(outcome?.data?.listedOnMarketplace).toBe(true);
    });
  });
});

// ── Load: the six-form set and the form-id contract (#841) ───────────
// hrn:node:hadronmemory.com:hadron-portal:review:superforms-distinct-form-ids:
// a route with several superValidate calls must return distinct form ids,
// and an explicit id on the new form must match between load and action.
describe('memory-settings load: form ids (#841)', () => {
  it('returns six distinct form ids; the marketplace form’s id is exact', async () => {
    const mod = await import('./+page.server');
    const graph = {
      id: 'mem-1', urn: 'hrn:mem:acme.com:docs', name: 'Docs', class: 'knowledge',
      isEncrypted: false, organizationId: 'org-1', userId: null,
      shortDescription: null, description: null, tags: [], license: null,
      category0: null, category1: null, category2: null, iconUrl: null, heroUrl: null,
      homeUrl: null, source: null, readBranch: null, writeBranch: null,
      visibility: 'PUBLIC', listedOnMarketplace: true, vectorIndexEnabled: false,
      embeddingSource: 'abstract', chunkTokens: null, chunkOverlap: null,
      forceFixedSize: false, vectorIndexEncryptedAckAt: null, schema: null,
      syncStatus: 'OK', syncError: null, pendingEdgeCount: 0, lastSyncedAt: null,
      createdAt: '1789430400000', updatedAt: '1789430400000',
    };
    // user null + graph.userId null: no owner lookup and no transfer-access
    // read, so the mocked gql request list stays empty of side queries.
    const parent = vi.fn().mockResolvedValue({ graph, user: null });
    const data = (await mod.load({
      parent, locals: { token: 't' }, params: { id: 'mem-1' },
    } as unknown as Parameters<typeof mod.load>[0])) as Exclude<Awaited<ReturnType<typeof mod.load>>, void>;

    expectDistinctFormIds(data, 6);
    // Memory-bound (`…:${params.id}`, stamped from the route param on both
    // sides): distinct from every sibling AND from the same form on another
    // memory, so a late result can only match its own card (Gene's P2-1).
    expect(data.marketplaceForm.id).toBe('updateMarketplaceListing:mem-1');
    // Same discipline for the vector and schema forms (#1255): unstamped
    // ids matched sibling data/results and a sibling save's invalidateAll
    // rebound these forms, discarding an unsaved draft.
    expect(data.vectorForm.id).toBe('updateVectorIndex:mem-1');
    expect(data.schemaForm.id).toBe('updateSchema:mem-1');
    // The persisted flag seeds the form (the checkbox starts from the fact).
    expect(data.marketplaceForm.data.listedOnMarketplace).toBe(true);
  });
});

// ── `checkVectorIndexHealth` (#1346) ────────────────────────────────────────

function healthEv(memId = 'mem-real') {
  return { params: { id: memId }, locals: { token: 'test-token' }, request: { formData: async () => new FormData() } } as unknown as Parameters<
    Awaited<ReturnType<typeof importActions>>['checkVectorIndexHealth']
  >[0];
}
const ef = (n: number, detail = 'dimension mismatch') => ({ kind: 'EMBED_FAILED', nodeId: `id${n}`, nodeLoc: `l${n}`, nodeUrn: `hrn:node:a.com:m:l${n}`, detail });

describe('memory-detail `checkVectorIndexHealth` action (#1346)', () => {
  it('issues one validateMemory call for the page memory with limit 1000, and no check filter', async () => {
    mockRequest.mockResolvedValueOnce({ validateMemory: { findings: [], totalFindings: 0, truncated: false, nodesChecked: 3, skippedChecks: [] } });
    const actions = await importActions();
    await actions.checkVectorIndexHealth(healthEv());
    expect(mockRequest).toHaveBeenCalledTimes(1);
    const [doc, vars] = mockRequest.mock.calls[0]! as [string, Record<string, unknown>];
    expect(doc).toContain('validateMemory');
    expect(vars).toEqual({ memoryRef: 'mem-real', limit: 1000 });
  });

  it('returns only the EMBED_FAILED findings', async () => {
    mockRequest.mockResolvedValueOnce({ validateMemory: { findings: [{ ...ef(1), kind: 'SPARSE' }, ef(2)], totalFindings: 2, truncated: false, nodesChecked: 9, skippedChecks: [] } });
    const actions = await importActions();
    const result = (await actions.checkVectorIndexHealth(healthEv())) as { vectorHealth?: { failed: Array<{ nodeId: string }> } };
    expect(result.vectorHealth?.failed.map((f) => f.nodeId)).toEqual(['id2']);
  });

  it('a refusal is a plain error state with no health result', async () => {
    mockRequest.mockRejectedValueOnce({ response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] } });
    const actions = await importActions();
    const result = (await actions.checkVectorIndexHealth(healthEv())) as { data?: { vectorHealthError?: string; vectorHealth?: unknown }; status?: number };
    expect(result.status).toBe(500);
    expect(result.data?.vectorHealthError).toBeTruthy();
    expect(result.data?.vectorHealth).toBeUndefined();
  });

  it('the settings loader never runs validateMemory: the scan is on demand only', async () => {
    mockRequest.mockResolvedValue({ user: null, organizations: { items: [], total: 0 } });
    const { load } = await import('./+page.server');
    const graph = { id: 'mem-1', name: 'Notes', urn: 'hrn:mem:acme.com:notes', class: 'personal', organizationId: null, userId: 'u1', visibility: null, vectorIndexEnabled: true };
    await load({
      locals: { token: 'tok', user: { id: 'u1' } },
      params: { id: 'mem-1' },
      parent: async () => ({ graph, user: { id: 'u1' } }),
    } as never);
    expect(mockRequest.mock.calls.length).toBeGreaterThan(0);
    expect(JSON.stringify(mockRequest.mock.calls)).not.toContain('validateMemory');
  });
});
