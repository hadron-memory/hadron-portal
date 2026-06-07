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
});
