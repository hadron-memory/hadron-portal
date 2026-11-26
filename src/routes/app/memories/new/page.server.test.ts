/**
 * #627: org-less personal-memory create action. Mirrors the org create test —
 * mock `$lib/server/api`'s gqlClient, invoke the default action, and assert the
 * GraphQL variables. Key contract: NO orgId is sent (spec 047 user-owned), only
 * the owner-only classes are accepted, and success lands on the org-less memory
 * detail page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_PERSONAL_MEMORY_MUTATION, UPDATE_MEMORY_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ createMemory: { id: 'm1' } });
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function ev(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    request: { formData: async () => fd },
    locals: { token: 'test-token' },
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importActions>>['default']>>[0];
}

async function runCreate(fields: Record<string, string>) {
  const actions = await importActions();
  try {
    return await actions.default!(ev(fields));
  } catch (e) {
    return e; // success path throws a SvelteKit redirect
  }
}

const createVars = () =>
  mockRequest.mock.calls.find((c) => c[0] === CREATE_PERSONAL_MEMORY_MUTATION)?.[1] as
    | Record<string, unknown>
    | undefined;

describe('personal (org-less) create-memory action (#627)', () => {
  it('sends NO orgId, memoryClass=personal, slug=slug and name=display name (#2647)', async () => {
    await runCreate({ displayName: 'My notes', slug: 'my-notes', memoryClass: 'personal' });
    const vars = createVars();
    expect(vars).toBeDefined();
    expect('orgId' in (vars ?? {})).toBe(false);
    expect(vars?.memoryClass).toBe('personal');
    expect(vars?.slug).toBe('my-notes');
    expect(vars?.name).toBe('My notes');
  });

  it('creates in one call: no follow-up rename, whatever the display name (#2647)', async () => {
    await runCreate({ displayName: 'My Notes', slug: 'my-notes', memoryClass: 'personal' });
    expect(mockRequest.mock.calls.filter((c) => c[0] === CREATE_PERSONAL_MEMORY_MUTATION)).toHaveLength(1);
    expect(mockRequest.mock.calls.some((c) => c[0] === UPDATE_MEMORY_MUTATION)).toBe(false);
  });

  it('redirects to the new org-less memory detail on success', async () => {
    const result = await runCreate({ displayName: 'My notes', slug: 'my-notes', memoryClass: 'personal' });
    expect(result).toMatchObject({ status: 303, location: '/app/memories/m1' });
  });

  it('rejects an invalid slug before calling the API', async () => {
    const result = await runCreate({ displayName: 'Bad', slug: 'Bad Slug', memoryClass: 'personal' });
    expect((result as { status?: number })?.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('an untyped collision is a generic fault rather than a guessed field refusal', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'A memory with URN "ada:my-notes" already exists' }] },
      message: 'A memory with URN "ada:my-notes" already exists',
    });
    const result = await runCreate({ displayName: 'My notes', slug: 'my-notes', memoryClass: 'personal' });
    expect(result).toMatchObject({ status: 500, data: { form: { message: { type: 'error', text: 'Something went wrong on our side.' } } } });
  });
});
