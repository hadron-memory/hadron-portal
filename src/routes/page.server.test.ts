import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_MEMORIES_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importMod() {
  return import('./+page.server');
}

function homeLoadResult(result: unknown) {
  return result as { publicMemories: unknown[] };
}

describe('home load()', () => {
  it('loads public memories', async () => {
    const memory = { id: 'memory-1', name: 'Public memory' };
    mockRequest.mockResolvedValueOnce({ memories: { items: [memory] } });

    const { load } = await importMod();
    const result = homeLoadResult(await load({} as Parameters<typeof load>[0]));

    expect(mockRequest).toHaveBeenCalledWith(PUBLIC_MEMORIES_QUERY, { limit: 6 });
    expect(result.publicMemories).toEqual([memory]);
  });

  it('falls back to an empty memory list when the query fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('offline'));

    const { load } = await importMod();
    const result = homeLoadResult(await load({} as Parameters<typeof load>[0]));

    expect(result.publicMemories).toEqual([]);
  });
});

// The waiting list was removed along with the pilot-era invitation gate, so the
// home page no longer exposes any form action.
describe('home actions', () => {
  it('exports no actions', async () => {
    const mod = await importMod();
    expect((mod as { actions?: unknown }).actions).toBeUndefined();
  });
});
