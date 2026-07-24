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

beforeEach(() => {
  mockOwned.mockReset();
  mockShared.mockReset();
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
