/**
 * portal#1398 — the invite action's error banner is announced and readable in
 * both themes (`hrn:node:hadronmemory.com:hadron-portal:review:superforms-banner-a11y-roles`).
 *
 * It was a plain `div` with dark-only colours (`bg-red-950 text-red-300`) and
 * no role: unreadable on the light theme and silent to a screen reader.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defaults } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import Invite from './+page.svelte';
import { accountInviteSchema } from './schema';

const mounted: ReturnType<typeof mountComponent>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

const validated = () => defaults(zod4(accountInviteSchema));

async function mountInvite(form: unknown): Promise<HTMLElement> {
  const m = mountComponent(Invite as never, { data: { form: validated(), prefillEmail: '' }, form } as never);
  mounted.push(m);
  await tick(2);
  return m.target;
}

describe('invite page error banner (portal#1398)', () => {
  it('a failed invite action renders one role="alert" carrying the error text', async () => {
    const root = await mountInvite({ form: { ...validated(), message: { type: 'error', text: 'Could not create the invitation.' } } });
    const alerts = [...root.querySelectorAll('[role="alert"]')];
    expect(alerts.map((a) => a.textContent?.trim())).toEqual(['Could not create the invitation.']);
  });

  it('pairs light colours with dark: variants, like the portal\'s other error banners', async () => {
    const root = await mountInvite({ form: { ...validated(), message: { type: 'error', text: 'Nope.' } } });
    const cls = root.querySelector('[role="alert"]')!.className;
    for (const token of ['border-red-300', 'bg-red-50', 'text-red-700', 'dark:border-red-800', 'dark:bg-red-950', 'dark:text-red-200']) {
      expect(cls).toContain(token);
    }
    // The dark-only trio must not be the base style any more.
    expect(cls.split(/\s+/)).not.toContain('bg-red-950');
    expect(cls.split(/\s+/)).not.toContain('text-red-300');
  });

  it('no error, no alert; the success banner retains its link and is not an alert', async () => {
    expect((await mountInvite(null)).querySelector('[role="alert"]')).toBeNull();
    const root = await mountInvite({ invited: true, inviteUrl: 'https://example.test/invite/abc' });
    expect(root.querySelector('[role="alert"]')).toBeNull();
    expect(root.textContent).toContain('Invitation created!');
    expect(root.querySelector('textarea')?.value).toBe('https://example.test/invite/abc');
  });
});
