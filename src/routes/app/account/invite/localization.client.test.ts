import { afterEach, expect, it, vi } from 'vitest';
import { defaults } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import Invite from './+page.svelte';
import { accountInviteSchema } from './schema';
import { describeInviteLimits } from '$lib/invite-limits';

vi.mock('$lib/i18n/t', async (original) => {
  const real = await original<typeof import('$lib/i18n/t')>();
  return { ...real, t: (id: string, text: string, vars?: import('$lib/i18n/t').TemplateVars) =>
    `[${id}]${real.t(id, text, vars)}` };
});
let mounted: ReturnType<typeof mountComponent> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });
it('routes invite form labels, placeholders, hints and success through the translation boundary', async () => {
  mounted = mountComponent(Invite as never, {
    data: { form: defaults(zod4(accountInviteSchema)), prefillEmail: '' },
    form: { invited: true, inviteUrl: 'https://example.test/invite/synthetic', maxActivations: 2, expiresAt: null },
  } as never);
  await tick(2);
  const root = mounted.target;
  for (const id of ['introduction', 'created', 'copy', 'name', 'optional', 'email', 'email-hint', 'github', 'github-hint', 'create']) {
    expect(root.textContent).toContain(`[account.invite.${id}]`);
  }
  expect(root.querySelector<HTMLInputElement>('#inviteName')?.placeholder).toContain('[account.invite.name-placeholder]');
  expect(root.querySelector<HTMLInputElement>('#inviteEmail')?.placeholder).toContain('[account.invite.email-placeholder]');
  expect(root.querySelector<HTMLInputElement>('#inviteGithub')?.placeholder).toContain('[account.invite.github-placeholder]');
});
it('routes returned limits and dynamic values through complete translated sentences', () => {
  expect(describeInviteLimits({ maxActivations: 1 })).toBe('[invite.limits.summary][invite.limits.no-expiry]Does not expire; [invite.limits.one-use]can be used 1 time.');
  expect(describeInviteLimits({ maxActivations: 7 })).toContain('[invite.limits.many-uses]can be used 7 times');
  expect(describeInviteLimits({})).toContain('[invite.limits.unlimited]has no use limit');
  expect(describeInviteLimits({ expiresAt: '2026-11-12T12:00:00Z' })).toContain('[invite.limits.expiry]Expires Nov 12, 2026');
});
it('localizes invalid-email validation', () => {
  const parsed = accountInviteSchema.safeParse({ inviteEmail: 'invalid' });
  expect(parsed.success).toBe(false);
  if (!parsed.success) expect(parsed.error.issues[0].message).toContain('[account.invite.invalid-email]');
});
