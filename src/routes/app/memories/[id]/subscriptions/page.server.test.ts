import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';
import {
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
const mockRequireNonConsumer = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: mockRequireNonConsumer,
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockRequireNonConsumer.mockReset().mockImplementation(async (parent: () => Promise<{
    isConsumerMode?: boolean;
    activeOrgId?: string | null;
  }>) => {
    const data = await parent();
    if (data.isConsumerMode) {
      throw { status: 303, location: data.activeOrgId ? `/app/orgs/${data.activeOrgId}/` : '/app/orgs/' };
    }
  });
});

async function importMod() {
  return import('./+page.server');
}

function loadEvent(opts: { isConsumerMode?: boolean; activeOrgId?: string | null } = {}) {
  return {
    parent: vi.fn().mockResolvedValue({
      isConsumerMode: opts.isConsumerMode ?? false,
      activeOrgId: opts.activeOrgId ?? 'org-1',
    }),
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['load']>[0];
}

function actionEvent(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { id: 'memory-1' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['subscribe']>[0];
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

async function runSubscribe(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.subscribe(actionEvent(fields));
}

async function runUnsubscribe(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.unsubscribe(actionEvent(fields));
}

describe('memory subscriptions load()', () => {
  it('requires non-consumer mode and seeds the subscribe form without initial errors', async () => {
    const { load } = await importMod();
    const event = loadEvent();
    const result = await load(event);
    expectDistinctFormIds(result, 2);

    expect(mockRequireNonConsumer).toHaveBeenCalledOnce();
    expect((event.parent as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((result as {
      form: { data: Record<string, string>; errors: Record<string, string[]> };
    }).form.data).toEqual({
      _kind: 'subscribeMemory',
      orgId: '',
      role: 'READER',
    });
    expect((result as {
      unsubscribeForm: { data: Record<string, string>; errors: Record<string, string[]> };
    }).unsubscribeForm.data).toEqual({
      _kind: 'unsubscribeMemory',
      orgId: '',
    });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
  });

  it('redirects consumer-mode users away before returning the form', async () => {
    const { load } = await importMod();

    await expect(load(loadEvent({ isConsumerMode: true, activeOrgId: 'personal-org' })))
      .rejects
      .toMatchObject({ status: 303, location: '/app/orgs/personal-org/' });
  });
});

describe('memory subscriptions subscribe action', () => {
  it('rejects empty org id before calling the API', async () => {
    const result = await runSubscribe({ orgId: '', role: 'READER' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'orgId')).toBe('Organization ID is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects omitted org id before calling the API', async () => {
    const result = await runSubscribe({ role: 'READER' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'orgId')).toBe('Organization ID is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('creates a subscription with trimmed org id and selected role', async () => {
    mockRequest.mockResolvedValueOnce({ createMemorySubscription: { id: 'sub-1' } });

    const result = await runSubscribe({ orgId: '  org-1  ', role: 'CONTRIBUTOR' });

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Subscription added.' });
    expect(mockRequest).toHaveBeenCalledWith(CREATE_MEMORY_SUBSCRIPTION_MUTATION, {
      memoryId: 'memory-1',
      orgId: 'org-1',
      role: 'CONTRIBUTOR',
    });
  });

  it('defaults omitted or tampered roles to reader', async () => {
    // Preserves #266 legacy behavior: silently coerce invalid roles instead of 400.
    mockRequest.mockResolvedValueOnce({ createMemorySubscription: { id: 'sub-1' } });
    mockRequest.mockResolvedValueOnce({ createMemorySubscription: { id: 'sub-2' } });

    await runSubscribe({ orgId: 'org-1' });
    await runSubscribe({ orgId: 'org-2', role: 'OWNER' });

    expect(mockRequest).toHaveBeenNthCalledWith(1, CREATE_MEMORY_SUBSCRIPTION_MUTATION, {
      memoryId: 'memory-1',
      orgId: 'org-1',
      role: 'READER',
    });
    expect(mockRequest).toHaveBeenNthCalledWith(2, CREATE_MEMORY_SUBSCRIPTION_MUTATION, {
      memoryId: 'memory-1',
      orgId: 'org-2',
      role: 'READER',
    });
  });

  it('returns GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'Subscription already exists' }] },
    }));

    const result = await runSubscribe({ orgId: 'org-1', role: 'READER' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Something went wrong on our side.',
    });
  });

  it('rejects subscribe POSTs with the wrong form discriminator', async () => {
    const result = await runSubscribe({
      _kind: 'unsubscribeMemory',
      orgId: 'org-1',
      role: 'READER',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('memory subscriptions unsubscribe action', () => {
  it('removes a subscription', async () => {
    mockRequest.mockResolvedValueOnce({ deleteMemorySubscription: true });

    const result = await runUnsubscribe({ orgId: '  org-1  ' });

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Subscription removed.' });
    expect(mockRequest).toHaveBeenCalledWith(DELETE_MEMORY_SUBSCRIPTION_MUTATION, {
      memoryId: 'memory-1',
      orgId: 'org-1',
    });
  });

  it('rejects empty org id before calling the API', async () => {
    const result = await runUnsubscribe({ orgId: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'orgId')).toBe('Organization ID is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects unsubscribe POSTs with the wrong form discriminator', async () => {
    const result = await runUnsubscribe({
      _kind: 'subscribeMemory',
      orgId: 'org-1',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('remove failed'));

    const result = await runUnsubscribe({ orgId: 'org-1' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'remove failed' });
  });
});
