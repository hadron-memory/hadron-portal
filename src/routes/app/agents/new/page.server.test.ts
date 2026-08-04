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
  it('sends NO orgId, visibility=PERSONAL, name=slug', async () => {
    await runCreate({ displayName: 'My assistant', slug: 'my-assistant' });
    const vars = createVars();
    expect(vars).toBeDefined();
    expect('orgId' in (vars ?? {})).toBe(false);
    expect(vars?.visibility).toBe('PERSONAL');
    expect(vars?.name).toBe('my-assistant');
  });

  it('updates the display name when it differs from the slug', async () => {
    await runCreate({ displayName: 'My Assistant', slug: 'my-assistant' });
    const update = mockRequest.mock.calls.find((c) => c[0] === UPDATE_AGENT_MUTATION);
    expect(update?.[1]).toMatchObject({ ref: 'a1', name: 'My Assistant' });
  });

  it('does not issue a display-name update when name equals the slug', async () => {
    await runCreate({ displayName: 'my-assistant', slug: 'my-assistant' });
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
      response: { errors: [{ message: 'An agent with URN "ada:my-assistant" already exists' }] },
      message: 'An agent with URN "ada:my-assistant" already exists',
    });
    const result = await runCreate({ displayName: 'My assistant', slug: 'my-assistant' });
    expect(result).toMatchObject({
      status: 409,
      data: { form: { errors: { slug: ['An agent with URN "ada:my-assistant" already exists'] } } },
    });
  });
});
