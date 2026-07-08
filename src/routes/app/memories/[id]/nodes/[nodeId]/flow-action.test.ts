/**
 * updateFlow action (#478 phase 2) — the Flow tab's save path. It must
 * merge extractionSpec/output into the node's CURRENT data (never
 * clobber unrelated keys), reject reserved field names with a human
 * message, and drop the keys when the editor empties them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function runUpdateFlow(fields: Record<string, string>) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const event = {
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'node-1' },
    locals: { token: 'tok' },
  } as unknown as Parameters<(typeof actions)['updateFlow']>[0];
  return actions.updateFlow(event);
}

const nodeFixture = (data: unknown) => ({
  node: {
    id: 'node-1',
    memoryId: 'mem-1',
    loc: 'classify',
    name: 'Classify',
    tags: ['keep-me'],
    data,
  },
});

describe('updateFlow', () => {
  it('merges the spec into existing data without clobbering other keys', async () => {
    mockRequest.mockResolvedValueOnce(nodeFixture({ promptRef: 'prompts:x', stageOrder: [1] }));
    mockRequest.mockResolvedValueOnce({});

    const result = await runUpdateFlow({
      extractionRows: JSON.stringify([
        { field: 'intent', shape: 'string', description: '' },
        { field: 'confidence', shape: 'number', description: '0 to 1' },
      ]),
      outputWriteTo: 'acme.com::flows::reports:daily',
      outputMode: 'append',
    });

    expect(result).toEqual({ flowSaved: true });
    const input = mockRequest.mock.calls[1][1].input;
    expect(input.memoryId).toBe('mem-1');
    expect(input.tags).toEqual(['keep-me']);
    expect(input.data).toEqual({
      promptRef: 'prompts:x',
      stageOrder: [1],
      extractionSpec: [
        { field: 'intent' },
        { field: 'confidence', shape: 'number', description: '0 to 1' },
      ],
      output: { writeTo: 'acme.com::flows::reports:daily', mode: 'append' },
    });
  });

  it('removes extractionSpec and output when the editor empties them', async () => {
    mockRequest.mockResolvedValueOnce(
      nodeFixture({ other: true, extractionSpec: [{ field: 'x' }], output: { writeTo: 'a::b::c' } }),
    );
    mockRequest.mockResolvedValueOnce({});

    await runUpdateFlow({ extractionRows: '[]', outputWriteTo: '', outputMode: 'replace' });

    const input = mockRequest.mock.calls[1][1].input;
    expect(input.data).toEqual({ other: true });
  });

  it('rejects reserved and plumbing field names before any mutation', async () => {
    for (const field of ['exception', 'exceptions', '__plumbing']) {
      mockRequest.mockReset();
      const result = (await runUpdateFlow({
        extractionRows: JSON.stringify([{ field, shape: 'string', description: '' }]),
        outputWriteTo: '',
        outputMode: 'replace',
      })) as { status: number; data: { flowError: string } };
      expect(result.status).toBe(400);
      expect(result.data.flowError).toMatch(/reserved/);
      expect(mockRequest).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-URN output target', async () => {
    const result = (await runUpdateFlow({
      extractionRows: '[]',
      outputWriteTo: 'not-a-urn',
      outputMode: 'replace',
    })) as { status: number; data: { flowError: string } };
    expect(result.status).toBe(400);
    expect(result.data.flowError).toMatch(/fully-qualified/);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
