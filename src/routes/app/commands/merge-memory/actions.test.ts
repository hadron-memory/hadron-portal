import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MERGE_MEMORIES_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({
    mergeMemories: { id: 'memory-2', urn: 'hrn:memory:hadronmemory.com::target', name: 'Target' },
  });
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string | string[]>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      for (const item of value) fd.append(key, item);
    } else {
      fd.set(key, value);
    }
  }
  return {
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as any;
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

async function run(fields: Record<string, string | string[]>) {
  const actions = await importActions();
  return actions.run!(actionEv(fields));
}

describe('merge memory command action', () => {
  it('omits include when every merge field is selected', async () => {
    const result = await run({
      _kind: 'mergeMemory',
      source: 'hrn:memory:hadronmemory.com::source',
      target: 'hrn:memory:hadronmemory.com::target',
      include: ['CONTENT', 'ABSTRACT', 'DESCRIPTION', 'TAGS', 'DATA', 'PROPERTIES', 'EDGES'],
      deleteSourceMem: 'true',
    });

    expect(result).toMatchObject({ result: { id: 'memory-2' } });
    expect(superFormFrom(result)).toMatchObject({
      valid: true,
      message: { type: 'success', text: 'Memory merged.' },
    });
    expect(mockRequest).toHaveBeenCalledWith(MERGE_MEMORIES_MUTATION, {
      input: {
        source: 'hrn:memory:hadronmemory.com::source',
        target: 'hrn:memory:hadronmemory.com::target',
        include: undefined,
        deleteSourceMem: true,
      },
    });
  });

  it('keeps an omitted include list as an explicit empty selection', async () => {
    await run({
      _kind: 'mergeMemory',
      source: 'hrn:memory:hadronmemory.com::source',
      target: 'hrn:memory:hadronmemory.com::target',
    });

    expect(mockRequest).toHaveBeenCalledWith(MERGE_MEMORIES_MUTATION, expect.objectContaining({
      input: expect.objectContaining({ include: [], deleteSourceMem: false }),
    }));
  });

  it('rejects omitted required refs before calling GraphQL', async () => {
    const result = await run({ _kind: 'mergeMemory' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'source')).toBe('Enter a source memory.');
    expect(fieldError(result, 'target')).toBe('Enter a target memory.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects tampered include values before calling GraphQL', async () => {
    const result = await run({
      _kind: 'mergeMemory',
      source: 'hrn:memory:hadronmemory.com::source',
      target: 'hrn:memory:hadronmemory.com::target',
      include: ['CONTENT', 'OWNER'],
    });

    expect(result).toMatchObject({ status: 400 });
    expect(superFormFrom(result)?.errors?.include).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('hadron-server#1682: a merge refused because discussions cannot follow gets fixed copy naming the nodes, not the server prose', async () => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{ message: 'server prose', extensions: { code: 'COMMENT_MERGE_FOLDS_THREADS', nodes: [{ nodeId: 'n1', loc: 'specs:a', comments: 1 }] } }],
      },
    });
    const result = await run({
      _kind: 'mergeMemory',
      source: 'hrn:memory:hadronmemory.com::source',
      target: 'hrn:memory:hadronmemory.com::target',
    });
    expect(result).toMatchObject({ status: 409 });
    const msg = superFormFrom(result)?.message as { type: string; text: string };
    expect(msg.type).toBe('error');
    expect(msg.text).toMatch(/^Nothing was merged/);
    expect(msg.text).toContain('specs:a');
    expect(msg.text).not.toContain('server prose');
  });
});

