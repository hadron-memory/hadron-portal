import { rulebookAvailable } from '$lib/server/memory-config/service';
import { fail, redirect, isRedirect } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms/adapters';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError, extractGqlErrorCode } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
import {
  UPDATE_MEMORY_MUTATION,
  DELETE_MEMORY_MUTATION,
  RETRY_FAILED_EMBEDDINGS_MUTATION,
  VALIDATE_MEMORY_QUERY,
  ORGANIZATIONS_QUERY,
  RESOLVE_URN_QUERY,
  TRANSFER_MEMORY_OWNERSHIP_MUTATION,
  MEMORY_TRANSFER_ACCESS_QUERY,
  USER_PROFILE_QUERY,
} from '$lib/server/queries';
import { VECTOR_HEALTH_LIMIT, embedFailedView, type ValidateMemoryResult } from '$lib/vector-health';
import { toBareMemorySlugInput } from '$lib/urn/form-validation';
import type { Memory, Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  deleteMemorySchema,
  memorySchemaSettingsSchema,
  marketplaceListingSchema,
  memorySettingsSchema,
  retryFailedEmbeddingsSchema,
  previewTransferSchema,
  applyTransferSchema,
  vectorIndexSettingsSchema,
} from './schema';
import { limitRefusal } from '$lib/server/limit-refusal';

const memorySettingsFormAdapter = zod4(memorySettingsSchema);
const vectorIndexSettingsFormAdapter = zod4(vectorIndexSettingsSchema);
const marketplaceListingFormAdapter = zod4(marketplaceListingSchema);
const memorySchemaSettingsFormAdapter = zod4(memorySchemaSettingsSchema);
const deleteMemoryFormAdapter = zod4(deleteMemorySchema);
const retryFailedEmbeddingsFormAdapter = zod4(retryFailedEmbeddingsSchema);
type MemorySettingsForm = Infer<typeof memorySettingsSchema, 'zod4'>;
type VectorIndexSettingsForm = Infer<typeof vectorIndexSettingsSchema, 'zod4'>;
type MarketplaceListingForm = Infer<typeof marketplaceListingSchema, 'zod4'>;
type MemorySchemaSettingsForm = Infer<typeof memorySchemaSettingsSchema, 'zod4'>;
type DeleteMemoryForm = Infer<typeof deleteMemorySchema, 'zod4'>;
type RetryFailedEmbeddingsForm = Infer<typeof retryFailedEmbeddingsSchema, 'zod4'>;

export type MemoryOwnerTransferPreview = {
  memoryId: string;
  oldUrn: string;
  newUrn: string;
  fromOwner: string;
  toOwner: string;
  currentClass: string;
  targetClass: string;
  dependents: { kind: string; count: number; handling: 'CARRY' | 'REFUSE' | 'REMOVE' | 'CREATE' }[];
  blockers: { code: string; message: string }[];
  canApply: boolean;
  applied: boolean;
};

// FR-026: enabling the vector index on an encrypted memory without
// acknowledging the embedding-inversion disclosure fails with this code.
// The portal detects the case client-side and sends
// acknowledgeVectorInversionRisk; this is the server-side backstop so the
// disclosure can still be surfaced if proactive detection ever misses.
function isEncryptedAckError(e: unknown): boolean {
  if (e && typeof e === 'object' && 'response' in e) {
    // `response` may be null/undefined here — this runs in a catch path, so a
    // TypeError would crash the action instead of returning fail(). Guard it.
    const resp = (e as {
      response?: { errors?: { message?: string; extensions?: { code?: string } }[] };
    }).response;
    const err = resp?.errors?.[0];
    return (
      err?.extensions?.code === 'EncryptedVectorIndexNotAcknowledgedError' ||
      (err?.message?.includes('ENCRYPTED_VECTOR_INDEX_NOT_ACKNOWLEDGED') ?? false)
    );
  }
  return false;
}

// Parse an optional non-negative integer dial. Only a run of digits is
// accepted — '', negatives, decimals, and partials like "12abc" all → undefined
// (omit from the mutation so the server keeps its current value rather than
// receiving a silently-truncated number).
function intDial(raw: FormDataEntryValue | null): number | undefined {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return undefined;
  return parseInt(s, 10);
}

function settingsFormDefaults(memory: Memory) {
  return {
    displayName: memory.name ?? '',
    urnSlug: toBareMemorySlugInput(memory.urn),
    urnSlugPresent: memory.class === 'system' ? '' : 'true',
    originalUrnSlug: toBareMemorySlugInput(memory.urn),
    currentUrn: memory.urn ?? '',
    organizationId: memory.organizationId ?? '',
    currentOrganizationId: memory.organizationId ?? '',
    shortDescription: memory.shortDescription ?? '',
    description: memory.description ?? '',
    tags: (memory.tags ?? []).join(', '),
    category0: memory.category0 ?? '',
    category1: memory.category1 ?? '',
    category2: memory.category2 ?? '',
    license: memory.license ?? '',
    homeUrl: memory.homeUrl ?? '',
    iconUrl: memory.iconUrl ?? '',
    heroUrl: memory.heroUrl ?? '',
    visibility: memory.visibility === 'PUBLIC' ? ('PUBLIC' as const) : ('ORGANIZATION' as const),
  };
}

export const load: PageServerLoad = async ({ locals, parent, params }) => {
  await requireNonConsumer(parent);
  const { graph, user } = await parent();
  const allOrgs = await fetchAllItems<Organization>(gqlClient(locals.token), ORGANIZATIONS_QUERY, 'organizations')
    .catch(() => [] as Organization[]);

  // #652 — who owns this memory. `Memory.userId` is set exactly when the
  // memory is user-owned (chk_memory_owner_xor makes org and user ownership
  // mutually exclusive), and there is NO `Memory.user` field, so the owner's
  // handle and URN need this second read.
  //
  // Null here is deliberately ONE bucket. `user(ref:)` resolves for the user
  // themselves, a platform admin, or a caller sharing an organization with the
  // target, and returns null otherwise — denied and missing are
  // indistinguishable on purpose (#384 anti-enumeration). A transient failure
  // lands in the same bucket, and that is fine BECAUSE the page renders the
  // same honest sentence either way: "we cannot identify the owner to you".
  // Collapsing states is only a defect when it makes the UI claim something
  // false, and no branch here claims the owner does not exist.
  const ownerUserId = graph.userId ?? null;
  const owner = ownerUserId
    ? await gqlClient(locals.token)
        .request<{ user: { id: string; handle: string | null; urn: string | null } | null }>(
          USER_PROFILE_QUERY,
          { ref: ownerUserId },
        )
        .then((d) => d.user)
        .catch((e: unknown) => {
          console.warn(`[memory-settings] owner lookup failed for ${ownerUserId}:`, e);
          return null;
        })
    : null;
  // transferMemoryOwnership's org source gate uses memory.delete, which may
  // come from a live PrincipalGrant as well as ADMIN/OWNER membership. The
  // effective-access audit exposes that capability; a group-class admin is
  // also covered by the direct org-role gate in the component because the
  // audit can under-report group administration.
  const transferCanDelete = user?.id && graph.class !== 'system' && graph.class !== 'app' && graph.class !== 'personal' && graph.class !== 'private'
    ? await gqlClient(locals.token).request<{ effectiveAccess: { canDelete: boolean } }>(
        MEMORY_TRANSFER_ACCESS_QUERY, { user: user.id, resource: graph.id },
      ).then((data) => data.effectiveAccess.canDelete).catch((e: unknown) => {
        console.warn(`[memory-settings] transfer access lookup failed for ${graph.id}:`, e);
        return false;
      })
    : false;
  const [form, vectorForm, marketplaceForm, schemaForm, deleteForm, retryEmbedsForm] = await Promise.all([
    // #1909: memory-bound id, stamped here and in `?/update` from the SAME
    // route param, so a late result from memory A cannot match memory B's
    // live form (hrn:node:hadronmemory.com:hadron-portal:review:superforms-late-result-crosses-entity-navigation).
    superValidate<MemorySettingsForm>(settingsFormDefaults(graph), memorySettingsFormAdapter, { errors: false, id: `updateMemorySettings:${params.id}` }),
    superValidate<VectorIndexSettingsForm>(
      {
        vectorIndexEnabled: graph.vectorIndexEnabled ?? false,
        embeddingSource: graph.embeddingSource ?? 'abstract',
        chunkTokens: graph.chunkTokens != null ? String(graph.chunkTokens) : '',
        chunkOverlap: graph.chunkOverlap != null ? String(graph.chunkOverlap) : '',
        forceFixedSize: graph.forceFixedSize ?? false,
        acknowledgeVectorInversionRisk: false,
      },
      vectorIndexSettingsFormAdapter,
      // #1255: a STABLE, memory-bound id on both sides (load and action).
      // Without one, superValidate defaults the id to '' and this form
      // matches EVERY unstamped form's data and results — a sibling save's
      // invalidateAll rebinds it from page.data (discarding an unsaved
      // draft, taint notwithstanding) and a sibling's ActionResult rebinds
      // it with the sibling's form data. Paired with applyAction:'never' on
      // the client (see +page.svelte): own results still match and apply;
      // nothing else touches the form. Same recipe as the marketplace card
      // (#1248), arrived at from the opposite direction — the card had a
      // stable id and no opt-out; this form had neither.
      { errors: false, id: `updateVectorIndex:${params.id}` },
    ),
    superValidate<MarketplaceListingForm>(
      { listedOnMarketplace: graph.listedOnMarketplace ?? false },
      marketplaceListingFormAdapter,
      // Explicit id in BOTH the load and the action: with more than one
      // superValidate on a route, shape-hash ids can collide and the wrong
      // form consumes the posted result
      // (hrn:node:hadronmemory.com:hadron-portal:review:superforms-distinct-form-ids).
      // The id is MEMORY-BOUND (`…:${params.id}`) so a late result from
      // memory A can never match a live form on memory B after a [id]
      // navigation reuses the page component (Gene's P2-1 on #1244). Built
      // from the route param on BOTH sides — the action has no graph, and
      // deriving each side from a different source invites a divergence
      // where results silently stop matching this card.
      { errors: false, id: `updateMarketplaceListing:${params.id}` },
    ),
    superValidate<MemorySchemaSettingsForm>(
      { schemaJson: graph.schema != null ? JSON.stringify(graph.schema, null, 2) : '' },
      memorySchemaSettingsFormAdapter,
      // #1255: same memory-bound id discipline as the vector form above.
      { errors: false, id: `updateSchema:${params.id}` },
    ),
    superValidate<DeleteMemoryForm>(
      { organizationId: graph.organizationId ?? '' },
      deleteMemoryFormAdapter,
      { errors: false },
    ),
    superValidate<RetryFailedEmbeddingsForm>({}, retryFailedEmbeddingsFormAdapter, { errors: false }),
  ]);
  const roleConfigAvailable = await rulebookAvailable(gqlClient(locals.token), params.id).catch(() => false);
  return { roleConfigAvailable, allOrgs, owner, ownerUserId, transferCanDelete, form, vectorForm, marketplaceForm, schemaForm, deleteForm, retryEmbedsForm };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    if (fd.has('urnSlug') && !fd.has('urnSlugPresent')) fd.set('urnSlugPresent', 'true');
    const form = await superValidate(fd, memorySettingsFormAdapter, { id: `updateMemorySettings:${params.id}` });
    if (!form.valid) return fail(400, { form });

    const displayName = form.data.displayName || undefined;
    // Normalize to a bare slug — the field should hold just the slug, but
    // tolerate a user pasting a full/prefixed URN by cutting the slug out of it.
    const urnSlug = toBareMemorySlugInput(form.data.urnSlug) || undefined;
    // Only forward `urn` when the user actually edited the slug. The server's
    // updateMemory rebuilds the whole URN from this value (newUrn =
    // `${org.urn}:${slug}`) whenever urn !== undefined, so sending the
    // unchanged slug on a visibility-only edit would re-derive — and corrupt —
    // the URN. The form prefills the slug from the canonical `hrn:memory:…`
    // urn, which doesn't round-trip through that legacy composition, so an
    // unchanged resubmit was failing FR-020 validation server-side.
    const originalUrnSlug = toBareMemorySlugInput(form.data.originalUrnSlug) || undefined;
    const urnChanged = urnSlug !== undefined && urnSlug !== originalUrnSlug;
    // #969: an old or tampered edit form cannot use updateMemory's legacy
    // organizationId argument to bypass the ownership-transfer preview.
    if (form.data.organizationId && form.data.organizationId !== form.data.currentOrganizationId) {
      return setError(form, 'organizationId', t('memory-transfer.use-preview', 'Use Transfer ownership to preview this change.'), { status: 400 });
    }
    const tagsRaw = form.data.tags;
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    // Pre-flight URN-collision check: when the slug changed,
    // compose the candidate URN (current `hrn:memory:<org>::` head + new slug)
    // and verify no OTHER memory already owns it, so the user gets a friendly
    // message instead of the server's raw unique-constraint error. The check is
    // a UX nicety; the server's uniqueness enforcement is still the trust
    // boundary.
    //
    // TODO(#390, hadron-server#355): once the server ships `resourceExists(urn, type)`,
    // swap `resolveUrn` for it here. It's a direct DB existence boolean (not
    // authz-scoped like resolveUrn), so it would also catch a collision with a
    // memory in an org the user can't see.
    const currentUrn = form.data.currentUrn;
    if (urnChanged && currentUrn.includes('::')) {
      // Replace ONLY the slug segment, keeping the `hrn:memory:<org>` head and
      // any trailing role-marker segment (e.g. `…::<slug>::system`) intact — so
      // the pre-check queries the exact URN the rename would produce, not a
      // role-marker-stripped variant that could miss a real collision.
      const candidateParts = currentUrn.split('::');
      candidateParts[1] = urnSlug;
      const candidateUrn = candidateParts.join('::');
      try {
        const { resolveUrn } = await gqlClient(locals.token).request<{
          resolveUrn: { id: string } | null;
        }>(RESOLVE_URN_QUERY, { urn: candidateUrn });
        // A hit on a DIFFERENT memory id is a real collision (resolving to this
        // same memory can't happen once the slug differs, but guard anyway).
        if (resolveUrn && resolveUrn.id !== params.id) {
          return setError(
            form,
            'urnSlug',
            `A memory with the URN "${candidateUrn}" already exists. Choose a different slug.`,
            { status: 409 },
          );
        }
      } catch {
        // resolveUrn failed (transport error or an un-resolvable candidate) —
        // don't block the save on a best-effort pre-check; the server's unique
        // constraint will reject a true collision and that error is surfaced.
      }
    }

    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
        ref: params.id,
        name: displayName,
        urn: urnChanged ? urnSlug : undefined,
        shortDescription: form.data.shortDescription || null,
        description: form.data.description || null,
        tags,
        license: form.data.license || null,
        category0: form.data.category0 || null,
        category1: form.data.category1 || null,
        category2: form.data.category2 || null,
        iconUrl: form.data.iconUrl || null,
        heroUrl: form.data.heroUrl || null,
        homeUrl: form.data.homeUrl || null,
        // GitHub integration fields (source/readBranch/writeBranch) moved to the
        // /integrations tab (#266) so this update can't clobber them.
        // Spec 034: the visibility control only renders for knowledge memories;
        // when it's absent (owner-only/group/system), omit it so updateMemory
        // leaves the stored value untouched rather than forcing a default.
        visibility: form.data.visibility,
      });
      return message(form, { type: 'success', text: 'Changes saved.' });
    } catch (e: unknown) {
      return message(form, { type: 'error', text: extractGqlError(e, 'Failed to update') }, { status: 500 });
    }
  },

  // #841 / hrn:node:hadronmemory.com:specs:cor:acl:080:04 — the marketplace listing toggle. Deliberately its
  // own form and action: listing is a separate decision from visibility, and
  // the catalogue needs BOTH (listed AND publicly accessible) — the control
  // explains the interplay instead of producing a listing that never shows.
  updateMarketplaceListing: async ({ request, params, locals }) => {
    // Same memory-bound id as the load's form — see the load's comment.
    const form = await superValidate(await request.formData(), marketplaceListingFormAdapter, { id: `updateMarketplaceListing:${params.id}` });
    if (!form.valid) return fail(400, { form });

    try {
      const { updateMemory: saved } = await gqlClient(locals.token).request<{ updateMemory?: Memory }>(UPDATE_MEMORY_MUTATION, {
        ref: params.id,
        listedOnMarketplace: form.data.listedOnMarketplace,
      });
      // Never success for a missing or malformed result (Gil's P2 and
      // Gene's P2-2 on #1244, found independently): the row must be THIS
      // memory (matching returned id) carrying a boolean flag. Anything
      // else is a safe failure that preserves the user's intent — no
      // resync, no invented persisted false, no "Changes saved." over a
      // state the server never confirmed.
      if (!saved || saved.id !== params.id || typeof saved.listedOnMarketplace !== 'boolean') {
        return message(
          form,
          { type: 'error', text: t('memory-settings.marketplace.unconfirmed', 'The server did not confirm the new listing state. Reload the page to see the current state.') },
          { status: 502 },
        );
      }
      // Resync from the returned row (the `updateVectorIndex` pattern): the
      // checkbox shows what the server actually saved, not the local intent,
      // in the window before invalidation refreshes `g`.
      form.data = { ...form.data, listedOnMarketplace: saved.listedOnMarketplace };
      return message(form, { type: 'success', text: t('memory-settings.marketplace.saved', 'Changes saved.') });
    } catch (e: unknown) {
      // extractGqlError, not e.message: graphql-request packs the whole query
      // and variables into ClientError.message (#468's leak class).
      return message(
        form,
        { type: 'error', text: extractGqlError(e, t('memory-settings.marketplace.failed', 'Failed to update marketplace listing.'), ["BAD_USER_INPUT"]) },
        { status: 500 },
      );
    }
  },

  previewTransfer: async ({ request, params, locals }) => {
    const parsed = previewTransferSchema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { _kind: 'previewTransfer' as const, transferError: t('memory-transfer.invalid-selection', 'Choose a destination and memory class.') });
    const { _kind: _ignored, ...selection } = parsed.data;
    try {
      const response = await gqlClient(locals.token).request<{ transferMemoryOwnership: MemoryOwnerTransferPreview }>(
        TRANSFER_MEMORY_OWNERSHIP_MUTATION,
        {
          memoryRef: params.id,
          orgRef: selection.destinationKind === 'org' ? selection.destinationRef : undefined,
          userRef: selection.destinationKind === 'user' ? selection.destinationRef : undefined,
          targetClass: selection.targetClass,
          resetGroupMembers: selection.resetGroupMembers,
          dryRun: true,
        },
      );
      return { _kind: 'previewTransfer' as const, transferSelection: selection, transferPreview: response.transferMemoryOwnership };
    } catch (e: unknown) {
      return fail(400, { _kind: 'previewTransfer' as const, transferSelection: selection, transferError: extractGqlError(e, t('memory-transfer.preview-failed', 'Could not preview ownership transfer.'), ["BAD_USER_INPUT"]) });
    }
  },

  applyTransfer: async ({ request, params, locals }) => {
    const parsed = applyTransferSchema.safeParse(Object.fromEntries(await request.formData()));
    if (!parsed.success) return fail(400, { _kind: 'applyTransfer' as const, transferError: t('memory-transfer.preview-required', 'Preview the transfer before applying it.') });
    const { _kind: _ignored, expectedNewUrn, ...selection } = parsed.data;
    try {
      const { transferMemoryOwnership: result } = await gqlClient(locals.token).request<{ transferMemoryOwnership: MemoryOwnerTransferPreview }>(
        TRANSFER_MEMORY_OWNERSHIP_MUTATION,
        {
          memoryRef: params.id,
          orgRef: selection.destinationKind === 'org' ? selection.destinationRef : undefined,
          userRef: selection.destinationKind === 'user' ? selection.destinationRef : undefined,
          targetClass: selection.targetClass,
          resetGroupMembers: selection.resetGroupMembers,
          dryRun: false,
          expectedNewUrn,
        },
      );
      // A platform admin may transfer an org memory to another user. Its new
      // personal/private owner is then the only reader, so this detail page
      // cannot render the initiating admin's success page.
      if (selection.destinationKind === 'user' && result.toOwner !== locals.user?.id) {
        redirect(303, '/app/memories?transferred=1');
      }
    } catch (e: unknown) {
      if (isRedirect(e)) throw e;
      const limit = limitRefusal(e, { link: false });
      if (limit) return fail(limit.status, { _kind: 'applyTransfer' as const, transferSelection: selection, transferError: limit.text });
      const stale = extractGqlErrorCode(e) === 'STALE_TRANSFER_PREVIEW';
      return fail(stale ? 409 : 400, {
        _kind: 'applyTransfer' as const,
        transferSelection: selection,
        transferError: stale
          ? t('memory-transfer.stale', 'The destination URN changed since this preview. Preview again before applying.')
          : extractGqlError(e, t('memory-transfer.apply-failed', 'Could not transfer ownership.'), ["BAD_USER_INPUT"]),
      });
    }
    redirect(303, `/app/memories/${encodeURIComponent(params.id)}/settings?transferred=1`);
  },

  // Spec 033 §2/§3 — vector-index config lives in its own action (not the
  // metadata `update` above) so a memory-wide re-index only fires when these
  // fields actually change, never on an unrelated name/tag edit.
  updateVectorIndex: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const hasEmbeddingSource = fd.has('embeddingSource');
    const form = await superValidate<VectorIndexSettingsForm>(
      fd,
      vectorIndexSettingsFormAdapter,
      { id: `updateVectorIndex:${params.id}` },
    );
    if (!form.valid) return fail(400, { form });

    // Only assert the encrypted-memory acknowledgement when the user actually
    // accepted it — never send `false`, which would be a no-op the server
    // could misread as an explicit decline.
    const acknowledgeVectorInversionRisk = form.data.acknowledgeVectorInversionRisk ? true : undefined;

    try {
      const { updateMemory: saved } = await gqlClient(locals.token).request<{ updateMemory?: Memory }>(UPDATE_MEMORY_MUTATION, {
        ref: params.id,
        vectorIndexEnabled: form.data.vectorIndexEnabled,
        embeddingSource: hasEmbeddingSource ? form.data.embeddingSource : undefined,
        acknowledgeVectorInversionRisk,
        chunkTokens: intDial(form.data.chunkTokens),
        chunkOverlap: intDial(form.data.chunkOverlap),
        forceFixedSize: form.data.forceFixedSize,
      });
      if (saved) {
        form.data = {
          ...form.data,
          vectorIndexEnabled: saved.vectorIndexEnabled ?? form.data.vectorIndexEnabled,
          embeddingSource: saved.embeddingSource ?? form.data.embeddingSource,
          chunkTokens: saved.chunkTokens != null ? String(saved.chunkTokens) : '',
          chunkOverlap: saved.chunkOverlap != null ? String(saved.chunkOverlap) : '',
          forceFixedSize: saved.forceFixedSize ?? false,
          acknowledgeVectorInversionRisk: false,
        };
      }
      return message(form, { type: 'success', text: 'Changes saved.' });
    } catch (e: unknown) {
      // Surface the FR-026 disclosure requirement as a structured failure so
      // the page can render the acknowledgement panel even if the client-side
      // proactive check was bypassed.
      if (isEncryptedAckError(e)) {
        message(
          form,
          {
            type: 'error',
            text: 'This encrypted memory requires acknowledging the vector-inversion disclosure before enabling the index.',
          },
          { status: 400 },
        );
        return fail(400, {
          form,
          needsEncryptedAck: true,
        });
      }
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to update vector index', ["BAD_USER_INPUT"]) },
        { status: 500 },
      );
    }
  },

  // #695 (server #882): re-drive permanently-failed embeddings. Its own action
  // rather than a branch of updateVectorIndex, because it is a one-shot
  // operation on stored state and not a settings edit — folding it in would let
  // a re-drive carry whatever unsaved dial values happened to be in that form.
  retryFailedEmbeddings: async ({ request, params, locals }) => {
    const form = await superValidate<RetryFailedEmbeddingsForm>(
      await request.formData(),
      retryFailedEmbeddingsFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      const res = await gqlClient(locals.token).request<{ retryFailedEmbeddings: number }>(
        RETRY_FAILED_EMBEDDINGS_MUTATION,
        { memoryRef: params.id },
      );
      // The count is what the SERVER re-stamped, never a number this page
      // derived — the portal has no failed-node rollup to derive one from, and
      // a count assembled here could disagree with the work actually done.
      //
      // Returned as DATA rather than as prose in `message`. The outcome copy is
      // a status message with a number in it, so it has to be built at the
      // `t()` boundary on the client — a sentence assembled here would be
      // permanently untranslatable, and interpolating the count before that
      // boundary is what #817 exists to stop
      // (hrn:node:hadronmemory.com:hadron-portal:review:user-strings-through-t-helper).
      // No success `message` is set: its text would be dead string nobody
      // renders, and the presence of `retriedCount` under this form's own
      // `_kind` is already the success signal.
      return { form, retriedCount: res.retryFailedEmbeddings };
    } catch (e: unknown) {
      return message(
        form,
        {
          type: 'error',
          // @copilot on #837: the FALLBACK is user-visible copy, so it goes
          // through the i18n boundary even though this page's older siblings
          // leave theirs raw. hrn:node:hadronmemory.com:hadron-portal:review:user-strings-through-t-helper is explicit
          // that the carve-out is a narrow KIND of string — section headers,
          // page titles — and that an error message always routes through
          // `t()` whatever its neighbours do. Not sweeping the siblings here;
          // that is a separate, complete pass.
          //
          // The server's own message still wins when there is one:
          // `extractGqlError` only falls back when the error carries no
          // GraphQL message, and inventing a cause is what
          // hrn:node:hadronmemory.com:hadron-portal:review:diagnostic-message-must-not-guarantee forbids.
          text: extractGqlError(
            e,
            t('memory-settings.retry-embeds.failed', 'Failed to re-drive embeddings'), ["BAD_USER_INPUT"],
          ),
        },
        { status: 500 },
      );
    }
  },

  // portal#1346: the "Vector index health" panel. On demand only (a button), never
  // from the loader: validateMemory scans the whole memory on every call. The
  // server has no check filter, so this asks for the most findings it allows and
  // keeps EMBED_FAILED; the view says when the cap may have hidden some. The ref
  // is the route's, never the form's. No form input, so no superforms: the
  // result is plain data and a refusal a plain error.
  checkVectorIndexHealth: async ({ params, locals }) => {
    try {
      const res = await gqlClient(locals.token).request<{ validateMemory: ValidateMemoryResult }>(
        VALIDATE_MEMORY_QUERY,
        { memoryRef: params.id, limit: VECTOR_HEALTH_LIMIT },
      );
      return { vectorHealth: embedFailedView(res.validateMemory) };
    } catch (e: unknown) {
      // #1465 (hrn:node:hadronmemory.com:specs:cor:api:140:03): validateMemory answers a memory the
      // caller cannot read with the same MEMORY_NOT_FOUND as a missing one. One fixed message and a
      // 404, never the server's text, so the page cannot say which of the two it was.
      if (extractGqlErrorCode(e) === 'MEMORY_NOT_FOUND') {
        return fail(404, {
          vectorHealthError: t('memory-settings.vector-health.not-found', 'This memory could not be found.'),
        });
      }
      return fail(500, {
        vectorHealthError: extractGqlError(
          e,
          t('memory-settings.vector-health.failed', 'Could not check the vector index'),
          ['BAD_USER_INPUT'],
          // #1465: a transport Error's own message (socket text, a URL) is not reader copy.
          { transport: 'fallback' },
        ),
      });
    }
  },

  // #588 (server #725): the memory property schema lives in its own action so
  // a schema edit can't clobber unrelated metadata (and vice versa). Empty
  // editor → schema: null (the server clears the column); the server
  // re-validates well-formedness and rejects a malformed schema with
  // BAD_USER_INPUT — surfaced verbatim as a field error on the editor.
  updateSchema: async ({ request, params, locals }) => {
    const form = await superValidate<MemorySchemaSettingsForm>(
      await request.formData(),
      memorySchemaSettingsFormAdapter,
      { id: `updateSchema:${params.id}` },
    );
    if (!form.valid) return fail(400, { form });

    const trimmed = form.data.schemaJson.trim();
    // The zod schema already proved non-empty input parses; re-parse only to
    // produce the typed mutation payload.
    const schema = trimmed ? (JSON.parse(trimmed) as Record<string, unknown>) : null;

    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
        ref: params.id,
        schema,
      });
      return message(form, {
        type: 'success',
        text: schema ? 'Schema saved.' : 'Schema removed.',
      });
    } catch (e: unknown) {
      const text = extractGqlError(e, 'Failed to update schema', ["BAD_USER_INPUT"]);
      if (extractGqlErrorCode(e) === 'BAD_USER_INPUT') {
        return setError(form, 'schemaJson', text, { status: 400 });
      }
      return message(form, { type: 'error', text }, { status: 500 });
    }
  },

  delete: async ({ request, params, locals }) => {
    const form = await superValidate<DeleteMemoryForm>(
      await request.formData(),
      deleteMemoryFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    // #260: org is no longer in the URL — the delete form submits the memory's
    // owning org id so we can land the user back on that org's memories list.
    // The deleter is always a member of the owning org (canDelete requires it),
    // so the redirect is reachable; fall back to the active-org redirector.
    const orgId = form.data.organizationId;
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_MUTATION, { ref: params.id });
      redirect(303, orgId ? `/app/orgs/${encodeURIComponent(orgId)}/memories` : '/app/memories');
    } catch (e: unknown) {
      // Re-throw SvelteKit's redirect-as-thrown-exception so it isn't
      // swallowed by the catch and surfaced as "Failed to delete".
      // (Same load-bearing pattern as deleteAgent.)
      if (isRedirect(e)) throw e;
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to delete memory', ["BAD_USER_INPUT"]) },
        { status: 500 },
      );
    }
  },
};
