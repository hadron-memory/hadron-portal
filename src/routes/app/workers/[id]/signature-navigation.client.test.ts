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
 * The late-reply legs drive the REAL delivery path (applyAction setting
 * page.form, applied by superforms to any mounted form with the same id) and
 * carry a positive control: the same delivery at the editor's own live epoch
 * lands (the refusal message renders), so the negatives — an A-minted reply
 * while B is live — prove a fence, not a dead wire. The other reply
 * spellings (the bare loader stamp, the per-mount epoch fence across
 * A→B→A) are pinned in signature-isolation.client.test.ts (#1448/#1450);
 * the page.form pin was held RED at the unfixed parent (CI run 41013104823,
 * CM ruling on #1366).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync, tick } from 'svelte';
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
  const instance = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(instance);
  return props;
}

/** Navigation as the page sees it: the page store's URL and params move with the loader data. */
async function navigateTo(props: Awaited<ReturnType<typeof mountPage>>, w: typeof WORKER_A) {
  setStubPage(`https://example.test/app/workers/${w.id}?tab=briefing`, { id: w.id });
  props.data = await pageData(w);
  flushSync();
}

/**
 * applyAction's shape, as SvelteKit delivers a late reply to a live page:
 * page.form is set and the page store notifies. The awaited microtasks let
 * superforms' asynchronous application settle before the assertions read.
 */
async function deliverLate(reply: unknown) {
  page.update((p) => ({ ...p, form: reply }));
  await tick();
  await new Promise((r) => setTimeout(r));
  flushSync();
}

/** The id this mount answers to (`<stamp>#<uuid>` in the browser), for minting a reply at its own epoch. */
const instanceIdOf = (t: HTMLElement) =>
  t.querySelector<HTMLElement>('[data-testid="worker-signature"]')!
    .querySelector<HTMLFormElement>('form')!
    .getAttribute('data-superform-id')!;

/** A refused reply for `who`, minted the way the real action does: at `epoch` when given, else the bare loader stamp. */
async function refusedReply(who: string, epoch: string | null, draft: string) {
  const failed = await superValidate(
    { _kind: 'updateSignature', signature: draft, trailer: '', signatureBase: 'A-SIG', trailerBase: 'A-TRAILER' },
    zod4(updateSignatureSchema),
    { errors: false, id: epoch ?? updateSignatureFormId(who) },
  );
  return { form: { ...failed, message: { type: 'error', text: 'refused' } as const } };
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

  // The control for every negative below (Joran's blind delta on #1443): each
  // of them also passes if the stub page store were not wired to anything
  // superforms reads. This leg delivers through the SAME page-store path at
  // the editor's own live epoch and asserts the reply LANDS — the message
  // renders on the editor it targets — so the fence, not a dead wire, is what
  // the negatives prove. (A bare-stamp reply to a live editor is pinned to
  // pass through untouched in signature-isolation.client.test.ts.)
  it('control: the same page.form delivery at the editor’s own epoch lands — the refusal and its text show on A', async () => {
    await mountPage(WORKER_A);
    await deliverLate(await refusedReply('w-a', instanceIdOf(currentPage().target), 'A REFUSED TEXT'));
    // The path is live: the reply's message renders AND its submitted text is
    // restored to the editor (an own-epoch refusal applies, so the reader can
    // edit and retry — the same semantics signature-isolation.client.test.ts
    // pins as "the draft and the refusal line stay").
    expect(currentPage().target.textContent).toContain('refused');
    expect(field(currentPage().target, 'signature').value).toBe('A REFUSED TEXT');
  });

  it('a late failed reply minted by A never writes A’s text into B through the real page.form path (no remount: the editor keeps B’s state)', async () => {
    const props = await mountPage(WORKER_A);
    typeInto(currentPage().target, 'signature', 'A DRAFT SIG');
    // A's epoch: the enhanced submit posts the mount's instance id and the
    // action echoes it back, so a real refusal for A carries THIS id.
    const aEpoch = instanceIdOf(currentPage().target);
    await navigateTo(props, WORKER_B);
    const target = currentPage().target;
    const bTrailer = field(target, 'trailer');
    typeInto(target, 'trailer', 'B DRAFT TRAILER');

    // A's save refusal lands while B is mounted — through the REAL path
    // (applyAction setting page.form, applied by superforms to a mounted form
    // with the same id). B's editor answers to B's own epoch, so the reply
    // belongs to no live form: B keeps its own text, bases, save state and
    // payload, and the refusal line never shows on B's page.
    await deliverLate(await refusedReply('w-a', aEpoch, 'A REFUSED TEXT'));

    // No remount: the same editor node, no stale error banner from A on B,
    // and B's serialized state is exactly its own.
    expect(field(currentPage().target, 'trailer')).toBe(bTrailer);
    expect(currentPage().target.textContent).not.toContain('refused');
    expect(posted(currentPage().target)).toEqual({
      _kind: 'updateSignature', signature: 'B-SIG', signatureBase: 'B-SIG', trailer: 'B DRAFT TRAILER', trailerBase: 'B-TRAILER',
    });
  });

  it('after A’s refusal is delivered and the page navigates, B seeds from B’s loader form — A’s reply leaves no residue', async () => {
    const props = await mountPage(WORKER_A);

    // A's refusal arrives through the same real page-store path while A is
    // live — and demonstrably lands there (the control above): the message
    // shows and the refused text becomes A's editor value.
    await deliverLate(await refusedReply('w-a', instanceIdOf(currentPage().target), 'A REFUSED TEXT'));
    expect(currentPage().target.textContent).toContain('refused');
    expect(field(currentPage().target, 'signature').value).toBe('A REFUSED TEXT');

    // The navigation to B replaces the page state — the form is cleared
    // BEFORE B's keyed remount reads it (setStubPage resets the store, as
    // SvelteKit clears page.form on a navigation) — so B mounts from B's own
    // loader form alone.
    await navigateTo(props, WORKER_B);

    const target = currentPage().target;
    expect(target.textContent).not.toContain('refused');
    expect(field(target, 'signature').value).toBe('B-SIG');
    expect(JSON.stringify(posted(target))).not.toContain('A REFUSED');
    expect(posted(target)).toEqual({
      _kind: 'updateSignature', signature: 'B-SIG', signatureBase: 'B-SIG', trailer: 'B-TRAILER', trailerBase: 'B-TRAILER',
    });
  });
});
