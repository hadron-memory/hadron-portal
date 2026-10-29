import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectDistinctFormIds } from '$lib/test/expectDistinctFormIds';

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

const fakeConnection = {
  id: 'exchange-1',
  mailboxEmail: 'person@example.com',
  displayName: 'Person Example',
};
const fakeOrg = {
  id: 'org-1',
  name: 'Acme',
  exchangeConnections: [fakeConnection],
};
const fakeMessages = [
  {
    id: 'message-1',
    subject: 'Hello',
    from: 'sender@example.com',
    receivedDateTime: '2026-07-20T04:00:00Z',
    isRead: false,
    bodyPreview: 'Preview',
    body: '<p>Hello</p>',
    hasAttachments: false,
  },
];

async function importServer() {
  return import('./+page.server');
}

function ev() {
  return {
    params: { id: 'org-1', connectionId: 'exchange-1' },
    locals: { token: 'test-token' },
    parent: async () => ({}),
  } as unknown as Parameters<(Awaited<ReturnType<typeof importServer>>)['load']>[0];
}

async function runAction(name: 'reply' | 'move', fields: Record<string, string>) {
  const { actions } = await importServer();
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  const event = {
    request: { formData: async () => fd },
    params: { id: 'org-1', connectionId: 'exchange-1' },
    locals: { token: 'test-token' },
  } as unknown as Parameters<(typeof actions)[typeof name]>[0];
  return actions[name](event);
}

function superFormFrom(result: unknown) {
  return (result as {
    data?: { form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message } };
    form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message };
  } | undefined)?.data?.form ?? (result as {
    form?: { errors?: Record<string, string[]>; message?: App.Superforms.Message };
  } | undefined)?.form;
}

describe('Exchange inbox load()', () => {
  it('returns connection messages and seeded Superforms', async () => {
    mockRequest
      .mockResolvedValueOnce({ organization: fakeOrg })
      .mockResolvedValueOnce({ exchangeMessages: fakeMessages });
    const { load } = await importServer();

    const result = await load(ev()) as {
      connection: typeof fakeConnection;
      messages: typeof fakeMessages;
      replyForm: { data: { _kind: string; messageId: string; body: string } };
      moveForm: { data: { _kind: string; messageId: string; folderId: string } };
    };
    expectDistinctFormIds(result, 2);

    expect(result.connection).toEqual(fakeConnection);
    expect(result.messages).toEqual(fakeMessages);
    expect(result.replyForm.data).toMatchObject({
      _kind: 'reply',
      messageId: '',
      body: '',
    });
    expect(result.moveForm.data).toMatchObject({
      _kind: 'move',
      messageId: '',
      folderId: 'Archive',
    });
  });
});

describe('reply action', () => {
  it('sends a reply and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce(true);

    const result = await runAction('reply', {
      messageId: 'message-1',
      body: 'Thanks!',
    });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'reply', messageId: 'message-1', body: 'Thanks!' },
        message: { type: 'success', text: 'Reply sent successfully.' },
      },
    });
    expect(mockRequest.mock.calls[0]?.[1]).toEqual({
      connectionId: 'exchange-1',
      messageId: 'message-1',
      body: 'Thanks!',
    });
  });

  it('rejects omitted reply bodies before calling the API', async () => {
    const result = await runAction('reply', {
      messageId: 'message-1',
    });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?.body?.[0]).toBe('Reply body is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects reply POSTs with the wrong form discriminator', async () => {
    const result = await runAction('reply', {
      _kind: 'move',
      messageId: 'message-1',
      body: 'Thanks!',
    });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when sending a reply fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('mailbox unavailable'));

    const result = await runAction('reply', {
      messageId: 'message-1',
      body: 'Thanks!',
    });

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'mailbox unavailable',
    });
  });
});

describe('move action', () => {
  it('moves an email and returns a typed success', async () => {
    mockRequest.mockResolvedValueOnce(true);

    const result = await runAction('move', {
      messageId: 'message-1',
      folderId: 'Archive',
    });

    expect(result).toMatchObject({
      form: {
        valid: true,
        data: { _kind: 'move', messageId: 'message-1', folderId: 'Archive' },
        message: { type: 'success', text: 'Email moved.' },
      },
    });
    expect(mockRequest.mock.calls[0]?.[1]).toEqual({
      connectionId: 'exchange-1',
      messageId: 'message-1',
      folderId: 'Archive',
    });
  });

  it('rejects omitted message ids before moving', async () => {
    const result = await runAction('move', {
      folderId: 'Archive',
    });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?.messageId?.[0]).toBe('Message ID is required');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects move POSTs with the wrong form discriminator', async () => {
    const result = await runAction('move', {
      _kind: 'reply',
      messageId: 'message-1',
      folderId: 'Archive',
    });

    expect((result as { status: number }).status).toBe(400);
    expect(superFormFrom(result)?.errors?._kind).toBeDefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('returns a typed error when moving fails', async () => {
    mockRequest.mockRejectedValueOnce(new Error('folder missing'));

    const result = await runAction('move', {
      messageId: 'message-1',
      folderId: 'Archive',
    });

    expect((result as { status: number }).status).toBe(500);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'folder missing',
    });
  });
});
