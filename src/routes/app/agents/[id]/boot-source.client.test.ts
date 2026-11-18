import { afterEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import type { BootSourceView } from '$lib/server/boot-source';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import { bootApproveSchema, bootStartSchema } from './schema';

let mounted: Mounted<Record<string, unknown>> | null = null;
afterEach(() => { mounted?.unmount(); mounted = null; });

const SOURCE = '# Boot\n{{> policies:conduct}}\n';
async function open(bootSource: BootSourceView, canManageAgent: boolean | null = true, actionForm: unknown = null) {
  const data = await pageData('a', { mentionOnly: false }, { systemPrompt: 'LEGACY FIELD TEXT' });
  const bootStartForm = await superValidate({}, zod4(bootStartSchema), { id: 'bootStart:a', errors: false });
  mounted = mountComponent(Page as never, { data: { ...data, canManageAgent, bootSource, bootStartForm }, form: actionForm } as never) as Mounted<Record<string, unknown>>;
  await tick();
  [...mounted.target.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Boot prompt')!.click();
  await tick();
  return mounted.target;
}
const compiledLite = (approvedRevision: number | null, over: Record<string, unknown> = {}) => ({ id: 'c1', urn: 'hrn:node:ada:sys:boot:compiled', memoryId: 'sys', revision: 2, content: 'COMPILED TEXT', approvedRevision, pending: false, lint: null, ...over });
const APPROVAL = { state: 'NOT_APPROVED' as const, tone: 'neutral' as const, approval: null, canApprove: true };
const srcNode = (id = 'n1', revision = 3, content = SOURCE) => ({ id, urn: 'hrn:node:ada:sys:boot:source', memoryId: 'sys', revision, content, approval: APPROVAL });
const source = (approvedRevision: number | null = 2, compiled: ReturnType<typeof compiledLite> | null | undefined = undefined, over: Record<string, unknown> = {}): BootSourceView => ({ mode: 'source', node: srcNode(), compiled: compiled === undefined ? compiledLite(approvedRevision, over) : compiled });

describe('portal#1377 S1 boot prompt tab modes', () => {
  it('with a pointer, shows the source workflow and not the legacy field', async () => {
    const root = await open(source());
    expect(root.querySelector('[data-boot-prompt-source] [data-boot-steps]')).not.toBeNull();
    expect(root.querySelector('[data-boot-prompt-source] a[data-boot-edit]')?.getAttribute('href')).toBe('/app/memories/sys/nodes/n1');
    expect(root.textContent).not.toContain('LEGACY FIELD TEXT');
  });
  it('says which compiled revision is approved and ready to serve, or none yet', async () => {
    expect((await open(source(2))).textContent).toContain('Revision 2 is approved and ready to serve.');
    mounted?.unmount();
    expect((await open(source(null))).textContent).toContain('No compiled revision is approved yet');
  });
  it('without a pointer, offers no retired prompt editor', async () => {
    const root = await open({ mode: 'legacy', canStart: false });
    expect(root.textContent).toContain('no boot prompt source yet');
    expect(root.querySelector('[data-boot-prompt]')).toBeNull();
    expect(root.querySelector('[data-boot-prompt-source]')).toBeNull();
  });
  it('a failed pointer or source read renders no editor and never falls back to the legacy field', async () => {
    const root = await open({ mode: 'unknown' });
    expect(root.querySelector('[data-boot-prompt] textarea, [data-boot-prompt-source] textarea')).toBeNull();
    expect(root.textContent).not.toContain('LEGACY FIELD TEXT');
    expect(root.querySelector('[role=alert]')?.textContent).toContain('could not be loaded');
  });
  it.each([{ mode: 'source-missing', compiled: null, canStart: false }, { mode: 'source-unreadable' }] as BootSourceView[])('$mode renders no editor', async (view) => {
    const root = await open(view);
    expect(root.querySelector('textarea[name=content], textarea[name=systemPrompt]')?.closest('[data-boot-prompt-source], [data-boot-prompt]')).toBeFalsy();
  });
  it('an unreadable compiled node says so and never claims there is no approval', async () => {
    const root = await open(source(null, null));
    expect(root.textContent).toContain('Couldn’t load the approval status');
    expect(root.textContent).not.toContain('No compiled revision is approved');
    expect(root.textContent).not.toContain('not served');
    expect(root.querySelector('[data-boot-prompt-source] [data-boot-steps]')).not.toBeNull();
  });
  it('a withheld source with a readable compiled node shows the compiled text read-only, never systemPrompt, never a write', async () => {
    const root = await open({ mode: 'compiled-only', compiled: compiledLite(2) });
    expect(root.querySelector('[data-boot-compiled-only]')?.textContent).toContain('COMPILED TEXT');
    expect(root.textContent).not.toContain('LEGACY FIELD TEXT');
    expect(root.querySelector('textarea[name=content], textarea[name=systemPrompt]')).toBeNull();
    expect(root.querySelector('[data-boot-compiled-only] form, [data-boot-compiled-only] button[type=submit]')).toBeNull();
  });
  it('shows the pending revision, its exact text, lint and an Approve bound to that revision', async () => {
    const lint = { items: [{ kind: 'BROKEN_INCLUDE', position: 4, text: 'Include at 4 does not resolve', targetUrn: null, pinnedRevision: null, newerRevision: null, workerField: null }], total: 3, nextCursor: 'c' };
    const root = await open(source(2, undefined, { revision: 5, pending: true, content: 'PENDING <b>bytes</b>', lint }));
    const panel = root.querySelector('[data-boot-approve]')!;
    expect(root.querySelector('[data-boot-step="approve"]')?.textContent).toContain('Revision 5 is ready but not approved. Workers still get revision 2.');
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
  it('a non-manager gets neither Compile nor Approve', async () => {
    const root = await open(source(2, undefined, { pending: true, revision: 5 }), false);
    const labels = [...root.querySelectorAll('button')].map((b) => b.textContent?.trim());
    expect(labels).not.toContain('Compile');
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
    const view = (compiledRevision: number): BootSourceView => ({ mode: 'source', node: srcNode(), compiled: compiledLite(2, { id: `c${compiledRevision}`, revision: compiledRevision, pending: true, content: `compiled ${compiledRevision}` }) } as BootSourceView);
    const approveForm = async (rev: number) => superValidate({ nodeId: `c${rev}`, revision: rev }, zod4(bootApproveSchema), { id: 'bootApprove:a', errors: false });
    const props = reactiveProps({ data: { ...base, canManageAgent, bootSource: view(5), bootApproveForm: await approveForm(5) }, form: null } as Record<string, unknown>);
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
  it('the real enhanced Approve form submits the revision displayed after a loader refresh', async () => {
    const { submitEnhanced } = await import('$lib/test/stubs/app-forms');
    const { setStubPage, resetStubPage } = await import('$lib/test/stubs/app-stores');
    setStubPage('http://localhost/app/agents/a');
    try {
      const { root, refresh } = await refreshable();
      await refresh(6);
      const form = root.querySelector<HTMLFormElement>('form[action="?/approveBootPrompt"]')!;
      expect(new FormData(form).get('nodeId')).toBe('c6');
      expect(new FormData(form).get('revision')).toBe('6');
      const submission = await submitEnhanced(form, true);
      expect(submission.cancelled).toBe(false);
      expect(submission.formData.get('nodeId')).toBe('c6');
      expect(submission.formData.get('revision')).toBe('6');
    } finally { resetStubPage(); }
  });
});

describe('portal#1378 Start a source', () => {
  const start = (root: HTMLElement) => root.querySelector<HTMLElement>('[data-boot-start]');
  const startButton = (root: HTMLElement) => [...(start(root)?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((b) => b.textContent?.trim() === 'Start a source');
  it('case 1 (pointer set, source gone) offers Start, which posts straight to startBootSource with no mode and no seed field', async () => {
    const root = await open({ mode: 'source-missing', compiled: compiledLite(2), canStart: true });
    expect(start(root)?.textContent).toContain('no source to edit');
    expect(startButton(root)?.type).toBe('submit');
    const form = start(root)!.querySelector('form')!;
    expect(form.getAttribute('action')).toBe('?/startBootSource');
    expect([...form.querySelectorAll('input')].map((i) => i.name)).toEqual(['_kind']);
    expect(root.querySelector('textarea[name=content], textarea[name=systemPrompt]')).toBeNull();
  });
  it('case 2 (no pointer) offers Start without a retired editor and asks before starting', async () => {
    const root = await open({ mode: 'legacy', canStart: true });
    expect(root.querySelector('[data-boot-prompt]')).toBeNull();
    expect(root.textContent).not.toContain('LEGACY FIELD TEXT');
    expect(start(root)?.querySelector('[data-boot-start-confirm]')).toBeNull();
    expect(startButton(root)?.type).toBe('button');
    startButton(root)!.click();
    await tick();
    expect(start(root)?.querySelector('[data-boot-start-confirm]')?.textContent).toContain('workers can be served it');
    expect(start(root)?.querySelector('[data-boot-start-confirm]')?.textContent).not.toMatch(/legacy/i);
    expect(startButton(root)?.type).toBe('submit');
    [...start(root)!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Cancel')!.click();
    await tick();
    expect(start(root)?.querySelector('[data-boot-start-confirm]')).toBeNull();
  });
  it('a non-manager is not offered the action', async () => {
    for (const view of [{ mode: 'legacy', canStart: true }, { mode: 'source-missing', compiled: null, canStart: true }] as BootSourceView[]) {
      const root = await open(view, false);
      expect(start(root)).not.toBeNull();
      expect(start(root)?.querySelector('form')).toBeNull();
      mounted?.unmount();
    }
  });
  it('both Start mounts are keyed on the form identity, so one Agent\'s refusal never shows under the next Agent', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync('src/routes/app/agents/[id]/+page.svelte', 'utf8');
    const mounts = page.match(/<StartBootSource /g) ?? [];
    const keyed = page.match(/\{#key data\.bootStartForm\.id\}<StartBootSource [^]*?\/>\{\/key\}/g) ?? [];
    expect(mounts.length).toBe(2);
    expect(keyed.length).toBe(2);
  });
  it('no Start when the loader could not tell the source is absent', async () => {
    expect(start(await open({ mode: 'legacy', canStart: false }))).toBeNull();
  });
  it('a started source for a pointer-less Agent says it has not been compiled, not that its approval is unknown', async () => {
    const root = await open({ mode: 'source', node: srcNode('n1', 1, ''), compiled: null, noPointer: true });
    expect(root.textContent).toContain('has not been compiled yet');
    expect(root.textContent).not.toContain('Couldn’t load the approval status');
    expect(start(root)).toBeNull();
  });
});


async function agentSourceData(id: string, content: string) {
  const data = await pageData(id, null, { systemPrompt: 'RETIRED' });
  return { ...data, bootSource: { mode: 'source' as const, node: srcNode(`source-${id}`, 3, content), compiled: compiledLite(2) } };
}

it('points the workflow at the new Agent\'s source when navigating between Agents', async () => {
  const { reactiveProps } = await import('$lib/test/reactiveProps.svelte');
  const props = reactiveProps({ data: await agentSourceData('a', 'Agent A source'), form: null } as Record<string, unknown>);
  mounted = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick(5);
  const root = mounted.target;
  [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Boot prompt')!.click();
  await tick();
  const edit = () => root.querySelector('[data-boot-prompt-source] a[data-boot-edit]')?.getAttribute('href');
  expect(edit()).toBe('/app/memories/sys/nodes/source-a');
  props.data = await agentSourceData('b', 'Agent B source');
  await tick(5);
  expect(edit()).toBe('/app/memories/sys/nodes/source-b');
});
