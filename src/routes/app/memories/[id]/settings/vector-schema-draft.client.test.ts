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

async function renderSettings(graph: Memory, ref = 'mem-1') {
  const forms = await settingsForms(graph, undefined, ref);
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
  setStubPage(`http://localhost/app/memories/${ref}/settings`, { id: ref });
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
async function schemaOutcome(ref = 'mem-1') {
  const validated = await superValidate({}, zod4(memorySchemaSettingsSchema), { errors: false, id: `updateSchema:${ref}` });
  validated.message = { type: 'success', text: 'Schema saved.' };
  return { type: 'success' as const, status: 200, data: { form: validated } };
}

/** kit's invalidateAll step: page.data replaced wholesale, page.form untouched. */
async function refreshData(m: { props: Record<string, unknown> }, refreshedGraph: Memory, ref = refreshedGraph.id) {
  const forms = await settingsForms(refreshedGraph, undefined, ref);
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

  it('keeps a late encrypted-ack refusal from mem-1 off mem-2\'s vector checkbox after a [id] navigation', async () => {
    // #1255 second fence: onResult runs BEFORE superforms' id gate, so the
    // stamped id alone does not stop the callback's writes — a late mem-1
    // refusal (needsEncryptedAck) would force mem-2's checkbox on and open
    // its disclosure. The callback must fence itself on the result's stamp.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 }));
    mounted.push(m);
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!);
    await refreshData(m, settingsGraph({ visibility: 'PUBLIC', id: 'mem-2', vectorIndexEnabled: false, embeddingSource: 'contentChunks', chunkTokens: 250, chunkOverlap: 25 }));
    const enableBox = () => m.target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!;
    expect(enableBox().checked).toBe(false);
    const refusal = await vectorOutcome('mem-1', { chunkTokens: '300', chunkOverlap: '30' });
    await deferred.finish({ type: 'failure', status: 400, data: { form: refusal.data.form, needsEncryptedAck: true } });
    await settle();
    expect(enableBox().checked).toBe(false);
    expect(m.target.textContent).not.toContain('Enabling vector search on an encrypted memory');
  });

  it('keeps a late success from mem-1 from clearing mem-2\'s disclosure', async () => {
    // The pre-state (mem-2's disclosure open) is set BEFORE the deferred
    // starts because every attempt-save path is disabled while a submit is
    // in flight; what the pin proves is the fence — a result stamped for
    // mem-1 reaching the onResult callback while mem-2 is shown must not
    // clear mem-2's confirmation state.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', vectorIndexEnabled: true, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 }));
    mounted.push(m);
    await refreshData(m, settingsGraph({ visibility: 'PUBLIC', id: 'mem-2', isEncrypted: true, vectorIndexEnabled: false, embeddingSource: 'contentChunks', chunkTokens: 250, chunkOverlap: 25 }));
    const enableBox = () => m.target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!;
    enableBox().checked = true;
    enableBox().dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    const save = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save vector index settings')!;
    save.click();
    flushSync();
    expect(m.target.textContent).toContain('Enabling vector search on an encrypted memory');
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!);
    await deferred.finish(await vectorOutcome('mem-1', { chunkTokens: '300', chunkOverlap: '30' }));
    await settle();
    expect(m.target.textContent).toContain('Enabling vector search on an encrypted memory');
  });

  it('still applies an encrypted-ack refusal stamped for the memory shown (same-memory control)', async () => {
    // The fence must not swallow the refusal it exists to protect: on the
    // SAME memory, needsEncryptedAck still forces the enable intent and
    // opens the disclosure.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', isEncrypted: true, vectorIndexEnabled: false, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 }));
    mounted.push(m);
    const enableBox = () => m.target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!;
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!);
    const refusal = await vectorOutcome('mem-1', { chunkTokens: '300', chunkOverlap: '30' });
    await deferred.finish({ type: 'failure', status: 400, data: { form: refusal.data.form, needsEncryptedAck: true } });
    await settle();
    expect(enableBox().checked).toBe(true);
    expect(m.target.textContent).toContain('Enabling vector search on an encrypted memory');
  });

  it('still applies an encrypted-ack refusal on a URN-addressed page (same-memory control, ref spelling)', async () => {
    // Gil's delta P2 at c62905f: the fence rebuilt its comparison stamp
    // from g.id (the UUID), but load, action and client all stamp from
    // params.id — the URL's REF spelling, which may be a URN
    // (hrn:node:hadronmemory.com:hadron-portal:review:route-param-may-be-a-ref).
    // On a URN-addressed settings URL every own result looked foreign and
    // was swallowed: the encrypted-ack backstop never opened. The fence
    // must compare against the form's LIVE id, exactly what superforms
    // gates on — never a stamp rebuilt from the row.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', isEncrypted: true, vectorIndexEnabled: false, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 }), 'hrn:mem:acme.com:docs');
    mounted.push(m);
    const enableBox = () => m.target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!;
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!);
    const refusal = await vectorOutcome('hrn:mem:acme.com:docs', { chunkTokens: '300', chunkOverlap: '30' });
    await deferred.finish({ type: 'failure', status: 400, data: { form: refusal.data.form, needsEncryptedAck: true } });
    await settle();
    expect(enableBox().checked).toBe(true);
    expect(m.target.textContent).toContain('Enabling vector search on an encrypted memory');
  });

  it('applies B\'s own refusal after an A→B navigation when B is URN-addressed (re-stamp adopts the load\'s spelling)', async () => {
    // The re-stamp half of the same P2: rebuilding the stamp from g.id
    // re-spells a URN-addressed memory as its UUID after a [id]
    // navigation, and the page's OWN results then mismatch. The re-stamp
    // must ADOPT the fresh load's stamp (data.vectorForm.id), which
    // carries the URL's ref spelling.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', isEncrypted: true, vectorIndexEnabled: false, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 }));
    mounted.push(m);
    await refreshData(m, settingsGraph({ visibility: 'PUBLIC', id: 'mem-2', isEncrypted: true, vectorIndexEnabled: false, embeddingSource: 'contentChunks', chunkTokens: 250, chunkOverlap: 25 }), 'hrn:mem:acme.com:beta');
    const enableBox = () => m.target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!;
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!);
    const refusal = await vectorOutcome('hrn:mem:acme.com:beta', { chunkTokens: '250', chunkOverlap: '25' });
    await deferred.finish({ type: 'failure', status: 400, data: { form: refusal.data.form, needsEncryptedAck: true } });
    await settle();
    expect(enableBox().checked).toBe(true);
    expect(m.target.textContent).toContain('Enabling vector search on an encrypted memory');
  });

  it('still clears the schema clearing-confirmation on a URN-addressed page after an own schema save', async () => {
    // Schema half of the same P2: an own success stamped with the URL's
    // ref spelling must still clear the clearing-confirmation.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', schema: { title: 'string' } }), 'hrn:mem:acme.com:docs');
    mounted.push(m);
    setDraft(m.target, schemaArea(m.target), '');
    const save = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save schema')!;
    save.click();
    flushSync();
    expect(m.target.textContent).toContain("Remove this memory's schema?");
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(SCHEMA)!);
    const outcome = await schemaOutcome('hrn:mem:acme.com:docs');
    await deferred.finish(outcome);
    await settle();
    expect(m.target.textContent).not.toContain("Remove this memory's schema?");
  });

  it('clears B\'s schema clearing-confirmation after an A→B navigation when B is URN-addressed', async () => {
    // The schema re-stamp half: after navigating to a URN-addressed B, an
    // own schema success must still apply (the re-stamp adopts
    // data.schemaForm.id, and the fence reads the live id).
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', schema: { title: 'string' } }));
    mounted.push(m);
    await refreshData(m, settingsGraph({ visibility: 'PUBLIC', id: 'mem-2', schema: { other: 'thing' } }), 'hrn:mem:acme.com:beta');
    setDraft(m.target, schemaArea(m.target), '');
    const save = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save schema')!;
    save.click();
    flushSync();
    expect(m.target.textContent).toContain("Remove this memory's schema?");
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(SCHEMA)!);
    const outcome = await schemaOutcome('hrn:mem:acme.com:beta');
    await deferred.finish(outcome);
    await settle();
    expect(m.target.textContent).not.toContain("Remove this memory's schema?");
  });

  it('keeps a late success from mem-1 from clearing mem-2\'s schema clearing-confirmation', async () => {
    // Pre-state first (the clear-confirmation is only reachable via Save
    // schema, disabled while a submit is in flight), then the deferred —
    // the fence under test is the onResult id check, same as the vector
    // pin above.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC', schema: { title: 'string' } }));
    mounted.push(m);
    await refreshData(m, settingsGraph({ visibility: 'PUBLIC', id: 'mem-2', schema: { other: 'thing' } }));
    setDraft(m.target, schemaArea(m.target), '');
    const save = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save schema')!;
    save.click();
    flushSync();
    expect(m.target.textContent).toContain("Remove this memory's schema?");
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(SCHEMA)!);
    const outcome = await schemaOutcome();
    outcome.data.form.id = 'updateSchema:mem-1';
    await deferred.finish(outcome);
    await settle();
    expect(m.target.textContent).toContain("Remove this memory's schema?");
  });

  it('adopts the loader\'s URN stamp on a same-memory id→URN navigation (own refusal must apply)', async () => {
    // Gene's scoped delta P2 at 6d9eec8: navigating mem-1 →
    // hrn:mem:acme.com:docs (SAME memory, different ref spelling) leaves
    // g.id unchanged, so a re-stamp gated on g.id never fires; the live
    // form id keeps the id spelling while the loader/actions now stamp
    // the URN — the next OWN result fails both resultIsForForm and the
    // library id gate. Adoption must key on the LOADED STAMP, not the
    // entity id.
    const g1 = settingsGraph({ visibility: 'PUBLIC', isEncrypted: true, vectorIndexEnabled: false, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 });
    const m = await renderSettings(g1);
    mounted.push(m);
    await refreshData(m, g1, 'hrn:mem:acme.com:docs');
    const enableBox = () => m.target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!;
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!);
    const refusal = await vectorOutcome('hrn:mem:acme.com:docs', { chunkTokens: '300', chunkOverlap: '30' });
    await deferred.finish({ type: 'failure', status: 400, data: { form: refusal.data.form, needsEncryptedAck: true } });
    await settle();
    expect(enableBox().checked).toBe(true);
    expect(m.target.textContent).toContain('Enabling vector search on an encrypted memory');
  });

  it('adopts the loader\'s id stamp on a same-memory URN→id navigation (own refusal must apply)', async () => {
    // The reverse spelling: URN-addressed mount, then the same memory
    // addressed by its id. Same predicate gap, other direction.
    const g1 = settingsGraph({ visibility: 'PUBLIC', isEncrypted: true, vectorIndexEnabled: false, embeddingSource: 'contentChunks', chunkTokens: 300, chunkOverlap: 30 });
    const m = await renderSettings(g1, 'hrn:mem:acme.com:docs');
    mounted.push(m);
    await refreshData(m, g1, 'mem-1');
    const enableBox = () => m.target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!;
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!);
    const refusal = await vectorOutcome('mem-1', { chunkTokens: '300', chunkOverlap: '30' });
    await deferred.finish({ type: 'failure', status: 400, data: { form: refusal.data.form, needsEncryptedAck: true } });
    await settle();
    expect(enableBox().checked).toBe(true);
    expect(m.target.textContent).toContain('Enabling vector search on an encrypted memory');
  });

  it('adopts the schema loader\'s URN stamp on a same-memory id→URN navigation (own success must clear)', async () => {
    // Schema twin of Gene's P2, id→URN direction. The draft set before
    // Save survives the spelling navigation (same memory, same stored
    // schema — the value reseed must NOT fire on a spelling change).
    const g1 = settingsGraph({ visibility: 'PUBLIC', schema: { title: 'string' } });
    const m = await renderSettings(g1);
    mounted.push(m);
    await refreshData(m, g1, 'hrn:mem:acme.com:docs');
    setDraft(m.target, schemaArea(m.target), '');
    const save = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save schema')!;
    save.click();
    flushSync();
    expect(m.target.textContent).toContain("Remove this memory's schema?");
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(SCHEMA)!);
    await deferred.finish(await schemaOutcome('hrn:mem:acme.com:docs'));
    await settle();
    expect(m.target.textContent).not.toContain("Remove this memory's schema?");
  });

  it('adopts the schema loader\'s id stamp on a same-memory URN→id navigation (own success must clear)', async () => {
    // Schema twin, URN→id direction.
    const g1 = settingsGraph({ visibility: 'PUBLIC', schema: { title: 'string' } });
    const m = await renderSettings(g1, 'hrn:mem:acme.com:docs');
    mounted.push(m);
    await refreshData(m, g1, 'mem-1');
    setDraft(m.target, schemaArea(m.target), '');
    const save = [...m.target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save schema')!;
    save.click();
    flushSync();
    expect(m.target.textContent).toContain("Remove this memory's schema?");
    const deferred = await submitEnhancedDeferred(m.target.querySelector<HTMLFormElement>(SCHEMA)!);
    await deferred.finish(await schemaOutcome('mem-1'));
    await settle();
    expect(m.target.textContent).not.toContain("Remove this memory's schema?");
  });

  it('reseeds the schema editor on a [id] navigation even when both memories share the same stored schema', async () => {
    // Charles's browser finding at 02491b1: with 'never' opting out of the
    // page.data rebind, the resync tracked only the STORED schema — A→B
    // with both null never fired it and A's draft carried onto B. The
    // resync must track the memory itself.
    const m = await renderSettings(settingsGraph({ visibility: 'PUBLIC' }));
    mounted.push(m);
    setDraft(m.target, schemaArea(m.target), '{"title": "string"}');
    await refreshData(m, settingsGraph({ visibility: 'PUBLIC', id: 'mem-2' }));
    await settle();
    expect(schemaArea(m.target).value).toBe('');
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
