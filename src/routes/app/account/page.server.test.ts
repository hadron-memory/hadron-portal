import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<NonNullable<Awaited<ReturnType<typeof importActions>>['update']>>[0];
}

describe('account update action', () => {
  it('rejects an invalid handle before calling the API', async () => {
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: 'Ada Lovelace', email: 'ada@example.com' }));
    expect(result).toMatchObject({ status: 400, data: { error: expect.stringContaining('Handle') } });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('allows clearing the handle', async () => {
    mockRequest.mockResolvedValueOnce({ updateMyProfile: { id: 'u1' } });
    const actions = await importActions();
    const result = await actions.update(actionEv({ name: 'Ada', handle: '', email: 'ada@example.com' }));
    expect(result).toEqual({ success: true });
    expect(mockRequest).toHaveBeenCalledOnce();
  });
});
