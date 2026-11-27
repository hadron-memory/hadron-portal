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

  it('supports the private class', async () => {
    await runCreate({ displayName: 'secret', slug: 'secret', memoryClass: 'private' });
    expect(createVars()?.memoryClass).toBe('private');
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

import type { PortalExtension } from '$lib/ext/types';
const limitFx = vi.hoisted(() => ({ exts: [] as PortalExtension[] }));
vi.mock('$lib/ext/registry', async (orig) => {
  const real = await orig<typeof import('$lib/ext/registry')>();
  return { ...real, extensionLimitAction: (c: Parameters<typeof real.extensionLimitAction>[0]) => real.extensionLimitAction(c, limitFx.exts) };
});

// #2569 (C3): an owner at a limit is the server's refusal, shown as such: 409, the server's words, no generic text.
describe('owner limit reached (#2569)', () => {
  beforeEach(() => { limitFx.exts = []; });
  const reached = (callerCanManageOwner: boolean, message: string) => ({
    response: { errors: [{ message, extensions: { code: 'OWNER_LIMIT_REACHED', limitKey: 'memories', ownerType: 'organization', callerCanManageOwner, ...(callerCanManageOwner ? { ownerId: 'o1', limit: '3' } : {}) } }] },
  });
  it('answers 409 with the server text, and no link in a public build', async () => {
    mockRequest.mockRejectedValueOnce(reached(true, 'This organization has reached its limit of 3 memories.'));
    const result = (await runCreate({ displayName: 'My notes', slug: 'my-notes', memoryClass: 'personal' })) as { status: number; data: { form: { message?: { text: string; action?: unknown } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.message?.text).toBe('This organization has reached its limit of 3 memories.');
    expect(result.data.form.message?.action).toBeUndefined();
  });
  it('shows the no-number form unchanged for a caller who cannot manage the owner', async () => {
    mockRequest.mockRejectedValueOnce(reached(false, 'The owner of this memory has reached a limit of their account.'));
    const result = (await runCreate({ displayName: 'My notes', slug: 'my-notes', memoryClass: 'personal' })) as { status: number; data: { form: { message?: { text: string } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.message?.text).toBe('The owner of this memory has reached a limit of their account.');
  });
  it('carries the extension link to the form message when the server says the caller can manage the owner', async () => {
    limitFx.exts = [{ id: 'fx', limitAction: () => ({ label: 'See limits', href: '/app/orgs/o1/x' }) }];
    mockRequest.mockRejectedValueOnce(reached(true, 'This organization has reached its limit of 3 memories.'));
    const result = (await runCreate({ displayName: 'My notes', slug: 'my-notes', memoryClass: 'personal' })) as { data: { form: { message?: { action?: unknown } } } };
    expect(result.data.form.message?.action).toEqual({ label: 'See limits', href: '/app/orgs/o1/x' });
    limitFx.exts = [];
  });
});
