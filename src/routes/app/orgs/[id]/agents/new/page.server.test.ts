import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_AGENT_MUTATION, UPDATE_AGENT_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ createAgent: { id: 'agent-1' } });
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string>, opts: { orgId?: string } = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    locals: { token: 'test-token' },
    params: { id: opts.orgId ?? 'org-1' },
    request: { formData: async () => fd },
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importActions>>['default']>>[0];
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

async function runCreate(fields: Record<string, string>) {
  const actions = await importActions();
  try {
    return await actions.default!(actionEv(fields));
  } catch (error) {
    return error;
  }
}

describe('create agent action', () => {
  it('creates the agent in one call with slug and display name, no rename (#2647)', async () => {
    const result = await runCreate({
      displayName: 'Research Assistant',
      slug: 'research-assistant',
      description: 'Helps with research',
      systemPrompt: 'stale form text must not be forwarded',
      visibility: 'ORGANIZATION',
    });

    expect(result).toMatchObject({ status: 303, location: '/app/orgs/org-1/agents' });
    expect(mockRequest).toHaveBeenCalledWith(CREATE_AGENT_MUTATION, {
      orgRef: 'org-1',
      slug: 'research-assistant',
      name: 'Research Assistant',
      description: 'Helps with research',

      visibility: 'ORGANIZATION',
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).not.toHaveBeenCalledWith(UPDATE_AGENT_MUTATION, expect.anything());
  });

  it('sends one call when display name already matches the slug', async () => {
    await runCreate({ displayName: 'research-assistant', slug: 'research-assistant' });

    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(mockRequest).toHaveBeenCalledWith(CREATE_AGENT_MUTATION, expect.objectContaining({
      slug: 'research-assistant',
      name: 'research-assistant',
      visibility: 'PERSONAL',
    }));
  });

  it('rejects an invalid agent slug before calling the API', async () => {
    const result = await runCreate({ displayName: 'Bad Slug', slug: 'Bad Slug' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'slug')).toEqual(expect.stringContaining('lowercase'));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an empty display name before calling the API', async () => {
    const result = await runCreate({ displayName: '', slug: 'agent' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'displayName')).toBe('Name is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

// #2569 (C3): an owner at a limit is the server's refusal, shown as such: 409, the server's words, no generic text.
describe('owner limit reached (#2569)', () => {
  const reached = (callerCanManageOwner: boolean, message: string) => ({
    response: { errors: [{ message, extensions: { code: 'OWNER_LIMIT_REACHED', limitKey: 'agents', ownerType: 'organization', callerCanManageOwner, ...(callerCanManageOwner ? { ownerId: 'o1', limit: '3' } : {}) } }] },
  });
  it('answers 409 with the server text, and no link in a public build', async () => {
    mockRequest.mockRejectedValueOnce(reached(true, 'This organization has reached its limit of 3 agents.'));
    const result = (await runCreate({ displayName: 'Research Assistant', slug: 'research-assistant' })) as { status: number; data: { form: { message?: { text: string; action?: unknown } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.message?.text).toBe('This organization has reached its limit of 3 agents.');
    expect(result.data.form.message?.action).toBeUndefined();
  });
  it('shows the no-number form unchanged for a caller who cannot manage the owner', async () => {
    mockRequest.mockRejectedValueOnce(reached(false, 'The owner of this memory has reached a limit of their account.'));
    const result = (await runCreate({ displayName: 'Research Assistant', slug: 'research-assistant' })) as { status: number; data: { form: { message?: { text: string } } } };
    expect(result.status).toBe(409);
    expect(result.data.form.message?.text).toBe('The owner of this memory has reached a limit of their account.');
  });
});
