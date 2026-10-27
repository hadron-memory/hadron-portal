import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PUSH_MEMORY_TO_GIT_MUTATION,
  SYNC_MEMORY_MUTATION,
  UPDATE_MEMORY_MUTATION,
} from '$lib/server/queries';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';

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

type IntegrationGraph = {
  id: string;
  name: string;
  source: string | null;
  readBranch: string | null;
  writeBranch: string | null;
};

const fakeGraph: IntegrationGraph = {
  id: 'memory-1',
  name: 'Memory',
  source: 'https://github.com/acme/memory.git',
  readBranch: 'main',
  writeBranch: 'hadron-updates',
};

function loadEvent(
  graph: IntegrationGraph = fakeGraph,
  opts: { isConsumerMode?: boolean; activeOrgId?: string | null } = {},
) {
  return {
    parent: vi.fn().mockResolvedValue({
      graph,
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
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['update']>[0];
}

function commandEvent(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    params: { id: 'memory-1' },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['sync']>[0];
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean } };
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.data?.form ?? (result as {
    form?: { data?: Record<string, string>; errors?: Record<string, string[]>; message?: unknown; valid?: boolean };
  } | undefined)?.form;
}

async function runUpdate(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.update(actionEvent(fields));
}

describe('memory integrations load()', () => {
  it('requires non-consumer mode and seeds the integration form without initial errors', async () => {
    const { load } = await importMod();
    const event = loadEvent();
    const result = await load(event);

    expect(mockRequireNonConsumer).toHaveBeenCalledOnce();
    expect((event.parent as ReturnType<typeof vi.fn>)).toHaveBeenCalledOnce();
    expect((result as {
      form: { data: Record<string, string>; errors: Record<string, string[]> };
    }).form.data).toEqual({
      _kind: 'updateIntegration',
      source: 'https://github.com/acme/memory.git',
      readBranch: 'main',
      writeBranch: 'hadron-updates',
    });
    expect((result as {
      syncForm: { data: Record<string, string>; errors: Record<string, string[]> };
      pushForm: { data: Record<string, string>; errors: Record<string, string[]> };
    }).syncForm.data).toEqual({ _kind: 'syncMemory' });
    expect((result as {
      pushForm: { data: Record<string, string>; errors: Record<string, string[]> };
    }).pushForm.data).toEqual({ _kind: 'pushMemory' });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
  });

  it('seeds blank strings for missing integration fields', async () => {
    const { load } = await importMod();
    const result = await load(loadEvent({
      ...fakeGraph,
      source: null,
      readBranch: null,
      writeBranch: null,
    }));

    expect((result as { form: { data: Record<string, string> } }).form.data).toEqual({
      _kind: 'updateIntegration',
      source: '',
      readBranch: '',
      writeBranch: '',
    });
  });

  it('redirects consumer-mode users away before returning the form', async () => {
    const { load } = await importMod();

    await expect(load(loadEvent(fakeGraph, { isConsumerMode: true, activeOrgId: 'personal-org' })))
      .rejects
      .toMatchObject({ status: 303, location: '/app/orgs/personal-org/' });
  });
});

describe('memory integrations form ids (#1320)', () => {
  it('gives Sync and Push their own Superforms ids (both schemas are _kind-only)', async () => {
    const { load } = await importMod();
    expectDistinctFormIds(await load(loadEvent()), 3);
  });

  it('validates each command action under the id its loader form carries', async () => {
    const { load, actions } = await importMod();
    const data = (await load(loadEvent())) as { syncForm: { id: string }; pushForm: { id: string } };
    mockRequest.mockResolvedValue({ syncMemory: { syncStatus: 'OK' }, pushMemoryToGit: {} });
    const sync = superFormFrom(await actions.sync(commandEvent({ _kind: 'syncMemory' })));
    const push = superFormFrom(await actions.pushToGit(commandEvent({ _kind: 'pushMemory' })));
    expect((sync as { id?: string }).id).toBe(data.syncForm.id);
    expect((push as { id?: string }).id).toBe(data.pushForm.id);
  });
});

describe('memory integrations update action', () => {
  it('updates integration fields with trimmed values', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'memory-1' } });

    const result = await runUpdate({
      source: '  https://github.com/acme/memory.git  ',
      readBranch: '  main  ',
      writeBranch: '  hadron-updates  ',
    });

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Changes saved.' });
    expect(mockRequest).toHaveBeenCalledWith(UPDATE_MEMORY_MUTATION, {
      id: 'memory-1',
      source: 'https://github.com/acme/memory.git',
      readBranch: 'main',
      writeBranch: 'hadron-updates',
    });
  });

  it('normalizes blank integration fields to null', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'memory-1' } });

    await runUpdate({ source: '   ', readBranch: '', writeBranch: '   ' });

    expect(mockRequest).toHaveBeenCalledWith(UPDATE_MEMORY_MUTATION, {
      id: 'memory-1',
      source: null,
      readBranch: null,
      writeBranch: null,
    });
  });

  it('normalizes omitted integration fields to null', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemory: { id: 'memory-1' } });

    await runUpdate({});

    expect(mockRequest).toHaveBeenCalledWith(UPDATE_MEMORY_MUTATION, {
      id: 'memory-1',
      source: null,
      readBranch: null,
      writeBranch: null,
    });
  });

  it('returns GraphQL failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(Object.assign(new Error('outer'), {
      response: { errors: [{ message: 'Only owners can update integrations' }] },
    }));

    const result = await runUpdate({
      source: 'https://github.com/acme/memory.git',
      readBranch: 'main',
      writeBranch: 'hadron-updates',
    });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Only owners can update integrations',
    });
  });

  it('rejects update POSTs with the wrong form discriminator', async () => {
    const result = await runUpdate({
      _kind: 'syncMemory',
      source: 'https://github.com/acme/memory.git',
      readBranch: 'main',
      writeBranch: 'hadron-updates',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('memory integrations command actions', () => {
  it('syncs the memory', async () => {
    mockRequest.mockResolvedValueOnce({ syncMemory: { id: 'memory-1', syncStatus: 'OK' } });

    const { actions } = await importMod();
    const result = await actions.sync(commandEvent());

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Memory synced.' });
    expect(mockRequest).toHaveBeenCalledWith(SYNC_MEMORY_MUTATION, { id: 'memory-1' });
  });

  it('rejects sync POSTs with the wrong form discriminator', async () => {
    const { actions } = await importMod();
    const result = await actions.sync(commandEvent({ _kind: 'pushMemory' }));

    expect(result).toMatchObject({ status: 400 });
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns sync failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('rate limit'));

    const { actions } = await importMod();
    const result = await actions.sync(commandEvent());

    expect(result).toMatchObject({ status: 500 });
    // An unrecognised failure gets generic copy, never the server's text (#988).
    expect(superFormFrom(result)?.message).toMatchObject({ type: 'error' });
    expect((superFormFrom(result)?.message as { text: string }).text).toContain('The last sync failed.');
    expect((superFormFrom(result)?.message as { text: string }).text).not.toContain('rate limit');
  });

  // #988
  it('does not claim "synced" when the returned memory is still SYNCING', async () => {
    mockRequest.mockResolvedValueOnce({ syncMemory: { id: 'memory-1', syncStatus: 'SYNCING' } });
    const { actions } = await importMod();
    const msg = superFormFrom(await actions.sync(commandEvent()))?.message as { text: string };
    expect(msg.text).not.toBe('Memory synced.');
    expect(msg.text).toContain('didn’t finish');
    expect(msg.text).toContain('SYNCING');
  });

  it('never shows a credential from the raw git error', async () => {
    mockRequest.mockRejectedValueOnce(new Error(
      'Command failed: git clone --branch nope -- https://x-access-token:ghs_SECRETsecretSECRET123456@github.com/acme/repo.git /tmp/x\nfatal: Remote branch nope not found',
    ));
    const { actions } = await importMod();
    const msg = superFormFrom(await actions.sync(commandEvent()))?.message as { type: string; text: string };
    expect(msg.type).toBe('error');
    expect(msg.text).not.toContain('ghs_SECRET');
    expect(msg.text).not.toContain('github.com');
    expect(msg.text).toContain('doesn’t exist in its repository');
  });

  it('gives the review hold product copy, not the server prose', async () => {
    mockRequest.mockRejectedValueOnce(new Error('GIT_SYNC_REVIEW_REQUIRED: 3 repo-owned node(s) are absent from the default read branch'));
    const { actions } = await importMod();
    const msg = superFormFrom(await actions.sync(commandEvent()))?.message as { text: string };
    expect(msg.text).toContain('held for review');
    expect(msg.text).not.toContain('GIT_SYNC_REVIEW_REQUIRED');
  });

  it('pushToGit never shows a credential from the raw git error (#988, Chip/Gene on #989)', async () => {
    mockRequest.mockRejectedValueOnce(new Error(
      'Git setup failed: Command failed: git push https://x-access-token:ghs_PUSHsecretPUSHsecret99@github.com/acme/repo.git main',
    ));
    const { actions } = await importMod();
    const msg = superFormFrom(await actions.pushToGit(commandEvent()))?.message as { type: string; text: string };
    expect(msg.type).toBe('error');
    expect(msg.text).not.toContain('ghs_PUSH');
    expect(msg.text).not.toContain('github.com');
    expect(msg.text).toContain('Push to Git failed.');
  });

  it('pushes the memory to Git', async () => {
    mockRequest.mockResolvedValueOnce({ pushMemoryToGit: true });

    const { actions } = await importMod();
    const result = await actions.pushToGit(commandEvent());

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({ type: 'success', text: 'Pushed to Git.' });
    expect(mockRequest).toHaveBeenCalledWith(PUSH_MEMORY_TO_GIT_MUTATION, { id: 'memory-1' });
  });

  it('rejects push POSTs with the wrong form discriminator', async () => {
    const { actions } = await importMod();
    const result = await actions.pushToGit(commandEvent({ _kind: 'syncMemory' }));

    expect(result).toMatchObject({ status: 400 });
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns push failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('push rejected'));

    const { actions } = await importMod();
    const result = await actions.pushToGit(commandEvent());

    expect(result).toMatchObject({ status: 500 });
    // Unrecognised text: generic copy, never the server's words (#988).
    expect((superFormFrom(result)?.message as { type: string; text: string }).type).toBe('error');
    expect((superFormFrom(result)?.message as { text: string }).text).toContain('Push to Git failed.');
    expect((superFormFrom(result)?.message as { text: string }).text).not.toContain('push rejected');
  });
});
