/**
 * portal#1448 — a late save reply for worker A must never reach worker B's
 * live editor. SvelteKit reuses this page across /app/workers/[id]
 * navigations, and superforms applies an arriving action result (applyAction
 * setting page.form) to any mounted form with the SAME id; the schema-hash
 * default id is shared by every worker's editor, so A's reply landed in B's
 * editor with Save enabled, and saving B wrote A's text onto B (Rico's §10 on
 * #1443).
 *
 * portal#1450 (George's LOCAL P2) sharpened the fence from per worker to per
 * MOUNT (`<stamp>#<uuid>`, see signature-instance-id.ts): a reply applies to
 * the one mount whose epoch it carries. A same-worker reply minted by the
 * live mount still applies; one minted by an EARLIER mount of that worker —
 * a save still in flight across an A→B→A move — must not, or it clobbers the
 * returned-to editor's fresh draft. The loader's bare stamp (the no-JS POST
 * shape, matched by the server render) reaches a mounted editor never.
 *
 * Every seed and every reply here comes from the REAL loader and the REAL
 * action (only the GraphQL client is mocked), so the pins run the id regime
 * production runs — at the unfixed parent both sides still share the default
 * id, which is what makes the cross-worker legs red there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { get } from 'svelte/store';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateSignatureFormId, updateSignatureSchema } from './schema';
import Page from './+page.svelte';
import Section from './WorkerSignatureSection.svelte';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (...args: unknown[]) => mockRequest(...args) }),
}));

const SIG_A = '— A’s own signature {{worker.name}}';
const SIG_B = '— B’s own signature {{worker.name}}';

function worker(id: string, signature: string) {
  return {
    id, appId: 'app-1', agentId: 'agent-1', name: id.toUpperCase(), slug: id,
    urn: `hrn:worker:hadronmemory.com:team:${id}`, role: 'engineer',
    prompt: null, memoryId: null, retiredAt: null,
    heldByUserId: null, heldAt: null, createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer' },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
    reportsToWorkerId: null, reportsToRetired: false, reportsTo: null,
    signature, trailer: '',
  };
}

function gqlError(code: string, message: string) {
  return Object.assign(new Error('raw ClientError text'), { response: { errors: [{ message, extensions: { code } }] } });
}

/** The real loader for one worker ref (the worker read is the only queued reply). */
async function loadWorker(id: string, signature: string) {
  mockRequest.mockResolvedValueOnce({ worker: worker(id, signature) });
  const { load } = await import('./+page.server');
  return load({
    params: { id },
    url: new URL(`http://localhost/app/workers/${id}?tab=briefing`),
    locals: { user: { id: 'u1' }, token: 'tok' },
  } as never) as Promise<Record<string, unknown>>;
}

/**
 * A real action reply for one worker: 'refuse' rejects the mutation (a 403
 * failure whose page.form is res.data), 'ok' resolves it (a success whose
 * page.form is the return itself). `formId`, when given, is posted as
 * `__superform_id` — what the enhanced submit does with the mount's instance
 * id, which the action's superValidate echoes back over the loader stamp —
 * so the reply is minted for that epoch. Omitted, the reply carries the bare
 * loader stamp (the no-JS POST shape).
 */
async function actionReply(id: string, draft: string, outcome: 'refuse' | 'ok', formId?: string, base = 'base') {
  const fd = new FormData();
  fd.set('_kind', 'updateSignature');
  fd.set('signature', draft);
  fd.set('signatureBase', base);
  fd.set('trailer', '');
  fd.set('trailerBase', '');
  if (formId) fd.set('__superform_id', formId);
  if (outcome === 'refuse') mockRequest.mockRejectedValueOnce(gqlError('FORBIDDEN', 'Forbidden'));
  else mockRequest.mockResolvedValueOnce({ updateWorker: { id } });
  const { actions } = await import('./+page.server');
  const res = (await (actions as Record<string, (e: never) => Promise<unknown>>).updateSignature({
    params: { id },
    locals: { user: { id: 'u1' }, token: 'tok' },
    request: { formData: async () => fd },
  } as never)) as { data?: { form?: unknown }; form?: unknown };
  return outcome === 'refuse' ? res.data! : res;
}

const mounted: Mounted<Record<string, unknown>>[] = [];
const props = { current: null as null | Record<string, unknown> };
beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({ sessions: [], teamWorkItems: { items: [], total: 0 } });
  resetNavigationGuards();
  setStubPage('https://example.test/app/workers/w-a?tab=briefing', { id: 'w-a' });
});
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
  props.current = null;
});

/** Mount the page once for worker A; navigation is simulated by swapping data. */
async function mountPage(data: Record<string, unknown>, form: unknown = null) {
  const p = reactiveProps({ data, form });
  props.current = p;
  const m = mountComponent(Page as never, p as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  flushSync();
  return m.target;
}

/** applyAction, as SvelteKit delivers a late reply: page.form is set, page updates. */
async function deliverLate(reply: unknown) {
  page.set({ ...get(page), form: reply });
  await tick();
  await new Promise((r) => setTimeout(r));
  flushSync();
}

/**
 * A client-side navigation, as SvelteKit's router performs it: the page's data
 * is replaced AND page.form is cleared (only an action result sets it, and it
 * does not survive a navigation).
 */
function navigateTo(data: Record<string, unknown>) {
  page.set({ ...get(page), form: null });
  (props.current as { data: Record<string, unknown> }).data = data;
  flushSync();
}

const sectionEl = (t: HTMLElement) => t.querySelector<HTMLElement>('[data-testid="worker-signature"]')!;
const sigField = (t: HTMLElement) => sectionEl(t).querySelector<HTMLTextAreaElement>('textarea[name="signature"]')!;
const sigBase = (t: HTMLElement) => sectionEl(t).querySelector<HTMLInputElement>('input[name="signatureBase"]')!;
const saveButton = (t: HTMLElement) => sectionEl(t).querySelector<HTMLButtonElement>('button[type="submit"]')!;
/** The id this MOUNT answers to (`<stamp>#<uuid>` in the browser), for minting replies at its own epoch. */
const instanceIdOf = (t: HTMLElement) => sectionEl(t).querySelector<HTMLFormElement>('form')!.getAttribute('data-superform-id')!;

describe('worker signature: late-reply isolation (#1448)', () => {
  it('a late refusal for A leaves B’s editor, bases, save state and messages untouched', async () => {
    const target = await mountPage(await loadWorker('w-b', SIG_B));
    const before = sigField(target).value;
    await deliverLate(await actionReply('w-a', 'A’s doomed draft', 'refuse'));
    expect(sigField(target).value).toBe(before);
    expect(sigBase(target).value).toBe(SIG_B);
    expect(saveButton(target).disabled).toBe(true);
    expect(sectionEl(target).textContent).not.toMatch(/can't change this worker's signature/i);
  });

  it('a late success for A leaves B’s editor untouched too', async () => {
    const target = await mountPage(await loadWorker('w-b', SIG_B));
    const before = sigField(target).value;
    await deliverLate(await actionReply('w-a', 'A’s saved text', 'ok'));
    expect(sigField(target).value).toBe(before);
    expect(sigBase(target).value).toBe(SIG_B);
    expect(saveButton(target).disabled).toBe(true);
    expect(sectionEl(target).textContent).not.toMatch(/saved\./i);
  });

  // A→B→A (George's LOCAL P2 on #1450): the reply was minted by A's FIRST
  // mount (an enhanced save still in flight across the move — its id is that
  // mount's epoch, posted as __superform_id and echoed back). While B is
  // shown it must not apply; and back on A the remounted editor is a NEW
  // epoch, so the first mount's reply must not apply there either — at
  // 41b95194 the id was per worker only, it matched, and the old save
  // clobbered the returned-to editor's fresh draft.
  it('A→B→A: the first A mount’s in-flight reply applies to no later mount', async () => {
    const target = await mountPage(await loadWorker('w-a', SIG_A));
    const firstEpoch = instanceIdOf(target);
    navigateTo(await loadWorker('w-b', SIG_B));
    expect(sigField(target).value).toBe(SIG_B);
    expect(sigBase(target).value).toBe(SIG_B);

    const reply = await actionReply('w-a', 'A’s saved text', 'ok', firstEpoch);
    await deliverLate(reply);
    expect(sigField(target).value).toBe(SIG_B);
    expect(saveButton(target).disabled).toBe(true);

    navigateTo(await loadWorker('w-a', SIG_A));
    expect(sigField(target).value).toBe(SIG_A);
    expect(sigBase(target).value).toBe(SIG_A);

    // The clobber assertions come before the epoch check deliberately: at the
    // unfixed parent there is no epoch attribute, the reply falls back to the
    // bare stamp, and these lines go red on the CLOBBER itself (the old save
    // landing in the returned-to editor) — not on a missing attribute.
    await deliverLate(reply);
    expect(sigField(target).value).toBe(SIG_A);
    expect(sigBase(target).value).toBe(SIG_A);
    expect(saveButton(target).disabled).toBe(true);
    expect(sectionEl(target).textContent).not.toMatch(/saved\./i);
    expect(instanceIdOf(target)).not.toBe(firstEpoch);
  });

  // The epoch fence's other half: a reply minted by the LIVE mount (the
  // enhanced submit posts its instance id, the action echoes it back) is this
  // editor's own and still applies. The fence is per epoch, not a wall.
  it('a refusal minted by this mount still applies: the draft and the refusal line stay', async () => {
    const target = await mountPage(await loadWorker('w-a', SIG_A));
    await deliverLate(await actionReply('w-a', 'my unsaved draft', 'refuse', instanceIdOf(target)));
    expect(sigField(target).value).toBe('my unsaved draft');
    expect(sectionEl(target).textContent).toMatch(/can't change this worker's signature/i);
  });

  it('a success minted by this mount still applies: the saved line shows', async () => {
    const target = await mountPage(await loadWorker('w-a', SIG_A));
    await deliverLate(await actionReply('w-a', 'my saved text', 'ok', instanceIdOf(target)));
    expect(sectionEl(target).textContent).toMatch(/saved\./i);
  });

  // The loader's bare stamp (what a no-JS POST's reply carries, and what the
  // server render matches) never reaches a mounted editor: a browser mount
  // always answers to `<stamp>#<uuid>`, so a stamp-only reply landing in
  // page.form belongs to no live epoch and must pass through untouched.
  it('a bare-stamp reply (the no-JS shape) applies to no mounted editor', async () => {
    const target = await mountPage(await loadWorker('w-a', SIG_A));
    await deliverLate(await actionReply('w-a', 'no-JS refused draft', 'refuse'));
    expect(sigField(target).value).toBe(SIG_A);
    expect(sigBase(target).value).toBe(SIG_A);
    expect(saveButton(target).disabled).toBe(true);
    expect(sectionEl(target).textContent).not.toMatch(/can't change this worker's signature/i);
  });

  // The mount path: page.form may still hold A's refused reply when B's
  // section first mounts (the action result outlives the navigation). The
  // section must not seed B's editor from it.
  it('A’s refused reply sitting in page.form does not seed B’s editor at mount', async () => {
    const reply = await actionReply('w-a', 'A’s refused draft', 'refuse');
    const target = await mountPage(await loadWorker('w-b', SIG_B), reply);
    expect(sigField(target).value).toBe(SIG_B);
    expect(sigBase(target).value).toBe(SIG_B);
    expect(saveButton(target).disabled).toBe(true);
  });

  it('B’s own refused reply still seeds B’s editor at mount (the fence is per identity, not a wall)', async () => {
    const reply = await actionReply('w-b', 'B’s refused draft', 'refuse');
    const target = await mountPage(await loadWorker('w-b', SIG_B), reply);
    expect(sigField(target).value).toBe('B’s refused draft');
    expect(sectionEl(target).textContent).toMatch(/can't change this worker's signature/i);
  });

  // Gaby's blind P2 on #1450, second half — the epoch fence is only as real
  // as the id the REAL enhanced submit posts — is dispositioned by EVIDENCE,
  // not a jsdom pin (a synthetic submit event does not drive kit's enhance
  // chain to fetch in jsdom, so a harness pin cannot see the posted id):
  // superforms 2.30.2 injects `__superform_id` from the form's id in the
  // submit path (dist/client/superForm.js:1293-1298), kit's enhance then
  // POSTs that FormData through the global fetch, and George's local delta
  // node records an actual enhanced callback posting the live mount id with
  // the real action echoing it; Cedric's private-browser run verifies the
  // POST on a real page. The action-side half IS pinned server-side:
  // signature.test.ts "echoes a POSTED instance id".
});

// Gaby's blind P2 on #1450, the mount-path half: an earlier mount's refusal
// may seed a remount only while its bases still equal the loader's — a save
// that landed since changed the stored text and the loader's bases with it.
// (Tab round-trips are {#if} toggles, NOT navigations — +page.svelte keeps
// tab clicks out of the URL — so page.form really does survive them; that is
// the legitimate case these legs keep alive.)
describe('worker signature: prior-epoch seed gate (#1450)', () => {
  const stamp = updateSignatureFormId('w-a');

  /** The section mounted directly, as a tab round-trip remounts it: the loader's CURRENT form, page.form's stale reply. */
  async function remountWith(storedSignature: string, actionResult: unknown) {
    const initialForm = await superValidate(
      { signature: storedSignature, trailer: '', signatureBase: storedSignature, trailerBase: '' },
      zod4(updateSignatureSchema),
      { errors: false, id: stamp },
    );
    const props = reactiveProps({
      signature: storedSignature, trailer: null, retired: false, initialForm, actionResult,
    });
    const m = mountComponent(Section as never, props as never) as Mounted<Record<string, unknown>>;
    mounted.push(m);
    flushSync();
    return m.target;
  }

  it('an earlier mount’s refusal still seeds while its base matches the store — through TWO tab round-trips', async () => {
    const reply = await actionReply('w-a', 'my round-trip draft', 'refuse', `${stamp}#old-epoch`, SIG_A);
    const first = await remountWith(SIG_A, reply);
    expect(sigField(first).value).toBe('my round-trip draft');
    expect(saveButton(first).disabled).toBe(false);
    // The second round-trip is the review's explicit pin: a refusal writes
    // nothing, so the loader's bases are unchanged and the draft must seed
    // this remount exactly as it seeded the last.
    mounted.pop()!.unmount();
    const second = await remountWith(SIG_A, reply);
    expect(sigField(second).value).toBe('my round-trip draft');
    expect(saveButton(second).disabled).toBe(false);
    expect(sectionEl(second).textContent).toMatch(/can't change this worker's signature/i);
  });

  it('an earlier mount’s refusal does NOT seed once a later save has overtaken its base (Gaby’s blind P2)', async () => {
    // The loader now holds a NEWER stored signature (mount 2's save landed,
    // invalidateAll reran the loader); the stale refusal still carries the
    // OLD base and the OLD draft.
    const reply = await actionReply('w-a', 'stale doomed draft', 'refuse', `${stamp}#old-epoch`, SIG_A);
    const target = await remountWith('A-SIG SAVED LATER', reply);
    expect(sigField(target).value).toBe('A-SIG SAVED LATER');
    expect(sigBase(target).value).toBe('A-SIG SAVED LATER');
    expect(saveButton(target).disabled).toBe(true);
    expect(sectionEl(target).textContent).not.toMatch(/can't change this worker's signature/i);
  });
});
