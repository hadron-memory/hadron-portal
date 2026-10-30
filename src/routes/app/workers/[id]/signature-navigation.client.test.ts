/**
 * portal#1366 — navigation through the REAL worker Page (SvelteKit reuses the
 * page component across /app/workers/[id] routes). The page keys the signature
 * section on the loader's per-worker form stamp (+page.svelte, portal#1448),
 * so a draft left on worker A never lands on worker B: B's editor mounts
 * fresh from B's own values and bases.
 *
 * These pins mount the actual +page.svelte and swap its loader data, because a
 * section-only harness would not prove the page's keying: without the keyed
 * stamp B never mounts fresh, A's text bleeds through, and each test below
 * fails. The data helper stamps exactly as the real loader does
 * (updateSignatureFormId) — an unstamped form carries the schema-hash default,
 * one id for EVERY worker, and the key never moves across an A→B navigation.
 *
 * The late-reply test drives the REAL delivery path (applyAction setting
 * page.form, applied by superforms to any mounted form with the same id). It
 * was RED until portal#1448 landed (CM ruling on #1366): A's and B's editors
 * shared the schema-hash form id, so a late A reply overwrote B's live
 * editor. Since #1448 the reply carries A's stamp and since #1450 a mounted
 * editor answers only to its own per-mount epoch, so a stamped A reply cannot
 * reach B's editor in any spelling.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { page, setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateSignatureFormId, updateSignatureSchema } from './schema';
import Page from './+page.svelte';

function worker(over: Record<string, unknown>) {
  return {
    id: 'w-a', appId: 'app-1', agentId: 'agent-1', name: 'Dara', slug: 'dara',
    urn: 'hrn:worker:hadronmemory.com:team:dara', role: 'engineer',
    prompt: null, memoryId: null, retiredAt: null,
    heldByUserId: null, heldAt: null, createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer' },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
    reportsToWorkerId: null, reportsToRetired: false, reportsTo: null,
    signature: 'A-SIG', trailer: 'A-TRAILER',
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

const WORKER_A = worker({});
const WORKER_B = worker({
  id: 'w-b', slug: 'bee', name: 'Bee', urn: 'hrn:worker:hadronmemory.com:team:bee',
  signature: 'B-SIG', trailer: 'B-TRAILER',
});

async function pageData(w: typeof WORKER_A) {
  return {
    worker: w,
    signatureForm: await superValidate(
      { signature: w.signature ?? '', trailer: w.trailer ?? '', signatureBase: w.signature ?? '', trailerBase: w.trailer ?? '' },
      zod4(updateSignatureSchema),
      { errors: false, id: updateSignatureFormId(w.id) },
    ),
    initialTab: 'briefing', initialView: null,
    workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
  };
}

/** Mount the real Page with reactive loader data; navigation is a data swap. */
async function mountPage(w: typeof WORKER_A) {
  const props = reactiveProps<Record<string, unknown>>({ data: await pageData(w), form: undefined });
  const page = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(page);
  return props;
}

/** Navigation as the page sees it: the page store's URL and params move with the loader data. */
async function navigateTo(props: Awaited<ReturnType<typeof mountPage>>, w: typeof WORKER_A) {
  setStubPage(`https://example.test/app/workers/${w.id}?tab=briefing`, { id: w.id });
  props.data = await pageData(w);
  flushSync();
}

/** What the browser would post from the section's real form. */
function posted(root: HTMLElement): Record<string, string> {
  const form = root.querySelector<HTMLFormElement>('form[action*="updateSignature"]')!;
  return Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)]));
}

function field(root: HTMLElement, name: 'signature' | 'trailer'): HTMLTextAreaElement {
  return root.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`)!;
}

function typeInto(root: HTMLElement, name: 'signature' | 'trailer', value: string) {
  const el = field(root, name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

const currentPage = () => mounted[0];

describe('worker page: signature section across worker navigation (#1366)', () => {
  it('worker B mounts from its own values and bases: no write of A’s draft', async () => {
    const props = await mountPage(WORKER_A);
    typeInto(currentPage().target, 'signature', 'A DRAFT SIG');
    typeInto(currentPage().target, 'trailer', 'A DRAFT TRAILER');

    await navigateTo(props, WORKER_B);
    const target = currentPage().target;

    expect(field(target, 'signature').value).toBe('B-SIG');
    expect(field(target, 'trailer').value).toBe('B-TRAILER');
    expect(posted(target)).toEqual({
      _kind: 'updateSignature', signature: 'B-SIG', signatureBase: 'B-SIG', trailer: 'B-TRAILER', trailerBase: 'B-TRAILER',
    });
    // Clean against B's own baselines — A's drafts are not "changes" on B.
    expect(target.querySelector<HTMLButtonElement>('form[action*="updateSignature"] button[type="submit"]')!.disabled).toBe(true);
  });

  it('A → B → A: A’s own draft does not resurrect, and each hop serializes only that worker’s values', async () => {
    const props = await mountPage(WORKER_A);
    typeInto(currentPage().target, 'signature', 'A DRAFT SIG');
    await navigateTo(props, WORKER_B);
    const target = currentPage().target;
    expect(field(target, 'signature').value).toBe('B-SIG');
    expect(JSON.stringify(posted(target))).not.toContain('A DRAFT');

    typeInto(target, 'signature', 'B DRAFT SIG');
    await navigateTo(props, WORKER_A);
    expect(field(currentPage().target, 'signature').value).toBe('A-SIG');
    expect(posted(currentPage().target)).toEqual({
      _kind: 'updateSignature', signature: 'A-SIG', signatureBase: 'A-SIG', trailer: 'A-TRAILER', trailerBase: 'A-TRAILER',
    });
  });

  it('a late failed reply for A never writes A’s text into B through the real page.form path (no remount: the editor keeps B’s state)', async () => {
    const props = await mountPage(WORKER_A);
    typeInto(currentPage().target, 'signature', 'A DRAFT SIG');
    await navigateTo(props, WORKER_B);
    const target = currentPage().target;
    const bTrailer = field(target, 'trailer');
    typeInto(target, 'trailer', 'B DRAFT TRAILER');
    const before = posted(target);

    // A's save refusal lands while B is mounted — through the REAL path:
    // applyAction sets page.form, and superforms applies it to any mounted
    // form with the same id. The reply carries A's own stamp (a real refusal
    // is stamped by the action; before portal#1448 it carried the schema-hash
    // default shared by every worker's editor, which is what made this pin
    // RED there, CM ruling on #1366): B must keep its own text, bases, save
    // state and payload, and the reply must not reach B's editor or the page.
    const failed = await superValidate(
      { _kind: 'updateSignature', signature: 'A REFUSED TEXT', trailer: '', signatureBase: 'A-SIG', trailerBase: 'A-TRAILER' },
      zod4(updateSignatureSchema),
      { errors: false, id: updateSignatureFormId('w-a') },
    );
    page.update((p) => ({ ...p, form: { form: { ...failed, message: { type: 'error', text: 'refused' } } } }));
    flushSync();

    // No remount: the same editor node, no stale error banner from A on B,
    // and B's serialized state is exactly what it was before the reply.
    expect(field(currentPage().target, 'trailer')).toBe(bTrailer);
    expect(currentPage().target.textContent).not.toContain('refused');
    expect(posted(currentPage().target)).toEqual(before);
    expect(posted(currentPage().target)).toEqual({
      _kind: 'updateSignature', signature: 'B-SIG', signatureBase: 'B-SIG', trailer: 'B DRAFT TRAILER', trailerBase: 'B-TRAILER',
    });
    expect(JSON.stringify(posted(currentPage().target))).not.toContain('A REFUSED');
  });

  it('a navigation that clears the form before B’s remount: B seeds from B’s loader form, not A’s refusal', async () => {
    const props = await mountPage(WORKER_A);
    typeInto(currentPage().target, 'signature', 'A DRAFT SIG');

    const failed = await superValidate(
      { _kind: 'updateSignature', signature: 'A REFUSED TEXT', trailer: '', signatureBase: 'A-SIG', trailerBase: 'A-TRAILER' },
      zod4(updateSignatureSchema),
      { errors: false, id: updateSignatureFormId('w-a') },
    );
    props.form = { form: { ...failed, message: { type: 'error', text: 'refused' } } };
    flushSync();
    // The refusal has really been rendered through: A's live editor keeps its
    // draft (a late action result seeds only a mount, never a live form).
    expect(field(currentPage().target, 'signature').value).toBe('A DRAFT SIG');

    // The realistic order: the navigation to B loads B's data and replaces the
    // page state, so the form is cleared BEFORE B's keyed remount reads it.
    props.form = undefined;
    await navigateTo(props, WORKER_B);

    const target = currentPage().target;
    expect(field(target, 'signature').value).toBe('B-SIG');
    expect(JSON.stringify(posted(target))).not.toContain('A REFUSED');
    expect(posted(target)).toEqual({
      _kind: 'updateSignature', signature: 'B-SIG', signatureBase: 'B-SIG', trailer: 'B-TRAILER', trailerBase: 'B-TRAILER',
    });
  });
});
