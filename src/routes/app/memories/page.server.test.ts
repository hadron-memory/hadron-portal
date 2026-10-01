/**
 * /app/memories index loader. Two tabs: "My memories" (the caller's OWN org-less
 * memories) and "Memories shared with me" (#778). The loader orchestrates the two
 * fetchers with Promise.allSettled so one tab's failure can't blank the other.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.spyOn(console, 'error').mockImplementation(() => {});

const mockOwned = vi.fn();
const mockShared = vi.fn();
vi.mock('$lib/server/personal-memories', () => ({
  fetchOwnedMemories: (...a: unknown[]) => mockOwned(...a),
  fetchSharedMemories: (...a: unknown[]) => mockShared(...a),
}));

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockOwned.mockReset();
  mockShared.mockReset();
  mockRequest.mockReset();
});

async function importLoad() {
  return (await import('./+page.server')).load;
}

function ev() {
  return { locals: { token: 't' } } as unknown as Parameters<
    Awaited<ReturnType<typeof importLoad>>
  >[0];
}

async function runLoad() {
  const load = await importLoad();
  return load(ev());
}

describe('/app/memories index loader', () => {
  it('returns the owned list and the shared list (both tabs)', async () => {
    mockOwned.mockResolvedValue([{ id: 'a', name: 'mine', urn: 'u', class: 'personal' }]);
    mockShared.mockResolvedValue([
      {
        id: 's1',
        name: 'Alice notes',
        urn: 'hrn:mem:alice:notes',
        class: 'personal',
        myShare: { role: 'reader', grantor: { id: 'u-alice', handle: 'alice', name: 'Alice' } },
      },
    ]);
    const result = await runLoad();
    expect(result).toMatchObject({
      memories: [{ id: 'a' }],
      loadFailed: false,
      sharedMemories: [{ id: 's1', myShare: { role: 'reader' } }],
      sharedLoadFailed: false,
    });
    // Never redirects — org members see their personal + shared memories here too.
    expect((result as { status?: number })?.status).toBeUndefined();
  });

  it("a shared-tab fetch failure doesn't blank My memories (independent tabs)", async () => {
    mockOwned.mockResolvedValue([{ id: 'a', name: 'mine' }]);
    mockShared.mockRejectedValue(new Error('boom'));
    const result = (await runLoad()) as {
      memories: unknown[];
      loadFailed: boolean;
      sharedMemories: unknown[];
      sharedLoadFailed: boolean;
    };
    expect(result.memories).toHaveLength(1);
    expect(result.loadFailed).toBe(false);
    expect(result.sharedMemories).toEqual([]);
    expect(result.sharedLoadFailed).toBe(true);
  });

  it("a My-memories fetch failure doesn't blank the shared tab", async () => {
    mockOwned.mockRejectedValue(new Error('boom'));
    mockShared.mockResolvedValue([{ id: 's1', name: 'x', urn: 'u', class: 'personal', myShare: null }]);
    const result = (await runLoad()) as {
      memories: unknown[];
      loadFailed: boolean;
      sharedMemories: unknown[];
      sharedLoadFailed: boolean;
    };
    expect(result.loadFailed).toBe(true);
    expect(result.memories).toEqual([]);
    expect(result.sharedMemories).toHaveLength(1);
    expect(result.sharedLoadFailed).toBe(false);
  });
});

// #649: the grantee "Leave" (self-revoke) action.
async function importActions() {
  return (await import('./+page.server')).actions;
}

function actionEv(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    request: { formData: async () => fd },
    locals: { token: 't' },
  } as unknown as Parameters<Awaited<ReturnType<typeof importActions>>['leaveShare']>[0];
}

describe('/app/memories leaveShare action', () => {
  it('calls deleteMemoryShare with ONLY memoryRef (self-leave — no granteeRef) and returns success', async () => {
    mockRequest.mockResolvedValueOnce({ deleteMemoryShare: { memoryId: 'm1', granteeId: 'u1' } });
    const { leaveShare } = await importActions();
    const res = await leaveShare(actionEv({ memoryId: 'm1', confirm: 'yes' }));
    expect(res).toEqual({ leaveSuccess: true });
    const [, vars] = mockRequest.mock.calls[0];
    expect(vars).toEqual({ memoryRef: 'm1' });
    expect(vars).not.toHaveProperty('granteeRef');
  });

  // The no-JS path: a plain (unenhanced) POST carries no confirm=yes, so the
  // action must NOT delete — it asks for confirmation instead.
  it('does not delete without confirm=yes — returns the pending confirmation instead', async () => {
    const { leaveShare } = await importActions();
    const res = await leaveShare(actionEv({ memoryId: 'm1' }));
    expect(res).toEqual({ pendingLeaveId: 'm1' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a missing memoryId with 400 before calling the API', async () => {
    const { leaveShare } = await importActions();
    const res = (await leaveShare(actionEv({ confirm: 'yes' }))) as { status: number };
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a 500 with a message when the mutation fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const { leaveShare } = await importActions();
    const res = (await leaveShare(actionEv({ memoryId: 'm1', confirm: 'yes' }))) as { status: number; data: { leaveError: string } };
    expect(res.status).toBe(500);
    expect(res.data.leaveError).toBeTruthy();
  });
});

describe('/app/memories under impersonation (#871)', () => {
  it('flags a support session, so the page can explain its empty lists', async () => {
    mockOwned.mockResolvedValue([]);
    mockShared.mockResolvedValue([]);
    const load = await importLoad();
    const ev = {
      locals: { token: 't', impersonation: { sessionId: 's', actorUserId: 'admin', orgId: 'o', expiresAt: Date.now() + 60_000 } },
    } as unknown as Parameters<typeof load>[0];
    expect(((await load(ev)) as { impersonating: boolean }).impersonating).toBe(true);
  });

  it('is not a support session when there is no impersonation, null or absent', async () => {
    mockOwned.mockResolvedValue([]);
    mockShared.mockResolvedValue([]);
    const load = await importLoad();
    for (const impersonation of [null, undefined]) {
      const ev = { locals: { token: 't', impersonation } } as unknown as Parameters<typeof load>[0];
      expect(((await load(ev)) as { impersonating: boolean }).impersonating).toBe(false);
    }
  });
});
