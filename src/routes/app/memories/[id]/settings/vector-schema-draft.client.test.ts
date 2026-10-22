/**
 * portal#1255 — an unsaved vector-index or schema draft must survive a REAL
 * sibling save. Same defect class as portal#1248 (the marketplace card): a
 * sibling save that invalidates all loaders replaces page.data wholesale
 * while page.form is still empty, and superForm's page subscription rebinds
 * the form from that fresh data, discarding the draft, taint
 * notwithstanding. The default form id is a hash of the schema's SHAPE
 * (superforms 2.30.x, adapters.js) — stable across calls for one schema —
 * so the fresh load's form matches the mounted one and the rebind fires
 * even without an explicit id; only applyAction:'never' opts the form out.
 *
 * The sibling saves run in kit's actual order (page.data replaced BEFORE
 * the ActionResult arrives as page.form — the order is load-bearing, see
 * marketplace-draft.client.test.ts) through the real superforms handlers:
 * the Memory card (`?/update`) and the schema form itself
 * (`?/updateSchema`). The controls pin what each form's own gates must keep
 * doing: reseed on a changed persisted value, reseed on a memory navigation.
 *
 * The memory-bound ids are pinned separately, for what they actually buy:
 * a LATE own-action result (this form's submit completing after a [id]
 * navigation reused the page component) must not land on the new memory's
 * form — the id-gated page.form branch is live even under 'never', so the
 * fence is the id mismatch alone (default shape hashes are NOT
 * memory-bound and do match). Same fence as the marketplace card (#1244).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { flushSync } from 'svelte';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { submitEnhancedDeferred } from '$lib/test/stubs/app-forms';
import type { Memory } from '$lib/types';
import { memorySettingsSchema, memorySchemaSettingsSchema, vectorIndexSettingsSchema } from './schema';
import { OWNER, OWNER_ID, settingsForms, settingsGraph } from './settings-page.fixture';

vi.mock('$app/environment', () => ({ browser: true, dev: false, building: false, version: 'test' }));

import Page from './+page.svelte';

const MEMORY = 'form#graph-settings';
const SCHEMA = 'form[action="?/updateSchema"]';

async function renderSettings(graph: Memory) {
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

function chunkInput(target: HTMLElement) {
  return target.querySelector<HTMLInputElement>('#chunkTokens')!;
}
function schemaArea(target: HTMLElement) {
  return target.querySelector<HTMLTextAreaElement>('#schemaJson')!;
}
function setDraft(target: HTMLElement, el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** The result `?/update` answers with, built as the action does. */
async function memoryOutcome() {
  const validated = await superValidate({}, zod4(memorySettingsSchema), { errors: false });
  validated.message = { type: 'success', text: 'Memory updated.' };
  return { type: 'success' as const, status: 200, data: { form: validated } };
}

/** The result `?/updateVectorIndex` answers with, built as the action
 * does: the form carries the server's canonical saved values (the #1163
 * discipline) under the same memory-bound id the action stamps. */
async function vectorOutcome(memoryId: string, canonical: { chunkTokens: string; chunkOverlap: string }) {
  const validated = await superValidate(
    {
      vectorIndexEnabled: true,
      embeddingSource: 'contentChunks',
      chunkTokens: canonical.chunkTokens,
      chunkOverlap: canonical.chunkOverlap,
      forceFixedSize: false,
      acknowledgeVectorInversionRisk: false,
    },
    zod4(vectorIndexSettingsSchema),
    { id: `updateVectorIndex:${memoryId}` },
  );
  validated.message = { type: 'success', text: 'Changes saved.' };
  return { type: 'success' as const, status: 200, data: { form: validated } };
}

/** The result `?/updateSchema` answers with, built as the action does. */
async function schemaOutcome() {
  const validated = await superValidate({}, zod4(memorySchemaSettingsSchema), { errors: false, id: 'updateSchema:mem-1' });
  validated.message = { type: 'success', text: 'Schema saved.' };
  return { type: 'success' as const, status: 200, data: { form: validated } };
}

/** kit's invalidateAll step: page.data replaced wholesale, page.form untouched. */
async function refreshData(m: { props: Record<string, unknown> }, refreshedGraph: Memory) {
  const forms = await settingsForms(refreshedGraph);
  m.props.data = { ...(m.props.data as Record<string, unknown>), graph: refreshedGraph, ...forms };
  page.update((p) => ({ ...p, data: m.props.data as Record<string, unknown> }));
}

async function settle() {
  for (let i = 0; i < 5; i++) await tick();
}

/** A real Memory-card save, in kit's order: data first, ActionResult second. */
async function siblingEditSave(m: { target: HTMLElement; props: Record<string, unknown> }, refreshedGraph: Memory) {
  const edit = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Edit')!;
  edit.click();
  flushSync();
  const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(MEMORY)!);
  const outcome = await memoryOutcome();
  await refreshData(m, refreshedGraph);
  m.props.form = outcome.data;
  await deferred.finish(outcome);
  await settle();
}

/** A real schema-form save as the sibling, same order. */
async function siblingSchemaSave(m: { target: HTMLElement; props: Record<string, unknown> }, refreshedGraph: Memory) {
  const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(SCHEMA)!);
  const outcome = await schemaOutcome();
  await refreshData(m, refreshedGraph);
  m.props.form = outcome.data;
  await deferred.finish(outcome);
  await settle();
}

describe('vector/schema drafts vs a real sibling save (portal#1255)', () => {
  it('keeps an unsaved vector draft when the Memory card is saved', async () => {
    // embeddingSource includes chunks, or the chunk fields do not render
    // (viSourceIncludesChunks gates them).
    const persisted = { visibility: 'PUBLIC', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 } as Partial<Memory>;
    const m = await renderSettings(settingsGraph(persisted));
    mounted.push(m);
    setDraft(m.target, chunkInput(m.target), '777');
    await siblingEditSave(m, settingsGraph(persisted));
    expect(chunkInput(m.target).value).toBe('777');
  });

  it('keeps an unsaved vector draft when the schema form is saved', async () => {
    // embeddingSource includes chunks, or the chunk fields do not render
    // (viSourceIncludesChunks gates them).
    const persisted = { visibility: 'PUBLIC', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 } as Partial<Memory>;
    const m = await renderSettings(settingsGraph(persisted));
    mounted.push(m);
    setDraft(m.target, chunkInput(m.target), '777');
    await siblingSchemaSave(m, settingsGraph(persisted));
    expect(chunkInput(m.target).value).toBe('777');
  });

  it('keeps an unsaved schema draft when the Memory card is saved', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC' }));
    mounted.push(m);
    setDraft(m.target, schemaArea(m.target), '{"title": "string"}');
    await siblingEditSave(m, settingsGraph({ visibility: 'PUBLIC' }));
    expect(schemaArea(m.target).value).toBe('{"title": "string"}');
  });

  it('reseeds the vector form when the persisted configuration changed behind the save', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 300 }));
    mounted.push(m);
    expect(chunkInput(m.target).value).toBe('300');
    await siblingEditSave(m, settingsGraph({ visibility: 'PUBLIC', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 512 }));
    expect(chunkInput(m.target).value).toBe('512');
  });

  it('reseeds the schema editor when the persisted schema changed behind the save', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC' }));
    mounted.push(m);
    expect(schemaArea(m.target).value).toBe('');
    const next = settingsGraph({ visibility: 'PUBLIC', schema: { title: 'string' } });
    await siblingEditSave(m, next);
    expect(schemaArea(m.target).value).toBe(JSON.stringify({ title: 'string' }, null, 2));
  });

  it('keeps a late own-action result from mem-1 off mem-2\'s vector form after a [id] navigation', async () => {
    // The id half of the fix: the page.form branch that applies action
    // results is id-gated but live even under applyAction:'never' (own
    // results must arrive through it). Default ids are schema shape hashes
    // — NOT memory-bound — so without the stamp a late mem-1 result still
    // matches mem-2's freshly seeded form (same shape) and overwrites it.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 }));
    mounted.push(m);
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!);
    await refreshData(m, settingsGraph({ visibility: 'PUBLIC', id: 'mem-2', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 250, chunkOverlap: 25 }));
    expect(chunkInput(m.target).value).toBe('250');
    await deferred.finish(await vectorOutcome('mem-1', { chunkTokens: '300', chunkOverlap: '30' }));
    await settle();
    expect(chunkInput(m.target).value).toBe('250');
  });

  it('keeps a late own-action result from mem-1 off mem-2\'s schema editor after a [id] navigation', async () => {
    const mem1 = settingsGraph({ visibility: 'PUBLIC', schema: { title: 'string' } });
    const m = await renderSettings(mem1);
    mounted.push(m);
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(SCHEMA)!);
    await refreshData(m, settingsGraph({ visibility: 'PUBLIC', id: 'mem-2', schema: { other: 'thing' } }));
    const mem2Value = JSON.stringify({ other: 'thing' }, null, 2);
    expect(schemaArea(m.target).value).toBe(mem2Value);
    const outcome = await schemaOutcome();
    outcome.data.form.id = 'updateSchema:mem-1';
    outcome.data.form.data.schemaJson = JSON.stringify({ title: 'string' }, null, 2);
    await deferred.finish(outcome);
    await settle();
    expect(schemaArea(m.target).value).toBe(mem2Value);
  });

  it('keeps the schema editor on the saved text after its own successful save (resetForm: false)', async () => {
    // resetForm:false — a successful save keeps the action's returned form
    // (the submitted schemaJson under the stamped id) instead of resetting
    // to the pre-save load values; the reseed-to-persisted correction only
    // comes later, when the loader refresh lands.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC' }));
    mounted.push(m);
    setDraft(m.target, schemaArea(m.target), '{"title": "string"}');
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(SCHEMA)!);
    const outcome = await schemaOutcome();
    outcome.data.form.data.schemaJson = '{"title": "string"}';
    await deferred.finish(outcome);
    await settle();
    expect(schemaArea(m.target).value).toBe('{"title": "string"}');
  });

  it('reseeds the vector form on a memory navigation', async () => {
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 300 }));
    mounted.push(m);
    setDraft(m.target, chunkInput(m.target), '777');
    const other = settingsGraph({ visibility: 'PUBLIC', id: 'mem-2', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: null });
    await refreshData(m, other);
    await settle();
    expect(chunkInput(m.target).value).toBe('');
  });
});
