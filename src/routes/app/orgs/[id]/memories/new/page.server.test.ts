/**
 * Spec 034-memory-class-access — create-memory action.
 *
 * Strategy mirrors the other +page.server tests: mock `$lib/server/api`'s
 * `gqlClient`, import `actions` from `+page.server.ts`, and invoke the default
 * action with a hand-rolled event. The action ends in `redirect(303, ...)` on
 * success (which throws), so we assert on the GraphQL variables passed to
 * `mockRequest` and tolerate the thrown redirect.
 *
 * Coverage:
 *   - owner-only class (private) → CREATE_MEMORY sends memoryClass, visibility null
 *   - owner-only class (personal) → same shape
 *   - knowledge (default) → sends the chosen visibility, memoryClass 'knowledge'
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_MEMORY_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ createMemory: { id: 'm1' } });
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function ev(fields: Record<string, string>, opts: { orgId?: string } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    request: { formData: async () => fd },
    params: { id: opts.orgId ?? 'org-1' },
    locals: { token: 'test-token' },
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importActions>>['default']>>[0];
}

/** Invoke the default action, swallowing the success redirect. */
async function runCreate(fields: Record<string, string>, opts?: { orgId?: string }) {
  const actions = await importActions();
  try {
    return await actions.default!(ev(fields, opts));
  } catch (e) {
    // success path throws a SvelteKit redirect — that's expected
    return e;
  }
}

function createVars() {
  const call = mockRequest.mock.calls.find((c) => c[0] === CREATE_MEMORY_MUTATION);
  return call?.[1] as Record<string, unknown> | undefined;
}

describe('create-memory action (spec 034)', () => {
  it('private → sends memoryClass=private and visibility=null', async () => {
    await runCreate({ slug: 'my-private', displayName: 'my-private', memoryClass: 'private', visibility: 'ORGANIZATION' });
    const vars = createVars();
    expect(vars?.memoryClass).toBe('private');
    expect(vars?.visibility).toBeNull();
    expect(vars?.name).toBe('my-private');
  });

  it('personal → sends memoryClass=personal and visibility=null', async () => {
    await runCreate({ slug: 'my-personal', displayName: 'my-personal', memoryClass: 'personal' });
    const vars = createVars();
    expect(vars?.memoryClass).toBe('personal');
    expect(vars?.visibility).toBeNull();
  });

  it('#556: owner-only create redirects back to the Personal Memories tab', async () => {
    const result = await runCreate({ slug: 'my-personal', displayName: 'my-personal', memoryClass: 'personal' });
    expect(result).toMatchObject({ status: 303, location: '/app/orgs/org-1/memories?tab=personal' });
  });

  it('#556: knowledge create redirects to the org grid (no tab hint)', async () => {
    const result = await runCreate({ slug: 'shared-kb', displayName: 'shared-kb', memoryClass: 'knowledge' });
    expect(result).toMatchObject({ status: 303, location: '/app/orgs/org-1/memories' });
  });

  it('knowledge (default) → keeps the chosen visibility and memoryClass=knowledge', async () => {
    await runCreate({ slug: 'shared-kb', displayName: 'shared-kb', memoryClass: 'knowledge', visibility: 'ORGANIZATION' });
    const vars = createVars();
    expect(vars?.memoryClass).toBe('knowledge');
    expect(vars?.visibility).toBe('ORGANIZATION');
  });

  it('omitted memoryClass defaults to knowledge with the chosen visibility', async () => {
    await runCreate({ slug: 'plain', displayName: 'plain', visibility: 'PUBLIC' });
    const vars = createVars();
    expect(vars?.memoryClass).toBe('knowledge');
    expect(vars?.visibility).toBe('PUBLIC');
  });

  it('knowledge with no visibility field defaults to ORGANIZATION (spec 034 dropped PRIVATE)', async () => {
    await runCreate({ slug: 'kb', displayName: 'kb', memoryClass: 'knowledge' });
    const vars = createVars();
    expect(vars?.visibility).toBe('ORGANIZATION');
  });

  it('rejects a non-user-creatable class with a 400 and never calls the API', async () => {
    const result = await runCreate({ slug: 'x', displayName: 'x', memoryClass: 'system' });
    expect((result as { status?: number })?.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an invalid memory slug before calling the API', async () => {
    const result = await runCreate({ slug: 'Bad Slug', displayName: 'Bad Slug', memoryClass: 'knowledge' });
    expect(result).toMatchObject({
      status: 400,
      data: { form: { errors: { slug: expect.arrayContaining([expect.stringContaining('lowercase')]) } } },
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid optional URLs before calling the API', async () => {
    const result = await runCreate({
      slug: 'links',
      displayName: 'Links',
      memoryClass: 'knowledge',
      homeUrl: 'not a url',
    });
    expect(result).toMatchObject({
      status: 400,
      data: { form: { errors: { homeUrl: ['Enter a valid URL.'] } } },
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects unsafe optional URL protocols before calling the API', async () => {
    const result = await runCreate({
      slug: 'links',
      displayName: 'Links',
      memoryClass: 'knowledge',
      iconUrl: 'javascript:alert(1)',
    });
    expect(result).toMatchObject({
      status: 400,
      data: { form: { errors: { iconUrl: ['Enter a valid URL.'] } } },
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('an untyped duplicate-URN error does not expose server prose or guess a 409', async () => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{ message: 'A memory with URN "holger-pers:flow-lab" already exists' }],
      },
      message: 'A memory with URN "holger-pers:flow-lab" already exists: {"response":{"data":null},"request":{"query":"mutation CreateMemory { ... }"}}',
    });

    const result = await runCreate({ slug: 'flow-lab', displayName: 'Flow Lab', memoryClass: 'knowledge' });
    expect(result).toMatchObject({ status: 500, data: { form: { message: { type: 'error', text: 'Something went wrong on our side.' } } } });
  });
});
