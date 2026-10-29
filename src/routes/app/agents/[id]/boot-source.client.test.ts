import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import type { BootSourceView } from '$lib/server/boot-source';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import { bootSourceSchema } from './schema';

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
const compiledLite = (approvedRevision: number | null) => ({ urn: 'hrn:node:ada:sys:boot:compiled', revision: 2, content: 'COMPILED TEXT', approvedRevision });
const source = (approvedRevision: number | null = 2, compiled: ReturnType<typeof compiledLite> | null | undefined = undefined): BootSourceView => ({ mode: 'source', node: { id: 'n1', urn: 'hrn:node:ada:sys:boot:source', revision: 3, content: SOURCE }, compiled: compiled === undefined ? compiledLite(approvedRevision) : compiled });
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
});
