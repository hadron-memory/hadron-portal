/**
 * #942 — the agent Settings tab's "Channel attendance" default, mounted.
 *
 * Two things only a mount can show: the help line follows the checkbox as it
 * changes, and the store is re-seeded when a navigation reuses this component
 * for another agent
 * (`hrn:node:hadronmemory.com:hadron-portal:review:a-reused-component-must-reseed-its-form`).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, resetStubPage } from '$lib/test/stubs/app-stores';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import { agentRegisterDefaultsSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetStubPage();
});

async function mountSettings(props: Record<string, unknown>) {
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  const settings = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Settings')!;
  settings.click();
  flushSync();
  return m.target;
}

const box = (root: HTMLElement) =>
  root.querySelector<HTMLInputElement>('form[action="?/updateRegisterDefaults"] input[name="mentionOnly"]');

describe('agent Settings — register default (#942)', () => {
  it('shows the saved default, and the help line follows the checkbox', async () => {
    const root = await mountSettings({ data: await pageData('a', { mentionOnly: true }), form: null });
    expect(box(root)!.checked).toBe(true);
    expect(root.textContent).toContain('New installs count only messages that mention this agent.');

    box(root)!.click();
    flushSync();
    expect(box(root)!.checked).toBe(false);
    expect(root.textContent).toContain('New installs count every message in the default channel.');
  });

  it('a failed read shows "could not load" and offers no control, rather than an unchecked box', async () => {
    const root = await mountSettings({ data: await pageData('a', null), form: null });
    expect(box(root)).toBeNull();
    expect(root.textContent).toContain('The current setting could not be loaded.');
  });

  it('navigating to another agent re-seeds the box, even an edited one: A’s value never posts to B', async () => {
    const props = reactiveProps({ data: await pageData('a', { mentionOnly: false }), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    box(root)!.click(); // an unsaved edit on A
    flushSync();
    expect(box(root)!.checked).toBe(true);

    props.data = await pageData('b', { mentionOnly: false });
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(false);
  });

  /**
   * SvelteKit's sequence after a successful enhanced submit: invalidateAll
   * re-runs the loader (new `data`), then applyAction puts the action's result
   * on `page.form`, which is where superforms picks it up. Both are replayed.
   */
  async function afterSuccessfulSave(props: Record<string, unknown>, saved: boolean) {
    props.data = await pageData('a', { mentionOnly: saved });
    flushSync();
    await tick();
    const result = await superValidate(
      { _kind: 'registerDefaults', mentionOnly: saved },
      zod4(agentRegisterDefaultsSchema),
    );
    result.message = { type: 'success', text: 'Saved. Future installs use this.' };
    page.update((p) => ({ ...p, status: 200, form: { form: result } }));
    flushSync();
    await tick();
  }

  it('after a successful save the box shows the SAVED value, not the page-load one (#971 QA)', async () => {
    for (const loaded of [false, true]) {
      const props = reactiveProps({ data: await pageData('a', { mentionOnly: loaded }), form: null } as Record<string, unknown>);
      const root = await mountSettings(props);
      box(root)!.click();
      flushSync();
      await afterSuccessfulSave(props, !loaded);
      expect(box(root)!.checked).toBe(!loaded);
      expect(root.textContent).toContain('Saved. Future installs use this.');
      expect(root.textContent).toContain(!loaded
        ? 'New installs count only messages that mention this agent.'
        : 'New installs count every message in the default channel.');
      mounted.pop()!.unmount();
      resetStubPage();
    }
  });

  it('editing again after a save clears "Saved", which no longer describes the box (#971 Codex P2)', async () => {
    const props = reactiveProps({ data: await pageData('a', { mentionOnly: false }), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    box(root)!.click();
    flushSync();
    await afterSuccessfulSave(props, true);
    expect(root.textContent).toContain('Saved. Future installs use this.');

    box(root)!.click(); // a second, unsaved edit
    flushSync();
    expect(box(root)!.checked).toBe(false);
    expect(root.textContent).not.toContain('Saved. Future installs use this.');
  });

  it('an unsaved change survives a reload caused by another form on the page (#971 Codex P2)', async () => {
    const props = reactiveProps({ data: await pageData('a', { mentionOnly: false }), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    box(root)!.click(); // edited, not saved
    flushSync();

    // e.g. the Agent form saved: the loader re-reads the SAME agent, default unchanged.
    props.data = await pageData('a', { mentionOnly: false });
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(true);
  });

  it('a failed full-page (no-JS) save keeps the attempted value beside its error (#971 Codex P2)', async () => {
    const failed = await superValidate(
      { _kind: 'registerDefaults', mentionOnly: true },
      zod4(agentRegisterDefaultsSchema),
    );
    failed.message = { type: 'error', text: 'The default was not saved. Changing it needs the agent’s owner or an organization admin.' };
    // Stored value is false; the user tried to save true and was refused.
    const root = await mountSettings({ data: await pageData('a', { mentionOnly: false }), form: { form: failed } });
    expect(root.textContent).toContain('The default was not saved.');
    expect(box(root)!.checked).toBe(true);
  });

  it('a full-page submission opens Settings by itself, so its result is visible (#971 Codex P2)', async () => {
    const failed = await superValidate(
      { _kind: 'registerDefaults', mentionOnly: true },
      zod4(agentRegisterDefaultsSchema),
    );
    failed.message = { type: 'error', text: 'The default was not saved. Changing it needs the agent’s owner or an organization admin.' };
    // Mounted WITHOUT clicking the Settings tab.
    const m = mountComponent(Page as never, { data: await pageData('a', { mentionOnly: false }), form: { form: failed } } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick();
    flushSync();
    expect(box(m.target)!.checked).toBe(true);
    expect(m.target.textContent).toContain('The default was not saved.');
  });

  it('a clean form still follows the server when the same agent is re-read', async () => {
    const props = reactiveProps({ data: await pageData('a', { mentionOnly: false }), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    props.data = await pageData('a', { mentionOnly: true }); // changed elsewhere
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(true);
  });
});
