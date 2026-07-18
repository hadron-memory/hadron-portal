import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SEND_CONTACT_MESSAGE_MUTATION } from '$lib/server/queries';

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
  } as unknown as Parameters<Awaited<ReturnType<typeof importMod>>['actions']['default']>[0];
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

async function runContact(fields: Record<string, string>) {
  const { actions } = await importMod();
  return actions.default(actionEvent(fields));
}

describe('contact load()', () => {
  it('seeds the contact form without initial errors', async () => {
    const { load } = await importMod();

    const result = await load({} as Parameters<typeof load>[0]);

    expect((result as { form: { data: Record<string, string>; errors: Record<string, string[]> } }).form.data).toEqual({
      name: '',
      email: '',
      message: '',
    });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
  });
});

describe('contact action', () => {
  it('rejects missing required fields before calling the API', async () => {
    const result = await runContact({ name: '', email: '', message: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'name')).toBe('Name is required.');
    expect(fieldError(result, 'email')).toBe('Email is required.');
    expect(fieldError(result, 'message')).toBe('Message is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects omitted required fields before calling the API', async () => {
    const result = await runContact({ email: 'ada@example.test', message: 'Hello' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'name')).toBe('Name is required.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid email before calling the API', async () => {
    const result = await runContact({ name: 'Ada', email: 'not-an-email', message: 'Hello' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Enter a valid email address.');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('sends trimmed contact messages', async () => {
    mockRequest.mockResolvedValueOnce({ sendContactMessage: true });

    const result = await runContact({
      name: '  Ada  ',
      email: '  ada@example.test  ',
      message: '  Hello Hadron  ',
    });

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'success',
      text: "Message sent! We'll get back to you soon.",
    });
    expect(mockRequest).toHaveBeenCalledWith(SEND_CONTACT_MESSAGE_MUTATION, {
      name: 'Ada',
      email: 'ada@example.test',
      message: 'Hello Hadron',
    });
  });

  it('returns API failures as Superforms messages', async () => {
    mockRequest.mockRejectedValueOnce(new Error('boom'));

    const result = await runContact({ name: 'Ada', email: 'ada@example.test', message: 'Hello' });

    expect(result).toMatchObject({ status: 500 });
    expect(superFormFrom(result)?.message).toEqual({
      type: 'error',
      text: 'Failed to send message. Please try again.',
    });
  });
});
