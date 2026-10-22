/**
 * Shared fixture for the memory Settings page's sibling test files
 * (#695 retry-embeds-gate, #1163 vector-save, #841 marketplace-listing).
 *
 * The page mounts SIX Superforms instances and `superForm` is strict — it
 * throws when one is missing — so every test that renders this page must
 * build the same six-form set. #841 added the sixth form and had to patch two
 * fixture copies in lockstep (a third was one copy away from being missed);
 * that review finding is why the set lives here, once, seeded from the same
 * `graph` the way the route's real `load` seeds them.
 */
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import type { Memory } from '$lib/types';
import {
  deleteMemorySchema,
  marketplaceListingSchema,
  memorySchemaSettingsSchema,
  memorySettingsSchema,
  retryFailedEmbeddingsSchema,
  vectorIndexSettingsSchema,
} from './schema';

export const OWNER_ID = 'owner-1';
export const OWNER = { id: OWNER_ID, handle: 'holger', githubUsername: null, name: 'Holger', avatarUrl: null, roles: [] as string[] };
export const STRANGER = { ...OWNER, id: 'someone-else' };

/** A full `Memory` row as the settings page reads it — not a cast partial. */
export function settingsGraph(overrides: Partial<Memory> = {}): Memory {
  return {
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
    listedOnMarketplace: false,
    vectorIndexEnabled: false,
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
    ...overrides,
  };
}

/**
 * Every form the page mounts, validated with `errors: false` like the load
 * does. `formVectorIndexEnabled` seeds the vector checkbox separately from
 * the persisted flag, because the #695/#1163 tests turn exactly on the two
 * disagreeing.
 */
/**
 * `ref` is the URL's spelling of the memory — what the route's load receives
 * as `params.id` and stamps every form id with. It defaults to the row id
 * (the canonical spelling every in-app link produces), but a URN-addressed
 * render passes the URN: `params.id` is a ref, id OR URN
 * (hrn:node:hadronmemory.com:hadron-portal:review:route-param-may-be-a-ref),
 * and the stamps must follow the URL, not the row.
 */
export async function settingsForms(graph: Memory, formVectorIndexEnabled = graph.vectorIndexEnabled, ref = graph.id) {
  const [form, vectorForm, marketplaceForm, schemaForm, deleteForm, retryEmbedsForm] = await Promise.all([
    superValidate({}, zod4(memorySettingsSchema), { errors: false }),
    // Seeded from the graph exactly as the route's load seeds it — the
    // chunk fields' visibility gates on the form's embeddingSource
    // (#1255's pins turn on chunk fields being live at render time).
    superValidate(
      {
        vectorIndexEnabled: formVectorIndexEnabled,
        embeddingSource: graph.embeddingSource ?? 'abstract',
        chunkTokens: graph.chunkTokens != null ? String(graph.chunkTokens) : '',
        chunkOverlap: graph.chunkOverlap != null ? String(graph.chunkOverlap) : '',
        forceFixedSize: graph.forceFixedSize ?? false,
        acknowledgeVectorInversionRisk: false,
      },
      zod4(vectorIndexSettingsSchema),
      // Same explicit, memory-bound id as the load and `?/updateVectorIndex`
      // action (#1255) — an unstamped id ('') matches every other unstamped
      // form's data and results.
      { errors: false, id: `updateVectorIndex:${ref}` },
    ),
    // Seeded from the PERSISTED flag with the SAME explicit, memory-bound id
    // the route's load and action use (`…:${id}`) — the client form must
    // carry the load's id or a delivered result lands on the wrong form
    // (hrn:node:hadronmemory.com:hadron-portal:review:superforms-distinct-form-ids).
    superValidate({ listedOnMarketplace: graph.listedOnMarketplace ?? false }, zod4(marketplaceListingSchema), { errors: false, id: `updateMarketplaceListing:${ref}` }),
    superValidate(
      { schemaJson: graph.schema != null ? JSON.stringify(graph.schema, null, 2) : '' },
      zod4(memorySchemaSettingsSchema),
      // Same explicit, memory-bound id as the load and `?/updateSchema`
      // action (#1255).
      { errors: false, id: `updateSchema:${ref}` },
    ),
    superValidate({ organizationId: 'org-1' }, zod4(deleteMemorySchema), { errors: false }),
    superValidate({}, zod4(retryFailedEmbeddingsSchema), { errors: false }),
  ]);
  return { form, vectorForm, marketplaceForm, schemaForm, deleteForm, retryEmbedsForm };
}
