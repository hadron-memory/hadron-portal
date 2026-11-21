import { emailSignInStrings } from '$lib/i18n/email-sign-in-strings';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStartBoundMagicLink = vi.fn();

vi.mock('$lib/server/emailLogin', () => ({
  emailLoginErrorStatus: (status: number) => (
    Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500
  ),
  startBoundMagicLink: mockStartBoundMagicLink,
}));

beforeEach(() => {
  mockStartBoundMagicLink.mockReset();
});

async function importMod() {
  return import('./+page.server');
}

function actionEvent(fields: Record<string, string>, search = '') {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return {
    cookies: { set: vi.fn() },
    request: { formData: async () => fd },
    url: new URL(`http://localhost/signup${search}`),
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

async function runSignup(fields: Record<string, string>, search = '') {
  const { actions } = await importMod();
  return actions.default(actionEvent(fields, search));
}

describe('Turnstile token (#1470)', () => {
  it('forwards the widget token from the raw form data, which the schema strips', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: true });
    await runSignup({ email: 'ada@example.test', 'cf-turnstile-response': 'tok-1' });
    expect(mockStartBoundMagicLink).toHaveBeenCalledWith(expect.anything(), 'ada@example.test', undefined, 'tok-1');
  });

  it('sends no token when the field is absent or blank', async () => {
    mockStartBoundMagicLink.mockResolvedValue({ ok: true });
    await runSignup({ email: 'ada@example.test' });
    await runSignup({ email: 'ada@example.test', 'cf-turnstile-response': '' });
    for (const call of mockStartBoundMagicLink.mock.calls) expect(call[3]).toBeUndefined();
  });

  it('surfaces a refused bot check as a form message with the server status', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: false, status: 403, error: 'Complete the check and try again.' });
    const result = await runSignup({ email: 'ada@example.test', 'cf-turnstile-response': 'bad' });
    expect(result).toMatchObject({ status: 403 });
  });
});

describe('signup load()', () => {
  it('seeds the email form without initial errors', async () => {
    const { load } = await importMod();
    const result = await load({} as Parameters<typeof load>[0]);

    expect((result as { form: { data: Record<string, string>; errors: Record<string, string[]> } }).form.data).toEqual({
      email: '',
    });
    expect((result as { form: { errors: Record<string, string[]> } }).form.errors).toEqual({});
  });
});

describe('signup action', () => {
  it('rejects empty email before starting the magic-link flow', async () => {
    const result = await runSignup({ email: '' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Email is required.');
    expect(mockStartBoundMagicLink).not.toHaveBeenCalled();
  });

  it('rejects omitted email before starting the magic-link flow', async () => {
    const result = await runSignup({});

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Email is required.');
    expect(mockStartBoundMagicLink).not.toHaveBeenCalled();
  });

  it('rejects invalid email before starting the magic-link flow', async () => {
    const result = await runSignup({ email: 'not-an-email' });

    expect(result).toMatchObject({ status: 400 });
    expect(fieldError(result, 'email')).toBe('Enter a valid email address.');
    expect(mockStartBoundMagicLink).not.toHaveBeenCalled();
  });

  it('starts a bound magic-link flow with trimmed email and safe redirect', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: true });

    const result = await runSignup({ email: '  ada@example.test  ' }, '?redirect=%2Fapp%2Fdashboard');

    expect(superFormFrom(result)?.valid).toBe(true);
    expect(superFormFrom(result)?.message).toEqual({
      type: 'success',
      text: emailSignInStrings.linkSent(),
    });
    expect(mockStartBoundMagicLink).toHaveBeenCalledWith(expect.anything(), 'ada@example.test', '/app/dashboard', undefined);
  });

  it('drops unsafe redirects before starting the magic-link flow', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: true });

    await runSignup({ email: 'ada@example.test' }, '?redirect=//evil.test');

    expect(mockStartBoundMagicLink).toHaveBeenCalledWith(expect.anything(), 'ada@example.test', undefined, undefined);
  });

  it('starts a bound magic-link flow without a redirect when none is provided', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: true });

    await runSignup({ email: 'ada@example.test' });

    expect(mockStartBoundMagicLink).toHaveBeenCalledWith(expect.anything(), 'ada@example.test', undefined, undefined);
  });

  // #686: this used to be titled "passes through the MARKETPLACE redirect
  // hidden field" and used `/browse?addMemory=<id>` as its value, from the
  // sign-up intent chain removed in that issue. The chain is gone; this test is
  // NOT. It is the only positive coverage of the hidden FORM FIELD as a
  // redirect source — a different input from the `?redirect=` query string
  // covered above — and deleting it with its example would have taken that
  // coverage with it (Dara's rule: ask whose property a test is actually
  // pinning before deleting it by call site). Re-pointed at a live path.
  it('passes through a redirect supplied as a hidden form field', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: true });

    await runSignup({ email: 'ada@example.test', redirect: '/app/memories' });

    expect(mockStartBoundMagicLink).toHaveBeenCalledWith(
      expect.anything(),
      'ada@example.test',
      '/app/memories',
      undefined,
    );
  });

  it('drops unsafe hidden-field redirects before starting the magic-link flow', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: true });

    await runSignup({ email: 'ada@example.test', redirect: '//evil.test' });

    expect(mockStartBoundMagicLink).toHaveBeenCalledWith(expect.anything(), 'ada@example.test', undefined, undefined);
  });


  // #686: a link written before #681 still carries `?memory=` / `?graph=`.
  // It must be INERT — not resurrected into a redirect by anything. Pinned on
  // the action because the action is what hands a redirect to the magic-link
  // flow; if the removed intent were ever re-added in either place, a redirect
  // would appear here instead of `undefined`.
  it.each(['?memory=demo-memory', '?graph=demo-memory'])(
    'ignores the retired sign-up intent in %s and sends no redirect',
    async (search) => {
      mockStartBoundMagicLink.mockResolvedValueOnce({ ok: true });

      await runSignup({ email: 'ada@example.test' }, search);

      expect(mockStartBoundMagicLink).toHaveBeenCalledWith(
        expect.anything(),
        'ada@example.test',
        undefined,
        undefined,
      );
    },
  );

  it('returns magic-link failures as Superforms messages', async () => {
    mockStartBoundMagicLink.mockResolvedValueOnce({ ok: false, status: 502, error: 'Could not reach the server.' });

    const result = await runSignup({ email: 'ada@example.test' });

    expect(result).toMatchObject({ status: 502 });
    expect(superFormFrom(result)?.message).toEqual({ type: 'error', text: 'Could not reach the server.' });
  });
});
