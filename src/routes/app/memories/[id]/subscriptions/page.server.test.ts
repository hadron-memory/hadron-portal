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

type NavOrg = { id: string; name: string; urn: string; members: { role: string; user: { id: string } }[] };
function loadEvent(opts: { isConsumerMode?: boolean; activeOrgId?: string | null; navOrgs?: NavOrg[]; userId?: string; ownerOrgId?: string | null } = {}) {
  return {
    parent: vi.fn().mockResolvedValue({
      isConsumerMode: opts.isConsumerMode ?? false,
      activeOrgId: opts.activeOrgId ?? 'org-1',
      navOrgs: opts.navOrgs ?? [],
      user: { id: opts.userId ?? 'user-1' },
      graph: { organizationId: opts.ownerOrgId ?? null },
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

  // portal#2220: the picker offers only orgs the server will not refuse outright.
  it('offers only orgs the caller owns or admins, never the memory\'s owning org', async () => {
    const org = (id: string, role: string, userId = 'user-1'): NavOrg => ({ id, name: `Org ${id}`, urn: `hrn:org:${id}.com`, members: [{ role, user: { id: userId } }] });
    const { load } = await importMod();
    const result = await load(loadEvent({
      ownerOrgId: 'org-owner',
      navOrgs: [
        org('org-admin', 'ADMIN'),
        org('org-owner-role', 'OWNER'),
        org('org-member', 'MEMBER'),
        org('org-owner', 'ADMIN'),
        org('org-someone-else-admin', 'ADMIN', 'user-2'),
      ],
    }));
    expect((result as { targets: { id: string }[] }).targets.map((o) => o.id)).toEqual(['org-admin', 'org-owner-role']);
    // Only what the picker shows; no member lists leak to the page.
    expect((result as { targets: object[] }).targets[0]).toEqual({ id: 'org-admin', name: 'Org org-admin', urn: 'hrn:org:org-admin.com' });
  });

  it('offers nothing when the caller has no organization', async () => {
    const { load } = await importMod();
    const result = await load(loadEvent({ navOrgs: [] }));
    expect((result as { targets: unknown[] }).targets).toEqual([]);
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

  it.each([
    ['SUBSCRIPTION_REQUIRES_PUBLIC_MEMORY', /Only a public memory/],
    ['OWNER_ORG_CANNOT_SUBSCRIBE', /owns this memory cannot subscribe/],
  ])('maps %s to its own message and a 400, not a 500', async (code, text) => {
    mockRequest.mockRejectedValueOnce(Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'server prose', extensions: { code } }] },
    }));
    const result = await runSubscribe({ orgId: 'org-1', role: 'READER' });
    expect(result).toMatchObject({ status: 400 });
    const msg = superFormFrom(result)?.message as { type: string; text: string };
    expect(msg.type).toBe('error');
    expect(msg.text).toMatch(text);
    expect(msg.text).not.toBe('Something went wrong on our side.');
  });

  it('keeps the hidden-memory miss as the generic not-found text', async () => {
    mockRequest.mockRejectedValueOnce(Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'Memory not found', extensions: { code: 'NOT_FOUND' } }] },
    }));
    const result = await runSubscribe({ orgId: 'org-1', role: 'READER' });
    expect(result).toMatchObject({ status: 400 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Memory not found' });
  });

  it('keeps an unrecognised failure a 500 with the generic text', async () => {
    mockRequest.mockRejectedValueOnce(Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'boom', extensions: { code: 'SOMETHING_NEW' } }] },
    }));
    const result = await runSubscribe({ orgId: 'org-1', role: 'READER' });
    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Something went wrong on our side.' });
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
