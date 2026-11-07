import { expect, it, vi } from 'vitest';
const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/i18n/t', async (original) => {
  const real = await original<typeof import('$lib/i18n/t')>();
  return { ...real, t: (id: string, text: string, vars?: import('$lib/i18n/t').TemplateVars) =>
    `[${id}]${real.t(id, text, vars)}` };
});
it('localizes the action fallback when an unclassified fault supplies no reader message', async () => {
  request.mockRejectedValue({});
  const { actions } = await import('./+page.server');
  const formData = new FormData();
  const result = await actions.invite!({
    request: { formData: async () => formData }, locals: { token: 'synthetic' },
    url: new URL('http://localhost/app/account/invite'),
  } as never) as { status: number; data: { form: { message: { text: string } } } };
  expect(request).toHaveBeenCalledTimes(1);
  expect(result.status).toBe(500);
  expect(result.data.form.message.text).toBe('[account.invite.failed]Failed to send invitation');
});
