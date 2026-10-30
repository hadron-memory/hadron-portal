/**
 * portal#1367 — keyboard focus through a signature/trailer save, and the
 * retirement explanation. Celine's QA on #1157 saw focus drop to the document
 * body after a keyboard save: the Save button is disabled while the request is
 * pending and again once nothing differs from the stored text, so the focused
 * control goes away and nothing takes its place.
 *
 * Mounted, because the ordering (result, then the loader re-read, then the
 * reseed that disables Save) is a lifecycle and a server render never runs it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { captureUnhandledRejections, mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { updateSignatureSchema } from './schema';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Section from './WorkerSignatureSection.svelte';
import Page from './+page.svelte';

const mounted: Mounted<Record<string, unknown>>[] = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  document.body.innerHTML = '';
  // applyAction records each result as the page's form data; a later mount must not inherit it.
  resetStubPage();
});

async function formFor(signature: string, trailer: string) {
  return superValidate({ signature, trailer, signatureBase: signature, trailerBase: trailer }, zod4(updateSignatureSchema), { errors: false });
}

async function mountSection(over: Record<string, unknown> = {}) {
  const props = reactiveProps({
    signature: 'stored sig' as string | null,
    trailer: 'stored trailer' as string | null,
    retired: false,
    initialForm: await formFor('stored sig', 'stored trailer'),
    actionResult: undefined as unknown,
    ...over,
  });
  const m = mountComponent(Section as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  document.body.appendChild(m.target);
  return { props, target: m.target };
}

function type(target: HTMLElement, name: string, value: string) {
  const el = target.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`)!;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** The server's answer to a save, as the form action returns it. */
async function savedResult(signature: string) {
  const f = await superValidate({ signature, trailer: 'stored trailer', signatureBase: signature, trailerBase: 'stored trailer' }, zod4(updateSignatureSchema), { errors: false });
  return { type: 'success' as const, status: 200, data: { form: { ...f, message: { type: 'success', text: 'Saved.' } } } };
}

describe('focus through a successful save (#1367)', () => {
  it('lands on the result line, not the body, once the loader re-read disables Save', async () => {
    const { props, target } = await mountSection();
    type(target, 'signature', 'edited sig');
    const save = target.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    save.focus();
    expect(document.activeElement).toBe(save);

    await submitEnhancedWithResult(target.querySelector('form')!, await savedResult('edited sig'));
    // The loader re-read lands with the saved text: nothing differs, so Save disables.
    props.signature = 'edited sig';
    await tick(4);

    expect(save.disabled).toBe(true);
    const status = target.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toContain('Saved.');
    expect(document.activeElement).toBe(status);
  });

  it('does not take focus back from a control the reader moved to while the save ran', async () => {
    const { props, target } = await mountSection();
    type(target, 'signature', 'edited sig');
    target.querySelector<HTMLButtonElement>('button[type="submit"]')!.focus();
    const other = document.createElement('input');
    document.body.appendChild(other);
    other.focus();

    await submitEnhancedWithResult(target.querySelector('form')!, await savedResult('edited sig'));
    props.signature = 'edited sig';
    await tick(4);

    expect(document.activeElement).toBe(other);
  });

  it('a save that lands after the section was torn down focuses nothing and throws nothing', async () => {
    const { target } = await mountSection();
    type(target, 'signature', 'edited sig');
    target.querySelector<HTMLButtonElement>('button[type="submit"]')!.focus();
    const form = target.querySelector('form')!;
    const result = await savedResult('edited sig');
    const caught = await captureUnhandledRejections(async () => {
      const done = submitEnhancedWithResult(form, result);
      mounted.pop()!.unmount();
      await done;
      await tick(4);
    });
    expect(caught).toEqual([]);
    expect(document.activeElement).toBe(document.body);
  });

  it('a refused save leaves focus alone', async () => {
    const { target } = await mountSection();
    type(target, 'signature', 'edited sig');
    const save = target.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    save.focus();
    const f = await superValidate({ signature: 'edited sig', trailer: 'stored trailer', signatureBase: 'stored sig', trailerBase: 'stored trailer' }, zod4(updateSignatureSchema), { errors: false });
    await submitEnhancedWithResult(target.querySelector('form')!, { type: 'failure', status: 403, data: { form: { ...f, valid: false, message: { type: 'error', text: 'Refused.' } } } });
    await tick(4);
    expect(document.activeElement).toBe(save);
  });
});

describe('a retired worker (#1367)', () => {
  it('says why the editors are disabled and Save is absent, beside them', async () => {
    const { target } = await mountSection({ retired: true });
    const textarea = target.querySelector<HTMLTextAreaElement>('textarea[name="signature"]')!;
    expect(textarea.disabled).toBe(true);
    expect(target.querySelector('button[type="submit"]')).toBeNull();
    const note = target.querySelector<HTMLElement>('[data-testid="signature-retired"]')!;
    expect(note.textContent).toMatch(/retired/i);
    expect(textarea.getAttribute('aria-describedby')).toContain(note.id);
    expect(target.querySelector('textarea[name="trailer"]')!.getAttribute('aria-describedby')).toContain(note.id);
  });

  it('shows no retirement note for a live worker', async () => {
    const { target } = await mountSection();
    expect(target.querySelector('[data-testid="signature-retired"]')).toBeNull();
  });

  it('makes no claim about who may change it', async () => {
    const { target } = await mountSection({ retired: true });
    expect(target.querySelector('[data-testid="signature-retired"]')!.textContent).not.toMatch(/you (can|may|are)|permission|admin|manager|owner/i);
  });
});

// The page is where the ordering matters: the loader re-read replaces
// `data.worker`, and that reseed is what disables Save under the focused button.
describe('the whole worker page (#1367)', () => {
  function worker(signature: string) {
    return {
      id: 'w-a', appId: 'app-1', agentId: 'agent-1', name: 'Dara', slug: 'dara',
      urn: 'hrn:worker:hadronmemory.com:team:dara', role: 'engineer',
      prompt: null, memoryId: null, retiredAt: null, heldByUserId: null, heldAt: null, createdAt: '1789430400000',
      agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer' },
      app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
      reportsToWorkerId: null, reportsToRetired: false, reportsTo: null, signature, trailer: '',
    };
  }

  it('keyboard save: focus ends on the result line after the re-read, never the body', async () => {
    resetNavigationGuards();
    setStubPage('https://example.test/app/workers/w-a?tab=briefing', { id: 'w-a' });
    const base = {
      signatureForm: await superValidate({ signature: 'old', trailer: '', signatureBase: 'old', trailerBase: '' }, zod4(updateSignatureSchema), { errors: false }),
      initialTab: 'briefing', initialView: null, workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
    };
    const props = reactiveProps({ data: { ...base, worker: worker('old') }, form: undefined as unknown });
    const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    document.body.appendChild(m.target);
    await tick(2);
    type(m.target, 'signature', 'new');
    const save = m.target.querySelector<HTMLButtonElement>('[data-testid="worker-signature"] button[type="submit"]')!;
    save.focus();
    await submitEnhancedWithResult(m.target.querySelector('[data-testid="worker-signature"] form')!, await savedResult('new'));
    props.data = { ...base, worker: worker('new') };
    await tick(4);
    expect(save.disabled).toBe(true);
    expect(document.activeElement).toBe(m.target.querySelector('[data-testid="worker-signature"] [role="status"]'));
  });
});
