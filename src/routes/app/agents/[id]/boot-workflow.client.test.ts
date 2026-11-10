// portal#1485: the Boot prompt tab is instructions, a four-step workflow and status.
// The source is edited on its own node page; the tab keeps Compile and Approve.
import { afterEach, describe, expect, it } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { navigationCalls, resetNavigationCalls } from '$lib/test/stubs/app-navigation';
import type { BootSourceView, CompiledView, LintItem } from '$lib/server/boot-source';
import Page from './+page.svelte';
import { pageData } from './page-fixture';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; resetNavigationCalls(); });

const recompile: LintItem = { kind: 'RECOMPILE_AVAILABLE', position: 0, text: 'A newer revision of the source exists', targetUrn: null, pinnedRevision: 3, newerRevision: 4, workerField: null };
const compiled = (over: Partial<CompiledView> = {}): CompiledView => ({
  id: 'c1', urn: 'hrn:node:ada:sys:boot:compiled', memoryId: 'mem-sys', revision: 2, content: 'COMPILED TEXT', approvedRevision: 2, pending: false, lint: null, ...over,
});
const approved = { state: 'APPROVED' as const, tone: 'approved' as const, approval: { revision: 3 } as never, canApprove: false };
const notApproved = { state: 'NOT_APPROVED' as const, tone: 'neutral' as const, approval: null, canApprove: true };
const source = (c: CompiledView | null = compiled(), revision = 3, approval: typeof approved | typeof notApproved = approved): BootSourceView => ({
  mode: 'source', node: { id: 'n1', urn: 'hrn:node:ada:sys:boot:source', memoryId: 'mem-sys', revision, content: '# Boot\n', approval }, compiled: c,
});

async function open(view: BootSourceView, canManageAgent: boolean | null = true) {
  const { reactiveProps } = await import('$lib/test/reactiveProps.svelte');
  const data = await pageData('a', { mentionOnly: false });
  const props = reactiveProps({ data: { ...data, canManageAgent, bootSource: view }, form: null } as Record<string, unknown>);
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  [...mounted.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Boot prompt')!.click();
  await tick();
  const swap = async (next: BootSourceView) => { props.data = { ...(props.data as Record<string, unknown>), bootSource: next }; await tick(5); };
  return { root: mounted.target, swap };
}
const tab = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-boot-prompt-source]')!;
const step = (root: HTMLElement, name: string) => tab(root).querySelector<HTMLElement>(`[data-boot-step="${name}"]`);
const buttons = (el: Element | null) => [...(el?.querySelectorAll<HTMLButtonElement>('button') ?? [])].map((b) => b.textContent?.trim());
const outdated = (root: HTMLElement) => tab(root).querySelector('[data-boot-outdated]');

describe('portal#1485 intro and workflow', () => {
  it('opens with what a boot prompt is and links the published docs', async () => {
    const { root } = await open(source());
    const intro = tab(root).querySelector<HTMLElement>('[data-boot-intro]')!;
    expect(intro.textContent).toMatch(/compiled/i);
    const hrefs = [...intro.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toContain('https://docs.hadronmemory.com/reference/compile-boot-prompt/');
    expect(hrefs).toContain('https://docs.hadronmemory.com/reference/boot-prompt-pointers/');
  });
  it('shows the four steps in order', async () => {
    const { root } = await open(source());
    const steps = [...tab(root).querySelectorAll<HTMLElement>('ol[data-boot-steps] > li')].map((li) => li.dataset.bootStep);
    expect(steps).toEqual(['edit', 'review', 'compile', 'approve']);
  });
  it('Edit opens the source node page in a new tab, safely', async () => {
    const { root } = await open(source());
    const a = step(root, 'edit')!.querySelector<HTMLAnchorElement>('a[data-boot-edit]')!;
    expect(a.getAttribute('href')).toBe('/app/memories/mem-sys/nodes/n1');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
    expect(step(root, 'edit')!.textContent).toContain('revision 3');
  });
  it('Approve links to the compiled node page in a new tab', async () => {
    const { root } = await open(source());
    const a = step(root, 'approve')!.querySelector<HTMLAnchorElement>('a[data-boot-compiled-link]')!;
    expect(a.getAttribute('href')).toBe('/app/memories/mem-sys/nodes/c1');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toContain('noopener');
  });
  it('step 2 shows the source approval state and says it is optional', async () => {
    const { root } = await open(source(compiled(), 3, notApproved));
    expect(step(root, 'review')!.textContent).toMatch(/optional/i);
    expect(step(root, 'review')!.textContent).toContain('Not approved');
    expect(step(root, 'review')!.querySelector('a')?.getAttribute('href')).toBe('/app/memories/mem-sys/nodes/n1');
  });
});

describe('portal#1485 no editor in the tab (the action\'s removal is pinned in boot-source-action.test.ts)', () => {
  it('has no textarea, no saveBootSource form and no Save button', async () => {
    const { root } = await open(source());
    expect(tab(root).querySelector('textarea')).toBeNull();
    expect(root.querySelector('form[action="?/saveBootSource"]')).toBeNull();
    expect(buttons(tab(root))).not.toContain('Save');
    expect(buttons(tab(root))).not.toContain('Cancel');
    expect(tab(root).querySelector('[contenteditable]')).toBeNull();
  });
});

describe('portal#1485 Compile', () => {
  it('is enabled for a manager, whatever the source approval says', async () => {
    for (const approval of [approved, notApproved]) {
      const { root } = await open(source(compiled(), 3, approval));
      const btn = [...step(root, 'compile')!.querySelectorAll<HTMLButtonElement>('form[action="?/compileBootPrompt"] button')];
      expect(btn).toHaveLength(1);
      expect(btn[0].disabled).toBe(false);
      expect(btn[0].hasAttribute('aria-describedby')).toBe(false);
      mounted?.unmount(); mounted = null;
    }
  });
});

describe('portal#1485 warnings', () => {
  it('an unapproved compiled revision shows its existing notice once', async () => {
    const { root } = await open(source(compiled({ revision: 5, pending: true, approvedRevision: 2 })));
    const text = tab(root).textContent!;
    const sentence = 'Revision 5 is ready but not approved. Workers still get revision 2.';
    expect(text.split(sentence)).toHaveLength(2);
    expect(buttons(step(root, 'approve'))).toContain('Approve');
  });
  it('no approved revision at all shows the existing notice once', async () => {
    const { root } = await open(source(compiled({ approvedRevision: null, pending: false })));
    expect(tab(root).textContent!.split('No compiled revision is approved yet')).toHaveLength(2);
  });
  it('outdated shows when the compiled lint carries RECOMPILE_AVAILABLE, with nothing pending', async () => {
    const { root } = await open(source(compiled({ lint: { items: [recompile], total: 1, nextCursor: null } })));
    expect(outdated(root)?.textContent).toMatch(/source has changed/i);
    expect(tab(root).querySelector('[data-boot-approve]')).toBeNull();
  });
  it('outdated shows while a revision is pending too', async () => {
    const { root } = await open(source(compiled({ revision: 5, pending: true, lint: { items: [recompile], total: 1, nextCursor: null } })));
    expect(outdated(root)).not.toBeNull();
  });
  it('an approved, current compiled prompt shows neither notice', async () => {
    const { root } = await open(source());
    expect(outdated(root)).toBeNull();
    expect(tab(root).textContent).not.toContain('ready but not approved');
    expect(tab(root).textContent).not.toContain('No compiled revision is approved yet');
    expect(step(root, 'approve')!.textContent).toContain('Revision 2 is approved and ready to serve.');
    expect(tab(root).textContent).not.toMatch(/approved.{0,40}(is live|workers get)/i);
  });
  it('other lint kinds are not an outdated warning', async () => {
    const { root } = await open(source(compiled({ lint: { items: [{ ...recompile, kind: 'BROKEN_INCLUDE' }], total: 1, nextCursor: null } })));
    expect(outdated(root)).toBeNull();
  });
  it('the flow the tab exists for: edit elsewhere, Refresh, and the prompt is outdated', async () => {
    const { root, swap } = await open(source());
    expect(outdated(root)).toBeNull();
    const refresh = [...step(root, 'edit')!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Refresh')!;
    refresh.click();
    await tick(5);
    expect(navigationCalls.map((c) => c.fn)).toContain('invalidateAll');
    // What the reload brings back after the source got revision 4 (approved or not) on its node page.
    await swap(source(compiled({ lint: { items: [recompile], total: 1, nextCursor: null } }), 4, notApproved));
    expect(step(root, 'edit')!.textContent).toContain('revision 4');
    expect(step(root, 'review')!.textContent).toContain('Not approved');
    expect(outdated(root)).not.toBeNull();
  });
});

describe('portal#1485 readers who cannot manage the Agent', () => {
  it('see the intro and the steps, but no Compile or Approve and no outdated warning', async () => {
    // Even if a lint item reached the page, the warning is only for whoever may compile.
    const { root } = await open(source(compiled({ revision: 5, pending: true, lint: { items: [recompile], total: 1, nextCursor: null } })), false);
    expect(tab(root).querySelector('[data-boot-intro]')).not.toBeNull();
    expect(tab(root).querySelectorAll('ol[data-boot-steps] > li')).toHaveLength(4);
    expect(root.querySelector('form[action="?/compileBootPrompt"]')).toBeNull();
    expect(root.querySelector('form[action="?/approveBootPrompt"]')).toBeNull();
    expect(outdated(root)).toBeNull();
  });
});
