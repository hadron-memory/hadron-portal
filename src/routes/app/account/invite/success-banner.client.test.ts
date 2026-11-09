import { afterEach, describe, expect, it } from 'vitest';
import { defaults } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick } from '$lib/test/mountComponent';
import Invite from './+page.svelte';
import { accountInviteSchema } from './schema';

const mounted: ReturnType<typeof mountComponent>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
async function renderSuccess() {
  const m = mountComponent(Invite as never, {
    data: { form: defaults(zod4(accountInviteSchema)), prefillEmail: '' },
    form: { invited: true, inviteUrl: 'https://example.test/invite/synthetic', maxActivations: 2, expiresAt: '2026-11-12T12:00:00.000Z' },
  } as never);
  mounted.push(m);
  await tick(2);
  return m.target;
}
function pairs(element: Element | null, tokens: string[], darkOnly: string[]) {
  expect(element).not.toBeNull();
  const classes = [...element!.classList];
  for (const token of tokens) expect(classes).toContain(token);
  for (const token of darkOnly) expect(classes).not.toContain(token);
}
describe('invite success feedback (#1545)', () => {
  it('announces success with role=status and retains the invitation text', async () => {
    const root = await renderSuccess();
    const statuses = root.querySelectorAll('[role="status"]');
    expect(statuses).toHaveLength(1);
    expect(statuses[0].textContent).toContain('Invitation created! Share this link:');
    expect(statuses[0].textContent).toContain('can be used 2 times');
    expect(statuses[0].textContent).toContain('Expires Nov 12, 2026');
    expect(statuses[0].textContent).not.toMatch(/single use|30 days/i);
    const link = root.querySelector('textarea');
    expect(link?.value).toBe('https://example.test/invite/synthetic');
    expect(link?.readOnly).toBe(true);
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });
  it('pairs exact light/dark tokens on all four success elements', async () => {
    const root = await renderSuccess();
    const code = root.querySelector('textarea');
    const box = code?.parentElement?.parentElement ?? null;
    pairs(box, ['border-green-300', 'bg-green-50', 'text-green-700', 'dark:border-green-800', 'dark:bg-green-950', 'dark:text-green-300'], ['border-green-800', 'bg-green-950', 'text-green-300']);
    pairs(code, ['bg-zinc-100', 'text-green-800', 'dark:bg-zinc-800', 'dark:text-green-200'], ['bg-zinc-800', 'text-green-200']);
    pairs(box?.querySelector('button') ?? null, ['border-green-300', 'text-green-800', 'hover:bg-green-100', 'dark:border-green-700', 'dark:text-green-300', 'dark:hover:bg-green-900'], ['border-green-700', 'text-green-700', 'text-green-300', 'hover:bg-green-900']);
    pairs(box?.querySelector('p.mt-2') ?? null, ['text-green-700', 'dark:text-green-400'], ['text-green-400']);
  });
});
