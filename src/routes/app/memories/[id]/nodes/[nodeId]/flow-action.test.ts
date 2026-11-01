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

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
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
  it.each([
    'hrn:node:acme.com:flows:reports:daily',
    'urn:node:acme.com::writer::worker::system::reports:daily',
  ])('preserves the original fully-qualified output ref: %s', async (outputWriteTo) => {
    mockRequest.mockResolvedValueOnce(nodeFixture({ other: true }));
    mockRequest.mockResolvedValueOnce({});
    const result = await runUpdateFlow({ extractionRows: '[]', outputWriteTo, outputMode: 'replace' });
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Flow settings saved.' });
    expect(mockRequest).toHaveBeenCalledTimes(2);
    expect(mockRequest.mock.calls[1][1].input.data).toEqual({ other: true, output: { writeTo: outputWriteTo, mode: 'replace' } });
  });

  it('merges the spec into existing data without clobbering other keys', async () => {
    mockRequest.mockResolvedValueOnce(nodeFixture({ promptRef: 'prompts:x', stageOrder: [1] }));
    mockRequest.mockResolvedValueOnce({});

    const result = await runUpdateFlow({
      extractionRows: JSON.stringify([
        { field: 'intent', shape: 'string', description: '' },
        { field: 'confidence', shape: 'number', description: '0 to 1' },
      ]),
      outputWriteTo: 'hrn:node:acme.com::flows::reports:daily',
      outputMode: 'append',
    });

    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Flow settings saved.' });
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
      output: { writeTo: 'hrn:node:acme.com::flows::reports:daily', mode: 'append' },
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
      }));
      expect((result as { status: number }).status).toBe(400);
      expect(superFormFrom(result)?.errors?.extractionRows?.[0]).toMatch(/reserved/);
      expect(mockRequest).not.toHaveBeenCalled();
    }
  });

  it('rejects a non-URN output target', async () => {
    for (const outputWriteTo of ['not-a-urn', '::foo', 'a::', '::::::']) {
      mockRequest.mockReset();
      const result = (await runUpdateFlow({
        extractionRows: '[]',
        outputWriteTo,
        outputMode: 'replace',
      }));
      expect((result as { status: number }).status).toBe(400);
      expect(superFormFrom(result)?.errors?.outputWriteTo?.[0]).toMatch(/fully-qualified/);
      expect(mockRequest).not.toHaveBeenCalled();
    }
  });

  it('rejects tampered action discriminators before any mutation', async () => {
    const result = (await runUpdateFlow({
      _kind: 'testFlow',
      extractionRows: '[]',
      outputWriteTo: '',
      outputMode: 'replace',
    }));
    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind?.[0]).toBeTruthy();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed 404 message when the node is missing', async () => {
    mockRequest.mockResolvedValueOnce({ node: null });

    const result = await runUpdateFlow({
      extractionRows: '[]',
      outputWriteTo: '',
      outputMode: 'replace',
    });

    expect((result as { status: number }).status).toBe(404);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Node not found' });
  });

  it('returns update failures as typed Superforms messages', async () => {
    mockRequest.mockResolvedValueOnce(nodeFixture({ other: true }));
    mockRequest.mockRejectedValueOnce(new Error('flow save exploded'));

    const result = await runUpdateFlow({
      extractionRows: '[]',
      outputWriteTo: '',
      outputMode: 'replace',
    });

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'flow save exploded' });
  });
});
