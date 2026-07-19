import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MERGE_NODES_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({
    mergeNodes: { id: 'node-2', memoryId: 'memory-1', loc: 'target', name: 'Target' },
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

describe('merge node command action', () => {
  it('sends an explicit partial include selection', async () => {
    const result = await run({
      _kind: 'mergeNode',
      source: 'hrn:node:hadronmemory.com::demo::source',
      target: 'hrn:node:hadronmemory.com::demo::target',
      include: ['CONTENT', 'TAGS'],
      deleteSource: 'true',
    });

    expect(result).toMatchObject({ result: { id: 'node-2' } });
    expect(superFormFrom(result)).toMatchObject({
      valid: true,
      message: { type: 'success', text: 'Node merged.' },
    });
    expect(mockRequest).toHaveBeenCalledWith(MERGE_NODES_MUTATION, {
      input: {
        source: 'hrn:node:hadronmemory.com::demo::source',
        target: 'hrn:node:hadronmemory.com::demo::target',
        include: ['CONTENT', 'TAGS'],
        deleteSource: true,
      },
    });
  });

  it('rejects omitted required refs before calling GraphQL', async () => {
    const result = await run({ _kind: 'mergeNode' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'source')).toBe('Enter a source node.');
    expect(fieldError(result, 'target')).toBe('Enter a target node.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a same-source target before calling GraphQL', async () => {
    const result = await run({
      _kind: 'mergeNode',
      source: 'hrn:node:hadronmemory.com::demo::same',
      target: 'hrn:node:hadronmemory.com::demo::same',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Source and target are the same node — pick two different nodes.',
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered form discriminator before calling GraphQL', async () => {
    const result = await run({
      _kind: 'mergeMemory',
      source: 'hrn:node:hadronmemory.com::demo::source',
      target: 'hrn:node:hadronmemory.com::demo::target',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
