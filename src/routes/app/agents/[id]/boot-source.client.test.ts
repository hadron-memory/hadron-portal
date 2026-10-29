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
async function open(bootSource: BootSourceView, canManageAgent: boolean | null = true) {
  const data = await pageData('a', { mentionOnly: false }, { systemPrompt: 'LEGACY FIELD TEXT' });
  const src = bootSource.mode === 'source' ? bootSource.node : null;
  const bootSourceForm = await superValidate({ nodeId: src?.id ?? '', content: src?.content ?? '', expectedRevision: src?.revision ?? 1 }, zod4(bootSourceSchema), { id: 'bootSource:a', errors: false });
  mounted = mountComponent(Page as never, { data: { ...data, canManageAgent, bootSource, bootSourceForm }, form: null } as never) as Mounted<Record<string, unknown>>;
  await tick();
  [...mounted.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Boot prompt')!.click();
  await tick();
  return mounted.target;
}
const compiledView = (over: Record<string, unknown> = {}) => ({ id: 'c1', urn: 'hrn:node:ada:sys:boot:compiled', revision: 2, content: 'COMPILED TEXT', approvedRevision: 2, pending: false, lint: null, ...over });
const source = (approvedRevision: number | null = 2, compiled: Record<string, unknown> | null = {}): BootSourceView => ({ mode: 'source', node: { id: 'n1', urn: 'hrn:node:ada:sys:boot:source', revision: 3, content: SOURCE }, compiled: compiled && compiledView({ approvedRevision, ...compiled }) } as BootSourceView);
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

  it('offers Update the prompt workers get, disabled while the draft is unsaved', async () => {
    const root = await open(source());
    const btn = () => [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Update the prompt workers get')!;
    expect(btn().disabled).toBe(false);
    const ta = area(root)!;
    ta.value = 'changed'; ta.dispatchEvent(new Event('input', { bubbles: true }));
    await tick();
    expect(btn().disabled).toBe(true);
    expect(root.textContent).toContain('Save your changes first.');
  });
  it('shows the pending revision, its exact text, lint and an Approve bound to that revision', async () => {
    const lint = { items: [{ kind: 'BROKEN_INCLUDE', position: 4, text: 'Include at 4 does not resolve', targetUrn: null, pinnedRevision: null, newerRevision: null, workerField: null }], total: 3, nextCursor: 'c' };
    const root = await open(source(2, { revision: 5, pending: true, content: 'PENDING <b>bytes</b>', lint }));
    const panel = root.querySelector('[data-boot-approve]')!;
    expect(panel.textContent).toContain('Revision 5 is ready but not approved. Workers still get revision 2.');
    expect(panel.querySelector('[data-boot-compiled]')?.textContent).toBe('PENDING <b>bytes</b>');
    expect(panel.querySelector('b')).toBeNull();
    expect(panel.querySelector('[data-boot-lint]')?.textContent).toContain('Warnings (3)');
    expect(panel.textContent).toContain('2 more');
    expect([...panel.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Approve')).toBe(true);
  });
  it('shows no Approve panel or lint when nothing is pending', async () => {
    const root = await open(source());
    expect(root.querySelector('[data-boot-approve]')).toBeNull();
    expect(root.querySelector('[data-boot-lint]')).toBeNull();
  });
  it('a non-manager gets neither Update nor Approve', async () => {
    const root = await open(source(2, { pending: true, revision: 5 }), false);
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Update the prompt workers get');
    expect(labels).not.toContain('Approve');
    expect(root.querySelector('[data-boot-approve]')).not.toBeNull();
  });
});
