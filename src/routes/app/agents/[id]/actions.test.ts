import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ADD_MEMORY_TO_AGENT_MUTATION, UPDATE_AGENT_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string>, opts: { agentId?: string } = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    locals: { token: 'test-token' },
    params: { id: opts.agentId ?? 'agent-1' },
    request: { formData: async () => fd },
  } as any;
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: {
      form?: {
        errors?: Record<string, string[]>;
        message?: { type?: string; text?: string };
        valid?: boolean;
      };
    };
    form?: {
      errors?: Record<string, string[]>;
      message?: { type?: string; text?: string };
      valid?: boolean;
    };
  } | undefined)?.data?.form ?? (result as {
    form?: {
      errors?: Record<string, string[]>;
      message?: { type?: string; text?: string };
      valid?: boolean;
    };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

async function runAddMemory(fields: Record<string, string>) {
  const actions = await importActions();
  return actions.addMemory!(actionEv(fields));
}

async function runUpdate(fields: Record<string, string>) {
  const actions = await importActions();
  return actions.update!(actionEv(fields));
}

describe('agent detail actions', () => {
  it('adds a memory with Superforms data and returns a success message', async () => {
    const result = await runAddMemory({
      _kind: 'addMemory',
      memoryId: 'memory-1',
      role: 'read-write',
    });

    expect(superFormFrom(result)).toMatchObject({
      valid: true,
      message: { type: 'success', text: 'Memory added.' },
    });
    expect(mockRequest).toHaveBeenCalledWith(ADD_MEMORY_TO_AGENT_MUTATION, {
      agentRef: 'agent-1',
      memoryRef: 'memory-1',
      role: 'read-write',
    });
  });

  it('rejects a missing memory before calling GraphQL', async () => {
    const result = await runAddMemory({
      _kind: 'addMemory',
      role: 'read',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'memoryId')).toBe('Select a memory.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered memory role before calling GraphQL', async () => {
    const result = await runAddMemory({
      _kind: 'addMemory',
      memoryId: 'memory-1',
      role: 'OWNER',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'role')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a POST meant for the settings form before calling GraphQL', async () => {
    const result = await runAddMemory({
      _kind: 'agentSettings',
      memoryId: 'memory-1',
      role: 'read',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps add-memory GraphQL failures to a typed form message', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Agent memory already exists' }] },
    });

    const result = await runAddMemory({
      _kind: 'addMemory',
      memoryId: 'memory-1',
      role: 'read',
    });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Agent memory already exists',
    });
  });

  it('keeps settings and add-memory submissions separated by _kind', async () => {
    const result = await runUpdate({
      _kind: 'addMemory',
      name: 'Agent',
      urnSlug: 'agent',
      description: '',
      systemPrompt: '',
      visibility: 'ORGANIZATION',
      systemMemoryId: '',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalledWith(UPDATE_AGENT_MUTATION, expect.anything());
  });
});
