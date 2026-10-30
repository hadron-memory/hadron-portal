/**
 * portal#1366 — navigation through the REAL worker Page (SvelteKit reuses the
 * page component across /app/workers/[id] routes). The page keys the signature
 * section on the worker id (+page.svelte), so a draft left on worker A never
 * lands on worker B: B's editor mounts fresh from B's own values and bases.
 *
 * These pins mount the actual +page.svelte and swap its loader data, because a
 * section-only harness would not prove the page's keying: removing the
 * worker-id key makes every test in this file fail (verified as the gate's
 * required mutant; restored afterwards).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateSignatureSchema } from './schema';
import Page from './+page.svelte';

function worker(over: Record<string, unknown>) {
  return {
    id: 'w-a', appId: 'app-1', agentId: 'agent-1', name: 'Dara', slug: 'dara',
    urn: 'hrn:worker:hadronmemory.com:team:dara', role: 'engineer',
    prompt: null, memoryId: null, retiredAt: null,
    heldByUserId: null, heldAt: null, createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer', },
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
      { errors: false },
    ),
    initialTab: 'briefing', initialView: null,
    workerSessions: [], sessionsTruncated: false, worklog: [], worklogTotal: 0,
  };
}

/** Mount the real Page with reactive loader data; navigation is a data swap. */
async function mountPage(w: typeof WORKER_A) {
  const props = reactiveProps<Record<string, unknown>>({ data: await pageData(w), form: undefined });
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  return props;
}

/** What the browser would post from the section's real form. */
function posted(root: HTMLElement): Record<string, string> {
  const form = root.querySelector<HTMLFormElement>('form[action*="updateSignature"]')!;
  return Object.fromEntries([...new FormData(form)].map(([k, v]) => [k, String(v)]));
}

function field(root: HTMLElement, name: 'signature' | 'trailer'): HTMLTextAreaElement {
  return root.querySelector<HTMLTextAreaElement>(`textarea[name="${name}"]`)!;
}

function type(root: HTMLElement, name: 'signature' | 'trailer', value: string) {
  const el = field(root, name);
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

const m = () => mounted[0];

describe('worker page: signature section across worker navigation (#1366)', () => {
  it('worker B mounts from its own values and bases: no write of A’s draft', async () => {
    const props = await mountPage(WORKER_A);
    type(m().target, 'signature', 'A DRAFT SIG');
    type(m().target, 'trailer', 'A DRAFT TRAILER');

    props.data = await pageData(WORKER_B);
    flushSync();
    const target = m().target;

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
    type(m().target, 'signature', 'A DRAFT SIG');
    props.data = await pageData(WORKER_B);
    flushSync();
    const target = m().target;
    expect(field(target, 'signature').value).toBe('B-SIG');
    expect(JSON.stringify(posted(target))).not.toContain('A DRAFT');

    type(target, 'signature', 'B DRAFT SIG');
    props.data = await pageData(WORKER_A);
    flushSync();
    expect(field(target, 'signature').value).toBe('A-SIG');
    expect(posted(target)).toEqual({
      _kind: 'updateSignature', signature: 'A-SIG', signatureBase: 'A-SIG', trailer: 'A-TRAILER', trailerBase: 'A-TRAILER',
    });
  });

  it('a late failed reply for A never writes A’s text into B (no remount: the editor keeps B’s state)', async () => {
    const props = await mountPage(WORKER_A);
    type(m().target, 'signature', 'A DRAFT SIG');
    props.data = await pageData(WORKER_B);
    flushSync();
    const target = m().target;
    type(target, 'trailer', 'B DRAFT TRAILER');

    // A's save refusal lands while B is mounted. The action result seeds only
    // a mount; the live B form keeps its own values.
    const failed = await superValidate(
      { _kind: 'updateSignature', signature: 'A REFUSED TEXT', trailer: '', signatureBase: 'A-SIG', trailerBase: 'A-TRAILER' },
      zod4(updateSignatureSchema),
      { errors: false },
    );
    props.form = { form: { ...failed, message: { type: 'error', text: 'refused' } } };
    flushSync();

    expect(posted(target)).toEqual({
      _kind: 'updateSignature', signature: 'B-SIG', signatureBase: 'B-SIG', trailer: 'B DRAFT TRAILER', trailerBase: 'B-TRAILER',
    });
    expect(JSON.stringify(posted(target))).not.toContain('A REFUSED');
  });

  it('a navigation that clears the form before B’s remount: B seeds from B’s loader form, not A’s refusal', async () => {
    const props = await mountPage(WORKER_A);
    type(m().target, 'signature', 'A DRAFT SIG');

    const failed = await superValidate(
      { _kind: 'updateSignature', signature: 'A REFUSED TEXT', trailer: '', signatureBase: 'A-SIG', trailerBase: 'A-TRAILER' },
      zod4(updateSignatureSchema),
      { errors: false },
    );
    props.form = { form: { ...failed, message: { type: 'error', text: 'refused' } } };
    // The realistic order: A's refusal sets form, the navigation to B loads B's
    // data and replaces the page state (form cleared).
    props.data = await pageData(WORKER_B);
    props.form = undefined;
    flushSync();

    const target = m().target;
    expect(field(target, 'signature').value).toBe('B-SIG');
    expect(JSON.stringify(posted(target))).not.toContain('A REFUSED');
    expect(posted(target)).toMatchObject({ signature: 'B-SIG', signatureBase: 'B-SIG' });
  });
});
