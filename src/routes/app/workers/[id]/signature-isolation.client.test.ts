/**
 * portal#1448 — a late save reply for worker A must never reach worker B's
 * live editor. SvelteKit reuses this page across /app/workers/[id]
 * navigations, and superforms applies an arriving action result (applyAction
 * setting page.form) to any mounted form with the SAME id; the schema-hash
 * default id is shared by every worker's editor, so A's reply landed in B's
 * editor with Save enabled, and saving B wrote A's text onto B (Rico's §10 on
 * #1443).
 *
 * Every seed and every reply here comes from the REAL loader and the REAL
 * action (only the GraphQL client is mocked), so the pins run the id regime
 * production runs — at the unfixed parent both sides still share the default
 * id, which is what makes the cross-worker legs red there.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, tick } from 'svelte';
import { get } from 'svelte/store';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import Page from './+page.svelte';

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
 * page.form is the return itself).
 */
async function actionReply(id: string, draft: string, outcome: 'refuse' | 'ok') {
  const fd = new FormData();
  fd.set('_kind', 'updateSignature');
  fd.set('signature', draft);
  fd.set('signatureBase', outcome === 'refuse' ? 'base' : 'base');
  fd.set('trailer', '');
  fd.set('trailerBase', '');
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

  // A→B→A: the reply was always A's own; while B is shown it must not apply,
  // and back on A the editor holds A's values (the reseed baseline re-arms per
  // mount), and A's own late reply then applies as a same-worker reply.
  it('A→B→A: A’s late reply skips B, and back on A it is A’s own reply again', async () => {
    const target = await mountPage(await loadWorker('w-a', SIG_A));
    navigateTo(await loadWorker('w-b', SIG_B));
    expect(sigField(target).value).toBe(SIG_B);
    expect(sigBase(target).value).toBe(SIG_B);

    const reply = await actionReply('w-a', 'A’s saved text', 'ok');
    await deliverLate(reply);
    expect(sigField(target).value).toBe(SIG_B);
    expect(saveButton(target).disabled).toBe(true);

    navigateTo(await loadWorker('w-a', SIG_A));
    expect(sigField(target).value).toBe(SIG_A);
    expect(sigBase(target).value).toBe(SIG_A);

    await deliverLate(reply);
    expect(sectionEl(target).textContent).toMatch(/saved\./i);
  });

  it('a same-worker refusal still applies: the draft and the refusal line stay', async () => {
    const target = await mountPage(await loadWorker('w-a', SIG_A));
    await deliverLate(await actionReply('w-a', 'my unsaved draft', 'refuse'));
    expect(sigField(target).value).toBe('my unsaved draft');
    expect(sectionEl(target).textContent).toMatch(/can't change this worker's signature/i);
  });

  it('a same-worker success still applies: the saved line shows', async () => {
    const target = await mountPage(await loadWorker('w-a', SIG_A));
    await deliverLate(await actionReply('w-a', 'my saved text', 'ok'));
    expect(sectionEl(target).textContent).toMatch(/saved\./i);
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
});
