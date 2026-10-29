import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import type { BootSourceView } from '$lib/server/boot-source';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import { bootApproveSchema, bootSourceSchema } from './schema';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const SOURCE = '# Boot\n{{> policies:conduct}}\n';
async function open(bootSource: BootSourceView, canManageAgent: boolean | null = true, actionForm: unknown = null) {
  const data = await pageData('a', { mentionOnly: false }, { systemPrompt: 'LEGACY FIELD TEXT' });
  const src = bootSource.mode === 'source' ? bootSource.node : null;
  const bootSourceForm = await superValidate({ nodeId: src?.id ?? '', content: src?.content ?? '', expectedRevision: src?.revision ?? 1 }, zod4(bootSourceSchema), { id: 'bootSource:a', errors: false });
  mounted = mountComponent(Page as never, { data: { ...data, canManageAgent, bootSource, bootSourceForm }, form: actionForm } as never) as Mounted<Record<string, unknown>>;
  await tick();
  [...mounted.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Boot prompt')!.click();
  await tick();
  return mounted.target;
}
const compiledLite = (approvedRevision: number | null, over: Record<string, unknown> = {}) => ({ id: 'c1', urn: 'hrn:node:ada:sys:boot:compiled', revision: 2, content: 'COMPILED TEXT', approvedRevision, pending: false, lint: null, ...over });
const source = (approvedRevision: number | null = 2, compiled: ReturnType<typeof compiledLite> | null | undefined = undefined, over: Record<string, unknown> = {}): BootSourceView => ({ mode: 'source', node: { id: 'n1', urn: 'hrn:node:ada:sys:boot:source', revision: 3, content: SOURCE }, compiled: compiled === undefined ? compiledLite(approvedRevision, over) : compiled });
const area = (root: HTMLElement) => root.querySelector<HTMLTextAreaElement>('[data-boot-prompt-source] textarea');

describe('portal#1377 S1 boot prompt tab modes', () => {
  it('with a pointer, edits the source text and not the legacy field', async () => {
    const root = await open(source());
    expect(area(root)?.value).toBe(SOURCE);
    expect(root.textContent).not.toContain('LEGACY FIELD TEXT');
    expect(root.querySelector<HTMLInputElement>('input[name=expectedRevision]')?.value).toBe('3');
    expect(root.querySelector('[data-boot-prompt-source] button[type=submit]')).not.toBeNull();
  });
  it('says workers get the approved compiled revision, or none yet', async () => {
    expect((await open(source(2))).textContent).toContain('revision 2');
    mounted?.unmount();
    expect((await open(source(null))).textContent).toContain('No compiled revision is approved yet');
  });
  it('without a pointer, keeps the legacy editor and labels it', async () => {
    const root = await open({ mode: 'legacy' });
    expect(root.textContent).toContain('legacy prompt field');
    expect(root.querySelector('[data-boot-prompt]')).not.toBeNull();
    expect(root.querySelector('[data-boot-prompt-source]')).toBeNull();
  });
  it('a failed pointer or source read renders no editor and never falls back to the legacy field', async () => {
    const root = await open({ mode: 'unknown' });
    expect(root.querySelector('[data-boot-prompt] textarea, [data-boot-prompt-source] textarea')).toBeNull();
    expect(root.textContent).not.toContain('LEGACY FIELD TEXT');
    expect(root.querySelector('[role=alert]')?.textContent).toContain('could not be loaded');
  });
  it.each(['source-missing', 'source-unreadable'] as const)('%s renders no editor', async (mode) => {
    const root = await open({ mode });
    expect(root.querySelector('textarea[name=content], textarea[name=systemPrompt]')?.closest('[data-boot-prompt-source], [data-boot-prompt]')).toBeFalsy();
  });
  it('a non-manager gets a read-only source and no Save', async () => {
    const root = await open(source(), false);
    expect(area(root)?.readOnly).toBe(true);
    expect(root.querySelector('[data-boot-prompt-source] button[type=submit]')).toBeNull();
  });

  it('an unreadable compiled node says so and never claims there is no approval', async () => {
    const root = await open(source(null, null));
    expect(root.textContent).toContain('Couldn’t load the approval status');
    expect(root.textContent).not.toContain('No compiled revision is approved');
    expect(root.textContent).not.toContain('not served');
    expect(area(root)?.value).toBe(SOURCE);
  });
  it('a withheld source with a readable compiled node shows the compiled text read-only, never systemPrompt, never a write', async () => {
    const root = await open({ mode: 'compiled-only', compiled: compiledLite(2) });
    expect(root.querySelector('[data-boot-compiled-only]')?.textContent).toContain('COMPILED TEXT');
    expect(root.textContent).not.toContain('LEGACY FIELD TEXT');
    expect(root.querySelector('textarea[name=content], textarea[name=systemPrompt]')).toBeNull();
    expect(root.querySelector('[data-boot-compiled-only] form, [data-boot-compiled-only] button[type=submit]')).toBeNull();
  });
  it('after a successful save the next save carries the refreshed revision, not the one before the save', async () => {
    // What the page passes after save 1: the loader already moved to revision 4, the action data is still the posted revision-3 form.
    const posted = await superValidate({ nodeId: 'n1', content: 'old text', expectedRevision: 3 }, zod4(bootSourceSchema), { id: 'bootSource:a', errors: false });
    posted.message = { type: 'success', text: 'Source saved. Workers get nothing new until it is compiled and approved.' };
    const fresh: BootSourceView = { mode: 'source', node: { id: 'n1', urn: 'hrn:node:ada:sys:boot:source', revision: 4, content: 'refreshed text' }, compiled: compiledLite(2) };
    const root = await open(fresh, true, { form: posted });
    expect(root.querySelector<HTMLInputElement>('input[name=expectedRevision]')?.value).toBe('4');
    expect(area(root)?.value).toBe('refreshed text');
    expect(root.textContent).toContain('Source saved.');
  });
  it('a refused save keeps its draft and the revision it was written against', async () => {
    const posted = await superValidate({ nodeId: 'n1', content: 'my draft', expectedRevision: 3 }, zod4(bootSourceSchema), { id: 'bootSource:a', errors: false });
    posted.message = { type: 'error', text: 'Someone changed the source since you opened it.' };
    const root = await open(source(2), true, { form: posted });
    expect(area(root)?.value).toBe('my draft');
    expect(root.querySelector<HTMLInputElement>('input[name=expectedRevision]')?.value).toBe('3');
  });
  it('the enabled Save label is dark on amber, not white (contrast)', async () => {
    const root = await open(source());
    const save = root.querySelector<HTMLButtonElement>('[data-boot-prompt-source] button[type=submit]')!;
    expect(save.className).toContain('text-zinc-950');
    expect(save.className).not.toContain('text-white');
  });
  it('offers Update the prompt workers get, disabled while the draft is unsaved', async () => {
    const root = await open(source());
    const btn = () => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Update the prompt workers get')!;
    expect(btn().disabled).toBe(false);
    const ta = area(root)!;
    ta.value = 'changed'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(btn().disabled).toBe(true);
    expect(root.textContent).toContain('Save your changes first.');
    expect(btn().getAttribute('aria-describedby')).toBe('bootSaveFirst');
    expect(root.querySelector('#bootSaveFirst')?.textContent).toContain('Save your changes first.');
  });
  it('shows the pending revision, its exact text, lint and an Approve bound to that revision', async () => {
    const lint = { items: [{ kind: 'BROKEN_INCLUDE', position: 4, text: 'Include at 4 does not resolve', targetUrn: null, pinnedRevision: null, newerRevision: null, workerField: null }], total: 3, nextCursor: 'c' };
    const root = await open(source(2, undefined, { revision: 5, pending: true, content: 'PENDING <b>bytes</b>', lint }));
    const panel = root.querySelector('[data-boot-approve]')!;
    expect(panel.textContent).toContain('Revision 5 is ready but not approved. Workers still get revision 2.');
    const pre = panel.querySelector<HTMLElement>('[data-boot-compiled]')!;
    expect(pre.textContent).toBe('PENDING <b>bytes</b>');
    expect(pre.getAttribute('tabindex')).toBe('0');
    expect(panel.querySelector('b')).toBeNull();
    expect(panel.querySelector('[data-boot-lint]')?.textContent).toContain('Warnings (3)');
    expect(panel.textContent).toContain('2 more');
    const approve = [...panel.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Approve')!;
    expect(approve.className).toContain('text-zinc-950');
    expect(approve.className).not.toContain('text-white');
  });
  it('says so when a newer compiled revision has the same text as the approved one', async () => {
    const root = await open(source(2, undefined, { revision: 4, pending: false }));
    expect(root.querySelector('[data-boot-unchanged]')?.textContent).toContain('Revision 4 has the same text as revision 2');
    expect(root.querySelector('[data-boot-approve]')).toBeNull();
  });
  it('shows no Approve panel or lint when nothing is pending', async () => {
    const root = await open(source());
    expect(root.querySelector('[data-boot-approve]')).toBeNull();
    expect(root.querySelector('[data-boot-lint]')).toBeNull();
  });
  it('a non-manager gets neither Update nor Approve', async () => {
    const root = await open(source(2, undefined, { pending: true, revision: 5 }), false);
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Update the prompt workers get');
    expect(labels).not.toContain('Approve');
    expect(root.querySelector('[data-boot-approve]')).not.toBeNull();
  });
  it('the read-only compiled text can be scrolled by keyboard', async () => {
    const root = await open({ mode: 'compiled-only', compiled: compiledLite(2) });
    expect(root.querySelector('[data-boot-compiled-only] pre')?.getAttribute('tabindex')).toBe('0');
  });

  // The page after a loader refresh that moves only the COMPILED revision (compile, approve, mismatch reload).
  async function refreshable(canManageAgent = true) {
    const { reactiveProps } = await import('$lib/test/reactiveProps.svelte');
    const base = await pageData('a', { mentionOnly: false }, { systemPrompt: 'LEGACY FIELD TEXT' });
    const view = (compiledRevision: number): BootSourceView => ({ mode: 'source', node: { id: 'n1', urn: 'hrn:node:ada:sys:boot:source', revision: 3, content: SOURCE }, compiled: compiledLite(2, { id: `c${compiledRevision}`, revision: compiledRevision, pending: true, content: `compiled ${compiledRevision}` }) } as BootSourceView);
    const bootSourceForm = await superValidate({ nodeId: 'n1', content: SOURCE, expectedRevision: 3 }, zod4(bootSourceSchema), { id: 'bootSource:a', errors: false });
    const approveForm = async (rev: number) => superValidate({ nodeId: `c${rev}`, revision: rev }, zod4(bootApproveSchema), { id: 'bootApprove:a', errors: false });
    const props = reactiveProps({ data: { ...base, canManageAgent, bootSource: view(5), bootSourceForm, bootApproveForm: await approveForm(5) }, form: null } as Record<string, unknown>);
    mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    await tick(5);
    [...mounted.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Boot prompt')!.click();
    await tick();
    const refresh = async (rev: number, form: unknown = props.form) => {
      props.data = { ...(props.data as Record<string, unknown>), bootSource: view(rev), bootApproveForm: await approveForm(rev) };
      props.form = form;
      await tick(5);
    };
    return { root: mounted.target, refresh, approveForm };
  }
  const hidden = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement>(`[data-boot-approve] input[name=${name}]`)?.value;

  it.each([
    ['a mismatch reload', 'error', 'Someone updated the prompt after you opened it.'],
    ['a successful approval followed by a new compile', 'success', 'Revision 5 approved.'],
  ])('Approve follows the displayed compiled revision after %s', async (_n, type, text) => {
    // The posted result survives the loader refresh (its revision is the old one); the panel must still bind to the displayed one.
    const { root, refresh, approveForm } = await refreshable();
    expect(hidden(root, 'revision')).toBe('5');
    const posted = await approveForm(5);
    posted.message = { type: type as 'error' | 'success', text };
    await refresh(6, { form: posted });
    expect(root.querySelector('[data-boot-compiled]')?.textContent).toBe('compiled 6');
    expect(hidden(root, 'revision')).toBe('6');
    expect(hidden(root, 'nodeId')).toBe('c6');
  });
  it('a compiled-only refresh keeps a dirty source draft', async () => {
    const { root, refresh } = await refreshable();
    const ta = area(root)!;
    ta.value = 'my unsaved draft'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    await refresh(6);
    expect(area(root)?.value).toBe('my unsaved draft');
    expect(root.querySelector('[data-boot-compiled]')?.textContent).toBe('compiled 6');
  });

  // Cameron's QA P2: a draft typed while a compile is pending was replaced by the saved source
  // when the response reloaded the page. Drives the real enhanced submit, not a props swap.
  it('editing is blocked while a compile is in flight and returns with the response', async () => {
    const { submitEnhancedDeferred } = await import('$lib/test/stubs/app-forms');
    const { setStubPage, resetStubPage } = await import('$lib/test/stubs/app-stores');
    setStubPage('http://localhost/app/agents/a');
    try {
      const root = await open(source());
      const compileForm = root.querySelector<HTMLFormElement>('form[action="?/compileBootPrompt"]')!;
      const pending = await submitEnhancedDeferred(compileForm);
      await tick();
      expect(area(root)!.readOnly).toBe(true);
      expect(area(root)!.getAttribute('aria-busy')).toBe('true');
      const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-boot-prompt-source] form[action="?/saveBootSource"] button')];
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((b) => b.disabled)).toBe(true);
      await pending.finish({ type: 'success', status: 200, data: { form: { id: 'bootCompile:a', valid: true, posted: true, errors: {}, data: { _kind: 'bootCompile' }, message: { type: 'success', text: 'Built revision 6.' } } } });
      await tick(5);
      expect(area(root)!.readOnly).toBe(false);
      expect(buttons.some((b) => b.disabled)).toBe(false);
    } finally { resetStubPage(); }
  });
  it('editing is blocked while an approval is in flight too', async () => {
    const { submitEnhancedDeferred } = await import('$lib/test/stubs/app-forms');
    const { setStubPage, resetStubPage } = await import('$lib/test/stubs/app-stores');
    setStubPage('http://localhost/app/agents/a');
    try {
      const root = await open(source(2, undefined, { revision: 5, pending: true }));
      const pending = await submitEnhancedDeferred(root.querySelector<HTMLFormElement>('form[action="?/approveBootPrompt"]')!);
      await tick();
      expect(area(root)!.readOnly).toBe(true);
      await pending.finish({ type: 'success', status: 200, data: { form: { id: 'bootApprove:a', valid: true, posted: true, errors: {}, data: { _kind: 'bootApprove' }, message: { type: 'success', text: 'Revision 5 approved.' } } } });
      await tick(5);
      expect(area(root)!.readOnly).toBe(false);
    } finally { resetStubPage(); }
  });
});
