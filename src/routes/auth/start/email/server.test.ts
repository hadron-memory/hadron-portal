/**
 * #505 / #460 review — the email-start endpoint must not forward a non-local
 * redirect into the sign-in flow (open-redirect guard on a direct POST).
 */
import { describe, expect, it, vi } from 'vitest';

// vi.mock is hoisted above module init — define the spy via vi.hoisted.
const { startMock } = vi.hoisted(() => ({ startMock: vi.fn() }));
vi.mock('$lib/server/emailLogin', () => ({ startBoundMagicLink: startMock }));

import { POST } from './+server';

startMock.mockResolvedValue({ ok: true });

function post(body: unknown) {
  return POST({
    request: new Request('https://portal.example.test/auth/start/email', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    cookies: {} as never,
  } as never);
}

describe('POST /auth/start/email', () => {
  it('forwards a same-origin local redirect', async () => {
    startMock.mockClear();
    await post({ email: 'a@example.test', redirect: '/invite/x' });
    expect(startMock).toHaveBeenCalledWith(expect.anything(), 'a@example.test', '/invite/x');
  });

  it('drops an absolute/protocol-relative redirect (open-redirect guard)', async () => {
    startMock.mockClear();
    await post({ email: 'a@example.test', redirect: 'https://evil.example/x' });
    expect(startMock).toHaveBeenCalledWith(expect.anything(), 'a@example.test', undefined);
    startMock.mockClear();
    await post({ email: 'a@example.test', redirect: '//evil.example' });
    expect(startMock).toHaveBeenCalledWith(expect.anything(), 'a@example.test', undefined);
  });

  it('400s without an email', async () => {
    const res = await post({ redirect: '/x' });
    expect(res.status).toBe(400);
  });
});

it('#1470 forwards a JSON challenge', async () => {
  startMock.mockClear();
  await post({ email: 'a@example.test', 'cf-turnstile-response': 'challenge' });
  expect(startMock).toHaveBeenCalledWith(expect.anything(), 'a@example.test', undefined, 'challenge');
});
