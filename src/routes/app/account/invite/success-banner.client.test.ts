import { afterEach, describe, expect, it } from 'vitest';
import { defaults } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion, idleStatusRegions } from '$lib/test/firstPopulatedStatusText';
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
function pairs(element: Element | null | undefined, tokens: string[], darkOnly: string[]) {
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
    const link = root.querySelector('textarea');
    const box = link?.parentElement?.parentElement ?? null;
    pairs(box, ['border-green-300', 'bg-green-50', 'text-green-700', 'dark:border-green-800', 'dark:bg-green-950', 'dark:text-green-300'], ['border-green-800', 'bg-green-950', 'text-green-300']);
    pairs(link, ['bg-zinc-100', 'text-green-800', 'dark:bg-zinc-800', 'dark:text-green-200'], ['bg-zinc-800', 'text-green-200']);
    pairs(box?.querySelector('button') ?? null, ['border-green-300', 'text-green-800', 'not-aria-disabled:hover:bg-green-100', 'aria-disabled:opacity-50', 'aria-disabled:cursor-wait', 'dark:border-green-700', 'dark:text-green-300', 'dark:not-aria-disabled:hover:bg-green-900'], ['border-green-700', 'text-green-700', 'text-green-300', 'hover:bg-green-100', 'hover:bg-green-900', 'dark:hover:bg-green-900', 'enabled:hover:bg-green-100']);
    // The limits paragraph is the only mt-2 paragraph while Copy is idle
    // (#1742): the feedback paragraph is omitted, not rendered empty.
    const limits = [...(box?.querySelectorAll('p.mt-2') ?? [])].find((p) => /can be used/.test(p.textContent ?? ''));
    pairs(limits, ['text-green-700', 'dark:text-green-400'], ['text-green-400']);
  });
  it('omits the feedback paragraph while Copy is idle instead of rendering it empty (#1742)', async () => {
    const root = await renderSuccess();
    const paragraphs = [...root.querySelectorAll('[role="status"] p')];
    expect(paragraphs.length).toBeGreaterThan(0);
    for (const p of paragraphs) expect(p.textContent?.trim() ?? '').not.toBe('');
  });
  // portal#2375: the region exists, empty, before the invitation is created, so the result is
  // announced as a change rather than inserted already populated.
  it('announces the invitation in the status region that was already mounted, empty (#2375)', async () => {
    const props = reactiveProps({
      data: { form: defaults(zod4(accountInviteSchema)), prefillEmail: '' },
      form: null,
    } as Record<string, unknown>);
    const m = mountComponent(Invite as never, props as never);
    mounted.push(m);
    await tick(2);
    const idle = idleStatusRegions(m.target);
    expect(idle.length).toBeGreaterThan(0);
    expect(announcedStatusRegion(m.target)).toBeNull();

    props.form = { invited: true, inviteUrl: 'https://example.test/invite/synthetic', maxActivations: 2, expiresAt: '2026-11-12T12:00:00.000Z' };
    flushSync();
    await tick(2);
    const announced = announcedStatusRegion(m.target);
    expect(announced?.textContent).toContain('Invitation created!');
    expect(idle).toContain(announced);
  });
  it('names the Copy button for what it copies, keeping the short visible label (#1742)', async () => {
    const root = await renderSuccess();
    const copy = root.querySelector<HTMLButtonElement>('button[type="button"]');
    expect(copy?.textContent?.trim()).toBe('Copy');
    expect(copy?.getAttribute('aria-label')).toBe('Copy invitation link');
  });
});
