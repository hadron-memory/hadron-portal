import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADD_MEMORY_TO_AGENT_MUTATION,
  CREATE_AGENT_MUTATION,
  CREATE_MEMORY_MUTATION,
  UPDATE_AGENT_MUTATION,
  UPDATE_MEMORY_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  let memoryCount = 0;
  mockRequest.mockImplementation(async (query: string) => {
    if (query === CREATE_MEMORY_MUTATION) {
      memoryCount += 1;
      return { createMemory: { id: `memory-${memoryCount}` } };
    }
    if (query === CREATE_AGENT_MUTATION) return { createAgent: { id: 'agent-1' } };
    return {};
  });
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

const baseFields = {
  agentName: 'Juno',
  agentSlug: 'juno',
  agentDescription: 'Helpful assistant',

  visibility: 'PERSONAL',
  includeKnowledge: 'true',
  knowledgeMemoryName: 'Juno Knowledge',
  knowledgeMemorySlug: 'juno-knowledge',
  systemMemorySlug: 'juno-system',
};

describe('create chatbot action', () => {
  it('creates system and knowledge memories, then the agent scaffold', async () => {
    const result = await runCreate(baseFields);

    expect(result).toMatchObject({ status: 303, location: '/app/agents/agent-1' });
    expect(mockRequest).toHaveBeenCalledWith(CREATE_MEMORY_MUTATION, {
      orgId: 'org-1',
      name: 'juno-system',
      shortDescription: 'Juno System',
      visibility: 'ORGANIZATION',
    });
    expect(mockRequest).toHaveBeenCalledWith(CREATE_MEMORY_MUTATION, {
      orgId: 'org-1',
      name: 'juno-knowledge',
      shortDescription: 'Juno Knowledge',
      visibility: 'ORGANIZATION',
    });
    expect(mockRequest).toHaveBeenCalledWith(CREATE_AGENT_MUTATION, {
      orgId: 'org-1',
      name: 'juno',
      description: 'Helpful assistant',

      systemMemoryId: 'memory-1',
      visibility: 'PERSONAL',
    });
    expect(mockRequest).toHaveBeenCalledWith(UPDATE_AGENT_MUTATION, {
      ref: 'agent-1',
      name: 'Juno',
    });
    // #948: read-only, as the wizard promises the user. Never read-write.
    expect(mockRequest).toHaveBeenCalledWith(ADD_MEMORY_TO_AGENT_MUTATION, {
      agentRef: 'agent-1',
      memoryRef: 'memory-2',
      role: 'read',
    });
    expect(mockRequest).not.toHaveBeenCalledWith(ADD_MEMORY_TO_AGENT_MUTATION, expect.objectContaining({ role: 'read-write' }));
  });

  it('skips knowledge memory creation when includeKnowledge is false', async () => {
    await runCreate({
      ...baseFields,
      includeKnowledge: 'false',
      knowledgeMemoryName: '',
      knowledgeMemorySlug: '',
    });

    const createMemoryCalls = mockRequest.mock.calls.filter(([query]) => query === CREATE_MEMORY_MUTATION);
    expect(createMemoryCalls).toHaveLength(1);
    expect(mockRequest).not.toHaveBeenCalledWith(ADD_MEMORY_TO_AGENT_MUTATION, expect.anything());
  });

  it('ignores an invalid hidden knowledge memory slug when includeKnowledge is false', async () => {
    const result = await runCreate({
      ...baseFields,
      includeKnowledge: 'false',
      knowledgeMemoryName: '',
      knowledgeMemorySlug: 'Bad Slug',
    });

    expect(result).toMatchObject({ status: 303, location: '/app/agents/agent-1' });
    const createMemoryCalls = mockRequest.mock.calls.filter(([query]) => query === CREATE_MEMORY_MUTATION);
    expect(createMemoryCalls).toHaveLength(1);
  });

  it('rejects missing knowledge fields when includeKnowledge is true', async () => {
    const result = await runCreate({
      ...baseFields,
      knowledgeMemoryName: '',
      knowledgeMemorySlug: '',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'knowledgeMemoryName')).toBe('Knowledge memory name is required.');
    expect(fieldError(result, 'knowledgeMemorySlug')).toBe('Knowledge memory URN is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an invalid agent slug before calling the API', async () => {
    const result = await runCreate({ ...baseFields, agentSlug: 'Bad Slug' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'agentSlug')).toEqual(expect.stringContaining('lowercase'));
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects an empty system memory slug before calling the API', async () => {
    const result = await runCreate({ ...baseFields, systemMemorySlug: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'systemMemorySlug')).toBe('System memory URN is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not classify an untyped memory fault by its prose', async () => {
    mockRequest.mockImplementation(async (query: string, vars: Record<string, unknown>) => {
      if (query === CREATE_MEMORY_MUTATION && vars.name === 'juno-system') {
        throw {
          response: {
            errors: [{ message: 'A memory with URN "org:juno-system" already exists' }],
          },
        };
      }
      if (query === CREATE_MEMORY_MUTATION) return { createMemory: { id: 'memory-1' } };
      if (query === CREATE_AGENT_MUTATION) return { createAgent: { id: 'agent-1' } };
      return {};
    });

    const result = await runCreate(baseFields);

    expect(result).toMatchObject({ status: 500 });
    expect(fieldError(result, 'systemMemorySlug')).toBeUndefined();
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Something went wrong on our side.' });
  });

  it('maps duplicate agent URN failures to a 409 field error', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === CREATE_MEMORY_MUTATION) return { createMemory: { id: 'memory-1' } };
      if (query === CREATE_AGENT_MUTATION) {
        throw {
          response: {
            errors: [{ message: 'An agent with URN "org:juno" already exists', extensions: { code: 'AGENT_URN_TAKEN' } }],
          },
        };
      }
      return {};
    });

    const result = await runCreate(baseFields);

    expect(result).toMatchObject({ status: 409 });
    expect(fieldError(result, 'agentSlug')).toBe('An agent with URN "org:juno" already exists');
  });
});
