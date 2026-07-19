import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CREATE_APP_MUTATION } from '$lib/server/queries';
import { installStrings } from '$lib/i18n/install-strings';

const mockRequest = vi.fn();
const mockFetchAllItems = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

vi.mock('$lib/server/paginate', () => ({
  fetchAllItems: mockFetchAllItems,
}));

vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
  mockFetchAllItems.mockReset();
  mockRequest.mockResolvedValue({ createApp: { id: 'app-1' } });
  mockFetchAllItems.mockResolvedValue([
    {
      id: 'org-1',
      urn: 'hadronmemory.com:org',
      name: 'Org',
      agents: [
        {
          id: 'agent-1',
          urn: 'hrn:agent:hadronmemory.com:org::helper',
          name: 'Helper',
          description: 'Helps.',
        },
      ],
      apps: [],
    },
  ]);
});

async function importActions() {
  const mod = await import('./+page.server');
  return mod.actions;
}

function actionEv(fields: Record<string, string>, opts: { orgId?: string; agentId?: string } = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    locals: { token: 'test-token' },
    params: { id: opts.orgId ?? 'org-1', aid: opts.agentId ?? 'agent-1' },
    request: { formData: async () => fd },
  } as any;
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: {
      form?: {
        errors?: Record<string, string[]>;
        message?: { type?: string; text?: string };
        valid?: boolean;
      };
    };
    form?: {
      errors?: Record<string, string[]>;
      message?: { type?: string; text?: string };
      valid?: boolean;
    };
  } | undefined)?.data?.form ?? (result as {
    form?: {
      errors?: Record<string, string[]>;
      message?: { type?: string; text?: string };
      valid?: boolean;
    };
  } | undefined)?.form;
}

function fieldError(result: unknown, field: string): string | undefined {
  return superFormFrom(result)?.errors?.[field]?.[0];
}

async function runInstall(fields: Record<string, string>) {
  const actions = await importActions();
  try {
    return await actions.install!(actionEv(fields));
  } catch (error) {
    return error;
  }
}

const baseFields = {
  _kind: 'installAgent',
  name: 'Helper',
  urn: 'helper',
  appType: 'WORKSTATION',
};

describe('install agent action', () => {
  it('installs the agent using validated Superforms data', async () => {
    const result = await runInstall(baseFields);

    expect(result).toMatchObject({ status: 303, location: '/app/orgs/org-1/apps/app-1' });
    expect(mockFetchAllItems).toHaveBeenCalled();
    expect(mockRequest).toHaveBeenCalledWith(CREATE_APP_MUTATION, {
      orgId: 'org-1',
      agentId: 'agent-1',
      name: 'Helper',
      urn: 'helper',
      appType: 'WORKSTATION',
      surfaces: ['mcp'],
    });
  });

  it('uses chat surfaces for chatbot installs', async () => {
    await runInstall({ ...baseFields, appType: 'CHATBOT' });

    expect(mockRequest).toHaveBeenCalledWith(CREATE_APP_MUTATION, expect.objectContaining({
      appType: 'CHATBOT',
      surfaces: ['chat'],
    }));
  });

  it('rejects missing required fields before resolving the target', async () => {
    const result = await runInstall({
      _kind: 'installAgent',
      appType: 'WORKSTATION',
    });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'name')).toBe('Name is required.');
    expect(fieldError(result, 'urn')).toBe('URN is required.');
    expect(mockFetchAllItems).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a tampered app type before resolving the target', async () => {
    const result = await runInstall({ ...baseFields, appType: 'OWNER' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'appType')).toBeTruthy();
    expect(mockFetchAllItems).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a POST meant for another form before resolving the target', async () => {
    const result = await runInstall({ ...baseFields, _kind: 'addMemory' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, '_kind')).toBeTruthy();
    expect(mockFetchAllItems).not.toHaveBeenCalled();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('maps duplicate app URNs to a Superforms field error', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'An app with this URN already exists' }] },
    });

    const result = await runInstall(baseFields);

    expect(result).toMatchObject({ status: 409 });
    expect(fieldError(result, 'urn')).toBe(installStrings.errorUrnCollision());
  });

  it('maps a missing agent response to a typed form message', async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'Agent not found' }] },
    });

    const result = await runInstall(baseFields);

    expect(result).toMatchObject({ status: 404 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: installStrings.errorAgentNotFound(),
    });
  });
});
