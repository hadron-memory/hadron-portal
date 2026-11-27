/**
 * #636: org-less create-agent action. Mirrors the personal-memory create test —
 * mock `$lib/server/api`'s gqlClient, invoke the default action, and assert the
 * GraphQL variables. Key contract: NO orgId is sent (user-owned agent),
 * visibility is PERSONAL, and success lands on the agent detail page.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_PERSONAL_AGENT_MUTATION, UPDATE_AGENT_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ createAgent: { id: 'a1' } });
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
  mockRequest.mock.calls.find((c) => c[0] === CREATE_PERSONAL_AGENT_MUTATION)?.[1] as
    | Record<string, unknown>
    | undefined;

describe('personal (org-less) create-agent action (#636)', () => {
  it('sends NO orgId, visibility=PERSONAL, slug=slug and name=display name (#2647)', async () => {
    await runCreate({ displayName: 'My assistant', slug: 'my-assistant' });
    const vars = createVars();
    expect(vars).toBeDefined();
    expect('orgId' in (vars ?? {})).toBe(false);
    expect(vars?.visibility).toBe('PERSONAL');
    expect(vars?.slug).toBe('my-assistant');
    expect(vars?.name).toBe('My assistant');
  });

  it('creates in one call: no follow-up rename (#2647)', async () => {
    await runCreate({ displayName: 'My Assistant', slug: 'my-assistant' });
    expect(mockRequest.mock.calls.filter((c) => c[0] === CREATE_PERSONAL_AGENT_MUTATION)).toHaveLength(1);
    expect(mockRequest.mock.calls.some((c) => c[0] === UPDATE_AGENT_MUTATION)).toBe(false);
  });

  it('redirects to the new agent detail on success', async () => {
    const result = await runCreate({ displayName: 'My assistant', slug: 'my-assistant' });
    expect(result).toMatchObject({ status: 303, location: '/app/agents/a1' });
  });

  it('rejects an invalid slug before calling the API', async () => {
    const result = await runCreate({ displayName: 'Bad', slug: 'Bad Slug' });
    expect((result as { status?: number })?.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps a duplicate-URN rejection onto the slug field (409)', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'An agent with URN "ada:my-assistant" already exists', extensions: { code: 'AGENT_URN_TAKEN' } }] },
      message: 'An agent with URN "ada:my-assistant" already exists',
    });
    const result = await runCreate({ displayName: 'My assistant', slug: 'my-assistant' });
    expect(result).toMatchObject({
      status: 409,
      data: { form: { errors: { slug: ['An agent with URN "ada:my-assistant" already exists'] } } },
    });
  });
});

// #2569 (C3): an owner at a limit is the server's refusal, shown as such: 409, the server's words, no generic text.
describe('owner limit reached (#2569)', () => {
  const reached = (callerCanManageOwner: boolean, message: string) => ({
    response: { errors: [{ message, extensions: { code: 'OWNER_LIMIT_REACHED', limitKey: 'agents', ownerType: 'organization', callerCanManageOwner, ...(callerCanManageOwner ? { ownerId: 'o1', limit: '3' } : {}) } }] },
  });
  it('answers 409 with the server text, and no link in a public build', async () => {
    mockRequest.mockRejectedValueOnce(reached(true, 'This organization has reached its limit of 3 agents.'));
    const result = (await runCreate({ displayName: 'My Assistant', slug: 'my-assistant' })) as { status: number; data: { form: { message?: { text: string; action?: unknown } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.message?.text).toBe('This organization has reached its limit of 3 agents.');
    expect(result.data.form.message?.action).toBeUndefined();
  });
  it('shows the no-number form unchanged for a caller who cannot manage the owner', async () => {
    mockRequest.mockRejectedValueOnce(reached(false, 'The owner of this memory has reached a limit of their account.'));
    const result = (await runCreate({ displayName: 'My Assistant', slug: 'my-assistant' })) as { status: number; data: { form: { message?: { text: string } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.message?.text).toBe('The owner of this memory has reached a limit of their account.');
  });
});
