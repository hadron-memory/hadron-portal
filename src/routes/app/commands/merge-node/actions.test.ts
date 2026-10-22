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

  // hadron-server#1682 (Jonas on #1026, P3): both codes on this page, each with
  // its locs from extensions.nodes, and never the server's prose.
  it.each(['COMMENT_MOVE_UNCOMMENTABLE', 'COMMENT_MERGE_FOLDS_THREADS'])('hadron-server#1682: %s gets 409 and fixed copy naming the node', async (code) => {
    mockRequest.mockRejectedValueOnce({
      response: {
        errors: [{ message: 'server prose', extensions: { code, class: 'private', nodes: [{ nodeId: 'n1', loc: 'specs:a', comments: 1 }] } }],
      },
    });
    const result = await run({
      _kind: 'mergeNode',
      source: 'hrn:node:hadronmemory.com::demo::source',
      target: 'hrn:node:hadronmemory.com::demo::target',
      deleteSource: 'true',
    });
    expect(result).toMatchObject({ status: 409 });
    const msg = superFormFrom(result)?.message as { type: string; text: string };
    expect(msg.type).toBe('error');
    expect(msg.text.startsWith('Nothing was merged')).toBe(true);
    expect(msg.text).toContain('Nodes with discussions: specs:a.');
    expect(msg.text).not.toContain('server prose');
  });
});

// portal#1142 S2b (hadron-server#2226; Xylon's gate 6329041498).
describe('merge refused for an include tag', () => {
  const fields = {
    _kind: 'mergeNode',
    source: 'hrn:node:hadronmemory.com:demo:source',
    target: 'hrn:node:hadronmemory.com:demo:target',
    include: ['CONTENT'],
  };
  const refusal = (code: string) => ({
    message: 'raw ClientError text with the query and PRIVATE-VARS',
    response: { errors: [{ message: 'Include <b>t</b> names a node you cannot read.', extensions: { code, tag: '<img src=x onerror=alert(1)>{{> t}}' } }] },
  });

  it('says nothing was merged, with the server words and the tag, and offers no draft', async () => {
    mockRequest.mockRejectedValueOnce(refusal('INCLUDE_TARGET_UNAVAILABLE'));
    const result = await run(fields);
    expect(result).toMatchObject({ status: 400 });
    const message = superFormFrom(result)?.message as { type: string; text: string };
    expect(message.type).toBe('error');
    expect(message.text).toContain('Include <b>t</b> names a node you cannot read.');
    expect(message.text).toContain('Tag: <img src=x onerror=alert(1)>{{> t}}.');
    expect(message.text).toContain('Nothing was merged, and both nodes are unchanged.');
    expect(message.text).not.toContain('Your edit is still here');
    expect(message.text).not.toContain('save again');
    expect(JSON.stringify(result)).not.toContain('PRIVATE-VARS');
    expect(result).not.toHaveProperty('result');
  });

  it('an unknown code keeps the existing generic path', async () => {
    mockRequest.mockRejectedValueOnce(refusal('SOMETHING_ELSE'));
    const message = superFormFrom(await run(fields))?.message as { text: string };
    expect(message.text).not.toContain('Nothing was merged');
  });
});
