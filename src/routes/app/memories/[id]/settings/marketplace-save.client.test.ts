/**
 * #841 — the marketplace-listing card's CLIENT behaviour under Superforms
 * delivery, per the CM acceptance on PR #1244: SSR markup alone does not
 * exercise page-store delivery, so these mount the page and drive real
 * superforms result handlers (`submitEnhancedWithResult`, #957) for this
 * card AND a sibling.
 *
 * The form-id contract is the load-bearing part
 * (hrn:node:hadronmemory.com:hadron-portal:review:superforms-distinct-form-ids):
 * the load and the action both build the form with the MEMORY-BOUND id
 * `updateMarketplaceListing:${id}`, and a result reaches THIS card's message
 * store only if the ids match — memory included. A collision would show in
 * the network tab as a successful save with a page that stays silent —
 * invisible to SSR tests — and a late result from another memory would flip
 * a checkbox its user never touched (Gene's P2-1 on #1244).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { flushSync } from 'svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult, submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import type { Memory } from '$lib/types';
import { marketplaceListingSchema, retryFailedEmbeddingsSchema } from './schema';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';

vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));

import Page from './+page.svelte';

const CARD = 'form[action="?/updateMarketplaceListing"]';
const SIBLING = 'form[action="?/retryFailedEmbeddings"]';

async function renderCard(graphOverrides: Partial<Memory> = {}) {
  const graph = settingsGraph({ visibility: 'PUBLIC', ...graphOverrides });
  const forms = await settingsForms(graph);
  const props = reactiveProps<Record<string, unknown>>({
    data: {
      graph,
      user: OWNER,
      ownerUserId: OWNER_ID,
      owner: { id: OWNER_ID, handle: 'holger', name: 'Holger' },
      org: null,
      allOrgs: [],
      transferCanDelete: false,
      canWriteMemory: true,
      ...forms,
    } as never,
    form: null as never,
  });
  setStubPage('http://localhost/app/memories/mem-1/settings', { id: 'mem-1' });
  page.update((p) => ({ ...p, data: props.data as Record<string, unknown> }));
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  await tick();
  return { ...m, props };
}

const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => {
  while (mounted.length) mounted.pop()!.unmount();
});

function cardForm(target: HTMLElement) { return target.querySelector<HTMLFormElement>(CARD)!; }
function cardBox(target: HTMLElement) { return cardForm(target).querySelector<HTMLInputElement>('input[type="checkbox"]')!; }
function saveButton(target: HTMLElement) { return cardForm(target).querySelector<HTMLButtonElement>('button[type="submit"]')!; }

function toggle(target: HTMLElement, checked: boolean) {
  const box = cardBox(target);
  box.checked = checked;
  box.dispatchEvent(new Event('change', { bubbles: true }));
  flushSync();
}

/**
 * The result the action would answer with, built exactly as the action does —
 * including the MEMORY-BOUND form id, so an outcome for `memoryId` only ever
 * matches that memory's card.
 */
async function cardOutcome(listed: boolean, success: boolean, memoryId = 'mem-1') {
  const validated = await superValidate({ listedOnMarketplace: listed }, zod4(marketplaceListingSchema), { id: `updateMarketplaceListing:${memoryId}` });
  validated.message = { type: success ? 'success' : 'error', text: success ? 'Changes saved.' : 'Failed to update marketplace listing.' };
  return { type: (success ? 'success' : 'failure') as 'success' | 'failure', status: success ? 200 : 500, data: { form: validated } };
}

async function deliver(target: HTMLElement, props: Record<string, unknown>, outcome: Awaited<ReturnType<typeof cardOutcome>>) {
  const sent = await submitEnhancedWithResult(cardForm(target), outcome);
  expect(sent.cancelled).toBe(false);
  props.form = outcome.data;
  for (let i = 0; i < 5; i++) await tick();
}

describe('marketplace-listing save delivery (#841)', () => {
  it('delivers a successful save to THIS card — the form-id contract holds', async () => {
    const m = await renderCard();
    mounted.push(m);
    toggle(m.target, true);
    await deliver(m.target, m.props, await cardOutcome(true, true));
    expect(cardForm(m.target).textContent).toContain('Changes saved.');
  });

  it('delivers a failure to THIS card without disturbing the checkbox intent', async () => {
    const m = await renderCard();
    mounted.push(m);
    toggle(m.target, true);
    await deliver(m.target, m.props, await cardOutcome(true, false));
    expect(cardForm(m.target).textContent).toContain('Failed to update marketplace listing.');
    expect(cardBox(m.target).checked).toBe(true);
  });

  it('a later SIBLING submission retires this card’s banner — no stale success', async () => {
    // vector index on, so the retry-embeds sibling card actually renders
    const m = await renderCard({ vectorIndexEnabled: true });
    mounted.push(m);
    await deliver(m.target, m.props, await cardOutcome(true, true));
    expect(cardForm(m.target).textContent).toContain('Changes saved.');

    // The sibling's own result replaces the page's action data; scoped by
    // _kind, this card must stop claiming success
    // (hrn:node:hadronmemory.com:hadron-portal:review:superforms-scope-message-by-kind).
    const siblingValidated = await superValidate({}, zod4(retryFailedEmbeddingsSchema));
    const siblingOutcome = { type: 'success' as const, status: 200, data: { form: siblingValidated, retriedCount: 3 } };
    const sent = await submitEnhancedWithResult(m.target.querySelector<HTMLFormElement>(SIBLING)!, siblingOutcome);
    expect(sent.cancelled).toBe(false);
    m.props.form = siblingOutcome.data;
    for (let i = 0; i < 5; i++) await tick();
    expect(cardForm(m.target).textContent).not.toContain('Changes saved.');
  });

  it('pending disables the duplicate save, and re-enables on completion', async () => {
    const m = await renderCard();
    mounted.push(m);
    const deferred = await submitEnhancedDeferred(cardForm(m.target));
    expect(saveButton(m.target).disabled).toBe(true);
    await deferred.finish(await cardOutcome(false, true));
    for (let i = 0; i < 5; i++) await tick();
    expect(saveButton(m.target).disabled).toBe(false);
  });

  it('reloads authoritative state: a persisted flag change reseeds the checkbox', async () => {
    const m = await renderCard({ listedOnMarketplace: false });
    mounted.push(m);
    expect(cardBox(m.target).checked).toBe(false);
    const data = m.props.data as { graph: Record<string, unknown> };
    // Invalidation after a save: the server says listed=true now.
    m.props.data = { ...data, graph: { ...data.graph, listedOnMarketplace: true } };
    await tick();
    expect(cardBox(m.target).checked).toBe(true);
  });

  it('an unrelated data reload does NOT erase an unsaved tick', async () => {
    const m = await renderCard({ listedOnMarketplace: false });
    mounted.push(m);
    toggle(m.target, true);
    const data = m.props.data as { graph: Record<string, unknown> };
    m.props.data = { ...data, graph: { ...data.graph, description: 'refreshed' } };
    await tick();
    expect(cardBox(m.target).checked).toBe(true);
  });

  it('route replacement (another memory) reseeds from that memory’s row', async () => {
    const m = await renderCard({ listedOnMarketplace: true });
    mounted.push(m);
    expect(cardBox(m.target).checked).toBe(true);
    // A real navigation reruns the LOAD for the new memory — the graph row
    // AND the form set both come back for mem-2, so simulate both, not just
    // the graph (the fixture seeds the way the load does).
    const graphB = settingsGraph({ id: 'mem-2', visibility: 'PUBLIC', listedOnMarketplace: false });
    const formsB = await settingsForms(graphB);
    const data = m.props.data as Record<string, unknown>;
    m.props.data = { ...data, ...formsB, graph: graphB };
    await tick();
    expect(cardBox(m.target).checked).toBe(false);
  });

  // Gene's P2-1 on #1244: the page component is REUSED on a [id] navigation,
  // so a late result from memory A used to land on memory B's live form —
  // flipping B's checkbox and showing A's banner. The fence is the pair of
  // the memory-bound form id and the {#key g.id} remount; these pin both
  // delivery paths (result-after-navigation and result-already-on-the-page).
  it('a late SUCCESS from memory A never lands on memory B’s card', async () => {
    const m = await renderCard({ listedOnMarketplace: false });
    mounted.push(m);
    toggle(m.target, true);
    const deferred = await submitEnhancedDeferred(cardForm(m.target));
    // Navigate to B (unlisted) while A's save is in flight; the keyed card
    // remounts from B's own row.
    const graphB = settingsGraph({ id: 'mem-2', visibility: 'PUBLIC', listedOnMarketplace: false });
    const formsB = await settingsForms(graphB);
    const data = m.props.data as Record<string, unknown>;
    m.props.data = { ...data, ...formsB, graph: graphB };
    await tick();
    expect(cardBox(m.target).checked).toBe(false);
    // A's confirmation (listed=true, id …:mem-1) arrives NOW — it must match
    // no live form on B: no tick, no banner, no stuck pending.
    const late = await cardOutcome(true, true, 'mem-1');
    await deferred.finish(late);
    m.props.form = late.data;
    for (let i = 0; i < 5; i++) await tick();
    expect(cardBox(m.target).checked).toBe(false);
    expect(cardForm(m.target).textContent).not.toContain('Changes saved.');
    expect(saveButton(m.target).disabled).toBe(false);
  });

  it('a late REFUSAL from memory A never lands on memory B’s card', async () => {
    const m = await renderCard({ listedOnMarketplace: false });
    mounted.push(m);
    toggle(m.target, true);
    const deferred = await submitEnhancedDeferred(cardForm(m.target));
    const graphB = settingsGraph({ id: 'mem-2', visibility: 'PUBLIC', listedOnMarketplace: false });
    const formsB = await settingsForms(graphB);
    const data = m.props.data as Record<string, unknown>;
    m.props.data = { ...data, ...formsB, graph: graphB };
    await tick();
    const late = await cardOutcome(true, false, 'mem-1');
    await deferred.finish(late);
    m.props.form = late.data;
    for (let i = 0; i < 5; i++) await tick();
    expect(cardForm(m.target).textContent).not.toContain('Failed to update marketplace listing.');
    expect(cardBox(m.target).checked).toBe(false);
  });

  it('memory A’s result already on the page does not seed B’s card on navigation', async () => {
    const m = await renderCard({ listedOnMarketplace: false });
    mounted.push(m);
    toggle(m.target, true);
    await deliver(m.target, m.props, await cardOutcome(true, true));
    expect(cardForm(m.target).textContent).toContain('Changes saved.');
    // A's success is still the page's action data when the user navigates to
    // B: the remount must seed from B's own row, never from A's result.
    const graphB = settingsGraph({ id: 'mem-2', visibility: 'PUBLIC', listedOnMarketplace: false });
    const formsB = await settingsForms(graphB);
    const data = m.props.data as Record<string, unknown>;
    m.props.data = { ...data, ...formsB, graph: graphB };
    await tick();
    expect(cardBox(m.target).checked).toBe(false);
    expect(cardForm(m.target).textContent).not.toContain('Changes saved.');
  });
});
