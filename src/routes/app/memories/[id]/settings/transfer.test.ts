import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));

import { actions, type MemoryOwnerTransferPreview } from './+page.server';

const preview: MemoryOwnerTransferPreview = {
  memoryId: 'memory-1',
  oldUrn: 'hrn:mem:old.org:notes',
  newUrn: 'hrn:mem:new.org:notes',
  fromOwner: 'old-org',
  toOwner: 'new-org',
  currentClass: 'knowledge',
  targetClass: 'group',
  dependents: [
    { kind: 'Nodes', count: 3, handling: 'CARRY' },
    { kind: 'Memory shares', count: 1, handling: 'REFUSE' },
  ],
  blockers: [{ code: 'MEMORY_TRANSFER_DEPENDENTS', message: 'Remove shares first.' }],
  canApply: false,
  applied: false,
};

function event(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return {
    params: { id: 'memory-1' },
    locals: { token: 'token', user: { id: 'actor-1', roles: ['ADMIN'], githubUsername: null, email: null, name: null, avatarUrl: null } },
    request: { formData: async () => data },
  } as Parameters<typeof actions.previewTransfer>[0];
}

const selection = {
  destinationKind: 'org', destinationRef: 'new-org', targetClass: 'group', resetGroupMembers: 'true',
};

beforeEach(() => { request.mockReset(); });

describe('Memory ownership transfer (#969)', () => {
  it('previews dependent refusals and retains the exact selection without applying', async () => {
    request.mockResolvedValueOnce({ transferMemoryOwnership: preview });
    const result = await actions.previewTransfer(event({ _kind: 'previewTransfer', ...selection }));
    expect(result).toMatchObject({
      _kind: 'previewTransfer',
      transferSelection: { destinationKind: 'org', destinationRef: 'new-org', targetClass: 'group', resetGroupMembers: true },
      transferPreview: { canApply: false, blockers: preview.blockers, dependents: preview.dependents },
    });
    expect(request).toHaveBeenCalledWith(expect.any(String), {
      memoryRef: 'memory-1', orgRef: 'new-org', userRef: undefined,
      targetClass: 'group', resetGroupMembers: true, dryRun: true,
    });
  });

  it('pins apply to the previewed URN and redirects only after success', async () => {
    request.mockResolvedValueOnce({ transferMemoryOwnership: { ...preview, canApply: true, blockers: [], applied: true } });
    await expect(actions.applyTransfer(event({ _kind: 'applyTransfer', ...selection, expectedNewUrn: preview.newUrn })))
      .rejects.toMatchObject({ status: 303, location: '/app/memories/memory-1/settings?transferred=1' });
    expect(request).toHaveBeenCalledWith(expect.any(String), {
      memoryRef: 'memory-1', orgRef: 'new-org', userRef: undefined,
      targetClass: 'group', resetGroupMembers: true, dryRun: false,
      expectedNewUrn: preview.newUrn,
    });
  });

  it('returns a re-preview instruction when the server rejects a stale target URN', async () => {
    request.mockRejectedValueOnce({ response: { errors: [{ message: 'changed', extensions: { code: 'STALE_TRANSFER_PREVIEW' } }] } });
    const result = await actions.applyTransfer(event({ _kind: 'applyTransfer', ...selection, expectedNewUrn: preview.newUrn }));
    expect(result).toMatchObject({ status: 409, data: { _kind: 'applyTransfer', transferError: expect.stringContaining('Preview again') } });
  });

  it('does not call the mutation when apply has no preview URN', async () => {
    const result = await actions.applyTransfer(event({ _kind: 'applyTransfer', ...selection }));
    expect(result).toMatchObject({ status: 400, data: { transferError: expect.stringContaining('Preview') } });
    expect(request).not.toHaveBeenCalled();
  });

  it('uses userRef for a move into the caller’s account', async () => {
    request.mockResolvedValueOnce({ transferMemoryOwnership: preview });
    await actions.previewTransfer(event({ _kind: 'previewTransfer', destinationKind: 'user', destinationRef: 'user-1', targetClass: 'private' }));
    expect(request).toHaveBeenCalledWith(expect.any(String), {
      memoryRef: 'memory-1', orgRef: undefined, userRef: 'user-1',
      targetClass: 'private', resetGroupMembers: false, dryRun: true,
    });
  });

  it('redirects an admin to an accessible page after transfer to another user', async () => {
    request.mockResolvedValueOnce({ transferMemoryOwnership: { ...preview, toOwner: 'user-2', applied: true, canApply: true, blockers: [] } });
    await expect(actions.applyTransfer(event({
      _kind: 'applyTransfer', destinationKind: 'user', destinationRef: 'user-2',
      targetClass: 'private', expectedNewUrn: 'hrn:mem:user-2:notes',
    }))).rejects.toMatchObject({ status: 303, location: '/app/memories?transferred=1' });
  });
});
