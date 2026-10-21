/**
 * #695 — the re-drive control is gated on the SAVED vector-index state.
 *
 * The trap this pins: the page has a live `vectorIndexEnabled` CHECKBOX bound
 * to `$vectorForm`, and a persisted `g.vectorIndexEnabled` on the loaded
 * memory. They disagree exactly when the user has ticked the box and not
 * saved — and gating on the checkbox is the reading that looks right in the
 * diff, because it is the value the rest of that form uses.
 *
 * On an unsaved tick the memory is not indexed yet, so `retryFailedEmbeddings`
 * returns 0 — and 0 renders as "No failed embeddings to re-drive.", which is a
 * true sentence about a false premise. The memory has no index at all.
 * hrn:node:hadronmemory.com:hadron-portal:review:control-gated-on-the-fact-not-a-summary.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage, page } from '$lib/test/stubs/app-stores';
import { submitEnhancedWithResult } from '$lib/test/stubs/app-forms';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Memory } from '$lib/types';
import {
  deleteMemorySchema,
  memorySchemaSettingsSchema,
  memorySettingsSchema,
  retryFailedEmbeddingsSchema,
  vectorIndexSettingsSchema,
} from './schema';

import Page from './+page.svelte';

const RETRY_CONTROL = 'Retry failed embeds';

const OWNER_ID = 'owner-1';
const OWNER = { id: OWNER_ID, handle: 'holger', githubUsername: null, name: 'Holger', avatarUrl: null, roles: [] as string[] };
const STRANGER = { ...OWNER, id: 'someone-else' };

async function renderSettings(opts: {
  /** The PERSISTED state — what the memory actually is. */
  savedVectorIndexEnabled: boolean;
  /** Who is looking. Defaults to the memory's owner. */
  user?: typeof OWNER;
  /** The viewer's role in the memory's org, when they have one. */
  orgRole?: 'ADMIN' | 'OWNER' | 'READER';
  /** The checkbox's initial value — what the user may have just ticked. */
  formVectorIndexEnabled?: boolean;
  /** An `ActionData`-shaped result from a previous submit, if any. */
  actionData?: unknown;
  graphOverrides?: Partial<Memory>;
  transferCanDelete?: boolean;
  ownerUserId?: string | null;
}) {
  // A full `Memory`, not a cast partial. The page reads far more of it than
  // this test cares about, and a cast would let the next field it learns to
  // read arrive `undefined` at runtime with the suite still green.
  const graph: Memory = {
    id: 'mem-1',
    name: 'Docs',
    urn: 'hrn:mem:acme.com:docs',
    class: 'knowledge',
    isEncrypted: false,
    organizationId: 'org-1',
    userId: OWNER_ID,
    shortDescription: null,
    description: null,
    tags: [],
    license: null,
    category0: null,
    category1: null,
    category2: null,
    iconUrl: null,
    heroUrl: null,
    homeUrl: null,
    source: null,
    readBranch: null,
    writeBranch: null,
    visibility: 'ORGANIZATION',
    vectorIndexEnabled: opts.savedVectorIndexEnabled,
    embeddingSource: 'abstract',
    chunkTokens: null,
    chunkOverlap: null,
    forceFixedSize: false,
    vectorIndexEncryptedAckAt: null,
    schema: null,
    syncStatus: 'OK',
    syncError: null,
    pendingEdgeCount: 0,
    lastSyncedAt: null,
    createdAt: '1789430400000',
    updatedAt: '1789430400000',
    ...opts.graphOverrides,
  };

  const [form, vectorForm, schemaForm, deleteForm, retryEmbedsForm] = await Promise.all([
    superValidate({}, zod4(memorySettingsSchema), { errors: false }),
    superValidate(
      {
        vectorIndexEnabled: opts.formVectorIndexEnabled ?? opts.savedVectorIndexEnabled,
        embeddingSource: 'abstract' as const,
        chunkTokens: '',
        chunkOverlap: '',
        forceFixedSize: false,
        acknowledgeVectorInversionRisk: false,
      },
      zod4(vectorIndexSettingsSchema),
      { errors: false },
    ),
    superValidate({ schemaJson: '' }, zod4(memorySchemaSettingsSchema), { errors: false }),
    superValidate({ organizationId: 'org-1' }, zod4(deleteMemorySchema), { errors: false }),
    superValidate({}, zod4(retryFailedEmbeddingsSchema), { errors: false }),
  ]);

  // `graph` above is typed as a full `Memory` deliberately — it is what this
  // page reads, so a missing or mistyped field there is a real defect the
  // compiler should catch. The ENVELOPE is cast, matching the convention in
  // this repo's other route SSR tests (`apps/[appId]/runs/page.test.ts`,
  // `setup/page.test.ts`): `PageData` here is the whole inherited layout chain
  // — user, org, activeOrgId, impersonation and a dozen more — none of which
  // this page's vector-index section touches. Reconstructing all of it would
  // add fixture surface without adding a single assertion.
  //
  // The cost of that cast, paid once here: an earlier edit left DUPLICATE
  // `owner` / `ownerUserId` keys in this literal, the later `null` pair won,
  // and every gate case failed for a reason that had nothing to do with the
  // gate. TypeScript flags a duplicate key — `as never` does not.
  const props = reactiveProps<Record<string, unknown>>({
      data: {
        graph,
        user: opts.user ?? OWNER,
        ownerUserId: opts.ownerUserId === undefined ? OWNER_ID : opts.ownerUserId,
        owner: opts.ownerUserId === null ? null : { id: OWNER_ID, handle: 'holger', name: 'Holger' },
        org: opts.orgRole
          ? { id: 'org-1', members: [{ user: { id: (opts.user ?? OWNER).id }, role: opts.orgRole }] }
          : null,
        allOrgs: [],
        transferCanDelete: opts.transferCanDelete ?? false,
        form,
        vectorForm,
        schemaForm,
        deleteForm,
        retryEmbedsForm,
      } as never,
      form: (opts.actionData ?? null) as never,
  });
  setStubPage('http://localhost/app/memories/mem-1/settings', {id: 'mem-1'});
  page.update(p => ({...p, data: props.data as Record<string, unknown>}));
  const m = mountComponent(Page as never, props as never) as Mounted<Record<string, unknown>>;
  mounted.push(m);
  await tick();
  return {...m, props};
}


const mounted: Array<Mounted<Record<string, unknown>>> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); });
function checkbox(target: HTMLElement) { return target.querySelector<HTMLInputElement>('form[action="?/updateVectorIndex"] input[type="checkbox"]')!; }
function toggle(target: HTMLElement, enabled: boolean) {
  const box = checkbox(target); box.checked = enabled; box.dispatchEvent(new Event('change', {bubbles: true})); flushSync();
}
async function result(target: HTMLElement, props: Record<string, unknown>, enabled: boolean, success: boolean) {
  const validated = await superValidate({vectorIndexEnabled: enabled, embeddingSource: 'abstract', chunkTokens: '', chunkOverlap: '', forceFixedSize: false, acknowledgeVectorInversionRisk: false}, zod4(vectorIndexSettingsSchema));
  validated.message = {type: success ? 'success' : 'error', text: success ? 'Changes saved.' : 'Save failed.'};
  const outcome = {type: success ? 'success' as const : 'failure' as const, status: success ? 200 : 500, data: {form: validated}};
  const sent = await submitEnhancedWithResult(target.querySelector<HTMLFormElement>('form[action="?/updateVectorIndex"]')!, outcome);
  expect(sent.cancelled).toBe(false);
  props.form = outcome.data;
  for (let i = 0; i < 5; i++) await tick();
}
describe('vector index save state (#1163)', () => {
  it.each([false, true])('keeps the saved toggle when initial state is %s', async (initial) => {
    const {target, props} = await renderSettings({savedVectorIndexEnabled: initial});
    toggle(target, !initial);
    await result(target, props, !initial, true);
    expect(checkbox(target).checked).toBe(!initial);
  });
  it('retains edit intent after a failed save', async () => {
    const {target, props} = await renderSettings({savedVectorIndexEnabled: false});
    toggle(target, true);
    await result(target, props, true, false);
    expect(checkbox(target).checked).toBe(true);
    expect(target.textContent).toContain('Save failed.');
  });
  it('does not discard a draft on an unrelated data reload', async () => {
    const {target, props} = await renderSettings({savedVectorIndexEnabled: false});
    toggle(target, true);
    const data = props.data as {graph: Record<string, unknown>};
    props.data = {...data, graph: {...data.graph, description: 'new description'}};
    await tick();
    expect(checkbox(target).checked).toBe(true);
  });
  it('reseeds on persisted configuration changes, then preserves later unsaved edits', async () => {
    const {target, props} = await renderSettings({savedVectorIndexEnabled: false});
    const data = props.data as {graph: Record<string, unknown>};
    props.data = {...data, graph: {...data.graph, vectorIndexEnabled: true, embeddingSource: 'both', chunkTokens: 256}};
    await tick();
    expect(checkbox(target).checked).toBe(true);
    expect(target.querySelector<HTMLInputElement>('#chunkTokens')!.value).toBe('256');
    toggle(target, false);
    props.data = {...props.data as object};
    await tick();
    expect(checkbox(target).checked).toBe(false);
  });
  it('revisiting the settings page starts from the saved value', async () => {
    const first = await renderSettings({savedVectorIndexEnabled: false});
    toggle(first.target, true);
    await result(first.target, first.props, true, true);
    first.unmount();
    const second = await renderSettings({savedVectorIndexEnabled: true});
    expect(checkbox(second.target).checked).toBe(true);
  });
  it('navigation to another memory resets the prior draft', async () => {
    const {target, props} = await renderSettings({savedVectorIndexEnabled: false});
    toggle(target, true);
    const data = props.data as {graph: Record<string, unknown>};
    props.data = {...data, graph: {...data.graph, id: 'mem-2', vectorIndexEnabled: false}};
    await tick();
    expect(checkbox(target).checked).toBe(false);
  });

});
