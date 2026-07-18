import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JOIN_WAITING_LIST_MUTATION, PUBLIC_MEMORIES_QUERY } from '$lib/server/queries';

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

function actionEvent(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['waitingList']>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

function homeLoadResult(result: unknown) {
  return result as {
    publicMemories: unknown[];
    waitingListForm: {
      data: Record<string, string>;
      errors: Record<string, string[]>;
    };
  };
}

async function runWaitingList(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.waitingList(actionEvent(fields));
}

describe('home load()', () => {
  it('loads public memories and seeds the waiting-list form without initial errors', async () => {
    const memory = { id: 'memory-1', name: 'Public memory' };
    mockRequest.mockResolvedValueOnce({ memories: { items: [memory] } });

    const { load } = await importMod();
    const result = homeLoadResult(await load({} as Parameters<typeof load>[0]));

    expect(mockRequest).toHaveBeenCalledWith(PUBLIC_MEMORIES_QUERY, { limit: 6 });
    expect(result.publicMemories).toEqual([memory]);
    expect(result.waitingListForm.data).toEqual({ email: '', requestedFeatures: '' });
    expect(result.waitingListForm.errors).toEqual({});
  });

  it('falls back to an empty memory list while still seeding the waiting-list form', async () => {
    mockRequest.mockRejectedValueOnce(new Error('offline'));

    const { load } = await importMod();
    const result = homeLoadResult(await load({} as Parameters<typeof load>[0]));

    expect(result.publicMemories).toEqual([]);
    expect(result.waitingListForm.data).toEqual({ email: '', requestedFeatures: '' });
    expect(result.waitingListForm.errors).toEqual({});
  });
});

describe('waitingList action', () => {
  it('rejects empty email before calling the API', async () => {
    const result = await runWaitingList({ email: '', requestedFeatures: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Email is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects omitted email before calling the API', async () => {
    const result = await runWaitingList({ requestedFeatures: 'Agent workflows' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Email is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid email before calling the API', async () => {
    const result = await runWaitingList({ email: 'not-an-email', requestedFeatures: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Enter a valid email address.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('joins the waiting list with trimmed email and requested features', async () => {
    mockRequest.mockResolvedValueOnce({ joinWaitingList: true });

    const result = await runWaitingList({
      email: '  ada@example.test  ',
      requestedFeatures: '  Better agents  ',
    });

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'success',
      text: "You're on the list! We'll be in touch.",
    });
    expect(mockRequest).toHaveBeenCalledWith(JOIN_WAITING_LIST_MUTATION, {
      email: 'ada@example.test',
      requestedFeatures: 'Better agents',
    });
  });

  it('normalizes blank requested features to null', async () => {
    mockRequest.mockResolvedValueOnce({ joinWaitingList: true });

    await runWaitingList({ email: 'ada@example.test', requestedFeatures: '   ' });

    expect(mockRequest).toHaveBeenCalledWith(JOIN_WAITING_LIST_MUTATION, {
      email: 'ada@example.test',
      requestedFeatures: null,
    });
  });

  it('returns API failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));

    const result = await runWaitingList({ email: 'ada@example.test', requestedFeatures: '' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Something went wrong. Please try again.',
    });
  });
});
