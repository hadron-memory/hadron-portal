/**
 * #1275 — the agent Settings tab's "Context reset" switch, mounted.
 *
 * Mirrors register-defaults.client.test.ts (#942/#971): what only a mount can
 * show is that the store is re-seeded when a navigation reuses this component,
 * that a saved value survives the loader re-read, and that a refused no-JS
 * submit keeps the attempted value beside its error
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
import { agentResetContextSchema } from './schema';

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  resetStubPage();
});

const ok = (value: boolean) => ({ kind: 'ok', value }) as const;

async function mountSettings(props: Record<string, unknown>) {
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  const settings = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Settings')!;
  settings.click();
  flushSync();
  return m.target;
}

const FORM = 'form[action="?/updateResetContext"]';
const box = (root: HTMLElement) => root.querySelector<HTMLInputElement>(`${FORM} input[name="resetContextAfterTask"]`);
const save = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(`${FORM} button[type="submit"]`);
const data = (id: string, resetContext: Parameters<typeof pageData>[3]) => pageData(id, { mentionOnly: false }, {}, resetContext);

describe('agent Settings — context reset after a task (#1275)', () => {
  it('shows the server value and says it only takes effect on supporting hosts', async () => {
    const off = await mountSettings({ data: await data('a', ok(false)), form: null });
    expect(box(off)!.checked).toBe(false);
    expect(off.textContent).toContain('only on hosts that support context reset');
    mounted.pop()!.unmount();
    resetStubPage();

    const on = await mountSettings({ data: await data('a', ok(true)), form: null });
    expect(box(on)!.checked).toBe(true);
  });

  it('does not promise a safe or lossless reset, nor use terms still being consolidated', async () => {
    const root = await mountSettings({ data: await data('a', ok(false)), form: null });
    const text = root.querySelector(FORM)!.closest('section')!.textContent!.toLowerCase();
    expect(text).not.toMatch(/safe|lossless|no work is lost|guarantee/);
    expect(text).not.toMatch(/capabilit|outcome|duration|\bshed\b/);
  });

  it('offers Save only once the box differs from the saved value, so an unchanged value sends nothing', async () => {
    const root = await mountSettings({ data: await data('a', ok(false)), form: null });
    expect(save(root)!.disabled).toBe(true);
    box(root)!.click();
    flushSync();
    expect(save(root)!.disabled).toBe(false);
    box(root)!.click(); // back to the saved value
    flushSync();
    expect(save(root)!.disabled).toBe(true);
  });

  it('renders no control and no error while the server has no such field', async () => {
    const root = await mountSettings({ data: await data('a', { kind: 'absent' }), form: null });
    expect(box(root)).toBeNull();
    expect(root.querySelector(FORM)).toBeNull();
    expect(root.textContent).not.toContain('Context reset');
    expect(root.textContent).not.toContain('could not be loaded');
  });

  it('a failed read says so and offers no control, rather than an unchecked box', async () => {
    const root = await mountSettings({ data: await data('a', { kind: 'failed' }), form: null });
    expect(box(root)).toBeNull();
    expect(root.textContent).toContain('Context reset');
    expect(root.textContent).toContain('The current setting could not be loaded.');
  });

  it('navigating to another agent re-seeds the box, even an edited one: A’s value never posts to B', async () => {
    const props = reactiveProps({ data: await data('a', ok(false)), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    box(root)!.click(); // an unsaved edit on A
    flushSync();
    expect(box(root)!.checked).toBe(true);

    props.data = await data('b', ok(false));
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(false);
    expect(save(root)!.disabled).toBe(true);
  });

  async function afterSuccessfulSave(props: Record<string, unknown>, saved: boolean) {
    props.data = await data('a', ok(saved));
    flushSync();
    await tick();
    const result = await superValidate({ _kind: 'resetContext', resetContextAfterTask: saved }, zod4(agentResetContextSchema));
    result.message = { type: 'success', text: 'Saved.' };
    page.update((p) => ({ ...p, status: 200, form: { form: result } }));
    flushSync();
    await tick();
  }

  it('after a successful save the box shows the SAVED value and "Saved."', async () => {
    for (const loaded of [false, true]) {
      const props = reactiveProps({ data: await data('a', ok(loaded)), form: null } as Record<string, unknown>);
      const root = await mountSettings(props);
      box(root)!.click();
      flushSync();
      await afterSuccessfulSave(props, !loaded);
      expect(box(root)!.checked).toBe(!loaded);
      expect(root.textContent).toContain('Saved.');
      expect(save(root)!.disabled).toBe(true);
      mounted.pop()!.unmount();
      resetStubPage();
    }
  });

  it('editing again after a save clears "Saved.", which no longer describes the box', async () => {
    const props = reactiveProps({ data: await data('a', ok(false)), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    box(root)!.click();
    flushSync();
    await afterSuccessfulSave(props, true);
    const section = () => root.querySelector(FORM)!.closest('section')!.textContent;
    expect(section()).toContain('Saved.');

    box(root)!.click();
    flushSync();
    expect(section()).not.toContain('Saved.');
  });

  it('an unsaved change survives a reload caused by another form on the page', async () => {
    const props = reactiveProps({ data: await data('a', ok(false)), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    box(root)!.click();
    flushSync();

    props.data = await data('a', ok(false));
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(true);
  });

  it('a refused full-page (no-JS) save re-renders with the attempted value beside the error, on the Settings tab', async () => {
    const refused = await superValidate({ _kind: 'resetContext', resetContextAfterTask: true }, zod4(agentResetContextSchema));
    refused.message = { type: 'error', text: 'Not saved. Changing this needs the agent’s owner or an organization admin.' };
    // Mounted WITHOUT clicking the Settings tab; the stored value is false.
    const m = mountComponent(Page as never, { data: await data('a', ok(false)), form: { form: refused } } as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    await tick();
    flushSync();
    expect(box(m.target)!.checked).toBe(true);
    expect(m.target.textContent).toContain('Not saved.');
  });

  it('a clean form still follows the server when the same agent is re-read', async () => {
    const props = reactiveProps({ data: await data('a', ok(false)), form: null } as Record<string, unknown>);
    const root = await mountSettings(props);
    props.data = await data('a', ok(true));
    flushSync();
    await tick();
    expect(box(root)!.checked).toBe(true);
  });
});
