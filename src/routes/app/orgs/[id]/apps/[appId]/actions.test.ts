import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADD_AGENT_TO_APP_MUTATION,
  CREATE_APP_KEY_MUTATION,
  UPDATE_APP_MUTATION,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));
vi.mock('$lib/server/guards', () => ({
  requireNonConsumer: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function runAction(
  name: 'update' | 'addAgent' | 'createKey',
  fields: Record<string, string>,
) {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  const event = {
    request: { formData: async () => fd },
    params: { id: 'org-1', appId: 'app-1' },
    locals: { token: 'tok' },
  } as unknown as Parameters<(typeof actions)[typeof name]>[0];
  return actions[name](event);
}

const validSettings = {
  name: 'Demo App',
  urn: 'demo-app',
  appType: 'CHATBOT',
  role: 'ADMIN',
  description: 'A demo',
  systemPrompt: 'Be useful',
  createUserPermission: 'IMPLICIT',
  identifyUserMethod: 'SECRET',
  sessionTimeoutSeconds: '3600',
  anonymousTtlDays: '14',
};

describe('update action', () => {
  it('updates app settings from a validated Superform and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('update', validSettings);
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'updateApp', name: 'Demo App', urn: 'demo-app' },
        message: { type: 'success', text: 'Saved.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      UPDATE_APP_MUTATION,
      {
        id: 'app-1',
        name: 'Demo App',
        urn: 'demo-app',
        appType: 'CHATBOT',
        role: 'ADMIN',
        description: 'A demo',
        systemPrompt: 'Be useful',
        createUserPermission: 'IMPLICIT',
        identifyUserMethod: 'SECRET',
        sessionTimeoutSeconds: 3600,
        anonymousTtlDays: 14,
      },
    ]);
  });

  it('normalizes blank optional text fields to null', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('update', {
      ...validSettings,
      description: '',
      systemPrompt: '',
    });
    expect(mockRequest.mock.calls[0][1]).toMatchObject({
      description: null,
      systemPrompt: null,
    });
  });

  it('rejects omitted required settings before mutation', async () => {
    const result = (await runAction('update', {
      ...validSettings,
      name: '',
    })) as { status: number; data: { form: { errors: { name?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.name?.[0]).toBe('Name is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects out-of-range numeric settings before mutation', async () => {
    const result = (await runAction('update', {
      ...validSettings,
      sessionTimeoutSeconds: '59',
      anonymousTtlDays: '91',
    })) as {
      status: number;
      data: { form: { errors: { sessionTimeoutSeconds?: string[]; anonymousTtlDays?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.sessionTimeoutSeconds?.[0]).toBe('Session timeout must be at least 60 seconds');
    expect(result.data.form.errors.anonymousTtlDays?.[0]).toBe('Anonymous TTL must be at most 90 days');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when app update fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('update', validSettings)) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});

describe('addAgent action', () => {
  it('links an agent and preserves explicit training mode', async () => {
    mockRequest.mockResolvedValueOnce({});
    const result = await runAction('addAgent', {
      agentId: 'agent-1',
      trainingMode: 'true',
    });
    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'addAgent', agentId: 'agent-1', trainingMode: 'true' },
        message: { type: 'success', text: 'Agent linked.' },
      },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      ADD_AGENT_TO_APP_MUTATION,
      { appId: 'app-1', agentId: 'agent-1', trainingMode: true },
    ]);
  });

  it('omits training mode when the form did not submit it', async () => {
    mockRequest.mockResolvedValueOnce({});
    await runAction('addAgent', { agentId: 'agent-1' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ appId: 'app-1', agentId: 'agent-1' });
  });

  it('rejects missing agent ids before mutation', async () => {
    const result = (await runAction('addAgent', {})) as {
      status: number;
      data: { form: { errors: { agentId?: string[] } } };
    };
    expect(result.status).toBe(400);
    expect(result.data.form.errors.agentId?.[0]).toBe('Agent is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('createKey action', () => {
  it('creates an app key from a trimmed optional label', async () => {
    mockRequest.mockResolvedValueOnce({
      createAppKey: { key: { id: 'key-1' }, rawKey: 'raw-key' },
    });
    const result = await runAction('createKey', { label: ' production ' });
    expect(result).toMatchObject({
      rawKey: 'raw-key',
      keyId: 'key-1',
      form: { valid: true, data: { _kind: 'createKey', label: 'production' } },
    });
    expect(mockRequest.mock.calls[0]).toEqual([
      CREATE_APP_KEY_MUTATION,
      { appId: 'app-1', label: 'production' },
    ]);
  });

  it('sends undefined for a blank key label', async () => {
    mockRequest.mockResolvedValueOnce({
      createAppKey: { key: { id: 'key-1' }, rawKey: 'raw-key' },
    });
    await runAction('createKey', { label: '' });
    expect(mockRequest.mock.calls[0][1]).toEqual({ appId: 'app-1', label: undefined });
  });

  it('rejects createKey POSTs with the wrong form discriminator', async () => {
    const result = (await runAction('createKey', {
      _kind: 'addAgent',
      label: 'production',
    })) as { status: number; data: { form: { errors: { _kind?: string[] } } } };
    expect(result.status).toBe(400);
    expect(result.data.form.errors._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when key creation fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('nope'));
    const result = (await runAction('createKey', { label: 'production' })) as {
      status: number;
      data: { form: { message: { type: string; text: string } } };
    };
    expect(result.status).toBe(500);
    expect(result.data.form.message).toEqual({ type: 'error', text: 'nope' });
  });
});
