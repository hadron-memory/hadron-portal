/**
 * portal#1142 P4 — the Signature and trailer section. Masked null renders "not
 * shown" with no editor; a readable '' renders an empty editor; a template is
 * shown as returned under a "template" label; the variable help is examples,
 * not a closed list; nothing promises the reader may save.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateBriefingSchema, updateSignatureSchema } from './schema';
import Page from './+page.svelte';

const SIG = '— [{{worker.name}}, {{worker.role}}]({{worker.url}}) · {{session.llmModel}}';

function worker(over: Record<string, unknown>) {
  return {
    id: 'w-a', appId: 'app-1', agentId: 'agent-1', name: 'Dara', slug: 'dara',
    urn: 'hrn:worker:hadronmemory.com:team:dara', role: 'engineer',
    promptOverride: null, prompt: null, memoryId: null, retiredAt: null,
    heldByUserId: null, heldAt: null, createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer', systemPrompt: null },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
    reportsToWorkerId: null, reportsToRetired: false, reportsTo: null,
    signature: SIG, trailer: '',
    ...over,
  };
}

const mounted: Mounted<Record<string, unknown>>[] = [];
beforeEach(() => {
  resetNavigationGuards();
  setStubPage('https://example.test/app/workers/w-a?tab=briefing', { id: 'w-a' });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

async function mount(w: ReturnType<typeof worker>, form: unknown = undefined) {
  const m = mountComponent(Page as never, {
    data: {
      worker: w,
      briefingForm: await superValidate({ promptOverride: '' }, zod4(updateBriefingSchema), { errors: false }),
      signatureForm: await superValidate(
        { signature: w.signature ?? '', trailer: w.trailer ?? '', signatureBase: w.signature ?? '', trailerBase: w.trailer ?? '' },
        zod4(updateSignatureSchema),
        { errors: false },
      ),
      initialTab: 'briefing', initialView: null,
      workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
    },
    form,
  } as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return m.target;
}

/** An action result as SvelteKit hands it to the page: the posted form, by its _kind. */
async function actionResult(signature: string, message: { type: 'success' | 'error'; text: string }) {
  const f = await superValidate(
    { _kind: 'updateSignature', signature, trailer: '', signatureBase: 'whatever', trailerBase: '' },
    zod4(updateSignatureSchema),
    { errors: false },
  );
  return { form: { ...f, message } };
}

const section = (t: HTMLElement) => t.querySelector<HTMLElement>('[data-testid="worker-signature"]');

describe('worker page: Signature and trailer (#1142 P4)', () => {
  it('shows each readable template as returned, under a template label', async () => {
    const s = section(await mount(worker({})))!;
    const sig = s.querySelector<HTMLTextAreaElement>('textarea[name="signature"]')!;
    expect(sig.value).toBe(SIG);
    expect(s.querySelector('label[for="workerSignature"]')?.textContent).toMatch(/template/i);
    expect(s.querySelector('label[for="workerTrailer"]')?.textContent).toMatch(/template/i);
  });

  it('a readable empty template is an empty editor, not "not shown"', async () => {
    const s = section(await mount(worker({})))!;
    expect(s.querySelector<HTMLTextAreaElement>('textarea[name="trailer"]')?.value).toBe('');
    expect(s.textContent).not.toMatch(/not shown/i);
  });

  it('a masked template is "not shown", with no editor for it', async () => {
    const s = section(await mount(worker({ signature: null, trailer: null })))!;
    expect(s.querySelector('textarea')).toBeNull();
    expect(s.querySelector('button[type="submit"]')).toBeNull();
    expect(s.textContent).toMatch(/not shown/i);
    expect(s.textContent).not.toMatch(/empty|none set/i);
  });

  it('names variables as examples, not as the complete set', async () => {
    const s = section(await mount(worker({})))!;
    expect(s.textContent).toMatch(/for example/i);
    expect(s.textContent).toContain('{{worker.name}}');
  });

  it('promises nothing about who may save', async () => {
    const s = section(await mount(worker({})))!;
    expect(s.textContent).not.toMatch(/you can (edit|change)|you may/i);
  });

  it('posts to its own action, never the override action', async () => {
    const s = section(await mount(worker({})))!;
    const form = s.querySelector('form')!;
    expect(form.getAttribute('action')).toContain('/updateSignature');
    expect(form.querySelector('[name="promptOverride"]')).toBeNull();
  });

  // Gene's blind P2 on #1157: a SUCCESSFUL earlier save must not seed the
  // editor over the fresher stored value on a remount (leaving and reopening
  // the tab keeps the action result); a FAILED one must, so the draft survives.
  it('a fresher stored template wins over an earlier successful save', async () => {
    const res = await actionResult('old saved', { type: 'success', text: 'Saved.' });
    const s = section(await mount(worker({ signature: 'new stored' }), res))!;
    expect(s.querySelector<HTMLTextAreaElement>('textarea[name="signature"]')!.value).toBe('new stored');
  });

  it('a refused save keeps the reader’s draft', async () => {
    const res = await actionResult('my draft', { type: 'error', text: "You can't change this worker's signature or trailer." });
    const s = section(await mount(worker({ signature: 'stored' }), res))!;
    expect(s.querySelector<HTMLTextAreaElement>('textarea[name="signature"]')!.value).toBe('my draft');
  });
});
