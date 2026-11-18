import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECOVERY_NODE_QUERY, RESTORE_NODE_MUTATION } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
});

const tomb = {
  id: 'pk',
  urn: 'hrn:node:acme.com:notes:office-facts',
  memoryId: 'mem-1',
  loc: 'office-facts',
  name: 'Office Facts',
  nodeType: 'info',
  description: 'About the office',
  deletedAt: '2026-10-19T10:00:00.000Z',
  content: 'body',
};

function loadEvent() {
  return {
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token: 'tok' },
    parent: vi.fn().mockResolvedValue({ isConsumerMode: false, activeOrgId: 'org-1' }),
  } as never;
}

async function restore(nodeId = 'pk') {
  const { actions } = await import('./+page.server');
  return actions.restore({
    params: { id: 'mem-1', nodeId },
    locals: { token: 'tok' },
    request: { formData: async () => new FormData() },
  } as never);
}

describe('deleted node page (#1159)', () => {
  it('loads the retained tombstone through recoveryNode', async () => {
    mockRequest.mockResolvedValue({ recoveryNode: tomb });
    const { load } = await import('./+page.server');
    const data = (await load(loadEvent())) as { node: typeof tomb };
    expect(mockRequest).toHaveBeenCalledWith(RECOVERY_NODE_QUERY, { nodeRef: 'pk' });
    expect(data.node).toMatchObject({ name: 'Office Facts', deletedAt: tomb.deletedAt });
  });

  it('404s when there is no readable tombstone (hides existence like the live page)', async () => {
    mockRequest.mockResolvedValue({ recoveryNode: null });
    const { load } = await import('./+page.server');
    await expect(load(loadEvent())).rejects.toMatchObject({ status: 404 });
  });

  it('404s a tombstone that belongs to another memory instead of showing it under this one', async () => {
    mockRequest.mockResolvedValue({ recoveryNode: { ...tomb, memoryId: 'other-mem' } });
    const { load } = await import('./+page.server');
    await expect(load(loadEvent())).rejects.toMatchObject({ status: 404 });
  });

  it('restores through restoreNode and lands on the live node page', async () => {
    mockRequest.mockResolvedValue({ restoreNode: { id: 'pk' } });
    await expect(restore()).rejects.toMatchObject({
      status: 303,
      location: '/app/memories/mem-1/nodes/pk',
    });
    expect(mockRequest).toHaveBeenCalledWith(RESTORE_NODE_MUTATION, { nodeRef: 'pk' });
  });

  it('shows the server refusal verbatim and stays on the tombstone', async () => {
    mockRequest.mockRejectedValue(
      Object.assign(new Error('x'), {
        response: { errors: [{ message: 'Restore the deleted ancestor first.', extensions: { code: 'CONFLICT' } }] },
      }),
    );
    const result = (await restore()) as { status: number; data: { error: string } };
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(result.data.error).toContain('Restore the deleted ancestor first.');
  });
});
