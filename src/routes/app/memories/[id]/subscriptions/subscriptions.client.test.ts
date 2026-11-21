// portal#2220: the Add form picks an organization; it no longer takes a raw org id.
import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import Page from './+page.svelte';
import { memorySubscriptionSchema, memoryUnsubscribeSchema } from './schema';
import { firstPopulatedStatusText } from '$lib/test/firstPopulatedStatusText';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const targets = [
  { id: 'org-2', name: 'Beta', urn: 'hrn:org:beta.com' },
  { id: 'org-3', name: 'Gamma', urn: 'hrn:org:gamma.com' },
];

async function open(opts: { targets?: typeof targets; form?: unknown } = {}) {
  const form = await superValidate({ orgId: '', role: 'READER' }, zod4(memorySubscriptionSchema), { errors: false });
  const unsubscribeForm = await superValidate({ orgId: '' }, zod4(memoryUnsubscribeSchema), { errors: false });
  const props = reactiveProps<Record<string, unknown>>({
    data: { graph: { name: 'Public memory', class: 'user', subscriptions: [] }, form, unsubscribeForm, targets: opts.targets ?? targets },
    form: opts.form ?? null,
  });
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  return mounted.target;
}
const button = (root: HTMLElement, name: RegExp) => [...root.querySelectorAll('button')].find((b) => name.test(b.textContent ?? ''));
// Guarded lookup (portal#2340 P3-3): a bare .find(...)!.click() fails as an
// opaque TypeError when the picker renders no rows; fail naming the want.
const pickerRow = (dialog: ParentNode, name: RegExp) => {
  const b = [...dialog.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find((b) => name.test(b.getAttribute('aria-label') ?? ''));
  if (!b) throw new Error(`no picker row matching ${name}; labels present: ${[...dialog.querySelectorAll('button[aria-label]')].map((b) => JSON.stringify(b.getAttribute('aria-label'))).join(', ')}`);
  return b;
};

describe('#2220 subscribe form', () => {
  it('has no free-text organization id field', async () => {
    const root = await open();
    expect(root.querySelector('input[name=orgId][type=text]')).toBeNull();
    expect(root.querySelector('input[placeholder="org-cuid"]')).toBeNull();
    expect(root.querySelector<HTMLInputElement>('form[action="?/subscribe"] input[name=orgId]')?.type).toBe('hidden');
  });

  it('picking an organization fills the hidden id and shows the name with its URN', async () => {
    const root = await open();
    button(root, /Choose organization/)!.click();
    await tick();
    const dialog = document.querySelector('[role=dialog]')!;
    expect(dialog).not.toBeNull();
    // Each row carries its own Select button, named for its organization.
    pickerRow(dialog, /Beta/).click();
    await tick();
    expect(root.querySelector<HTMLInputElement>('form[action="?/subscribe"] input[name=orgId]')!.value).toBe('org-2');
    expect(root.querySelector('[title="hrn:org:beta.com"]')).not.toBeNull();
    expect(button(root, /Change/)).toBeDefined();
  });

  // portal#2230: the opener is named by the "Organization" label plus its own action text.
  it('the org opener button is named "Organization" + its action, before and after a pick', async () => {
    const root = await open();
    const accessibleName = (b: HTMLElement) =>
      (b.getAttribute('aria-labelledby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => root.ownerDocument.getElementById(id)?.textContent?.trim() ?? '')
        .join(' ');
    const opener = () => root.querySelector<HTMLButtonElement>('#subOrgId')!;
    expect(accessibleName(opener())).toContain('Organization');
    expect(accessibleName(opener())).toContain('Choose organization');
    opener().click();
    await tick();
    const dialog = document.querySelector('[role=dialog]')!;
    pickerRow(dialog, /Beta/).click();
    await tick();
    expect(accessibleName(opener())).toContain('Organization');
    expect(accessibleName(opener())).toContain('Change');
  });

  it('with no administered organization there is no Add form, only an explanation', async () => {
    const root = await open({ targets: [] });
    expect(root.querySelector('form[action="?/subscribe"]')).toBeNull();
    expect(firstPopulatedStatusText(root)).toMatch(/administer/i);
  });

  it('a refused add still shows the server refusal beside the form', async () => {
    const sv = await superValidate({ orgId: 'org-2', role: 'READER' }, zod4(memorySubscriptionSchema), { errors: false });
    (sv as any).message = { type: 'error', text: 'The organization that owns this memory cannot subscribe to it. A subscription is created by another organization’s admin.' };
    const root = await open({ form: { form: sv } });
    expect(root.querySelector('[role=alert]')?.textContent).toMatch(/cannot subscribe/);
  });
});

describe('#2267 the org opener announces the dialog and its open state', () => {
  it('declares aria-haspopup="dialog" and flips aria-expanded with the dialog', async () => {
    const root = await open();
    const opener = () => root.querySelector<HTMLButtonElement>('#subOrgId')!;
    expect(opener().getAttribute('aria-haspopup')).toBe('dialog');
    expect(opener().getAttribute('aria-expanded')).toBe('false');
    opener().click();
    await tick();
    expect(opener().getAttribute('aria-expanded')).toBe('true');
    // Picking closes the dialog; the collapsed state is announced again.
    const dialog = document.querySelector('[role=dialog]')!;
    pickerRow(dialog, /Beta/).click();
    await tick();
    expect(opener().getAttribute('aria-expanded')).toBe('false');
  });

  // portal#2340 P3-3: the dismiss paths that could leave the bound open var
  // stale — while one picker is open the opener must report expanded, and each
  // dismiss returns it to collapsed with the opener still usable. (SelectOrg
  // has no cancel button; that path is pinned in
  // rule-editor-references.client.test.ts via the picker stub's Cancel.)
  it('Escape dismiss returns aria-expanded to false and the opener still reopens', async () => {
    const root = await open();
    const opener = () => root.querySelector<HTMLButtonElement>('#subOrgId')!;
    opener().click();
    await tick();
    expect(opener().getAttribute('aria-expanded')).toBe('true');
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await tick();
    expect(opener().getAttribute('aria-expanded')).toBe('false');
    opener().click();
    await tick();
    expect(opener().getAttribute('aria-expanded')).toBe('true');
  });

  it('backdrop-click dismiss returns aria-expanded to false', async () => {
    const root = await open();
    const opener = () => root.querySelector<HTMLButtonElement>('#subOrgId')!;
    opener().click();
    await tick();
    const dialog = document.querySelector<HTMLElement>('[role=dialog]')!;
    const backdrop = dialog.parentElement!;
    expect(backdrop.getAttribute('class')).toContain('fixed inset-0');
    backdrop.click();
    await tick();
    expect(opener().getAttribute('aria-expanded')).toBe('false');
  });
});
