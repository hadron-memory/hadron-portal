import { fail, redirect, isRedirect } from '@sveltejs/kit';
import { message, setError, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import {
  UPDATE_MEMORY_MUTATION,
  DELETE_MEMORY_MUTATION,
  ORGANIZATIONS_QUERY,
  RESOLVE_URN_QUERY,
} from '$lib/server/queries';
import { toBareMemorySlugInput } from '$lib/urn/form-validation';
import type { Memory, Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { memorySettingsSchema } from './schema';

const memorySettingsFormAdapter = zod4(memorySettingsSchema);

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

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireNonConsumer(parent);
  const { graph } = await parent();
  const allOrgs = await fetchAllItems<Organization>(gqlClient(locals.token), ORGANIZATIONS_QUERY, 'organizations')
    .catch(() => [] as Organization[]);
  const form = await superValidate(settingsFormDefaults(graph), memorySettingsFormAdapter, { errors: false });
  return { allOrgs, form };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    if (fd.has('urnSlug') && !fd.has('urnSlugPresent')) fd.set('urnSlugPresent', 'true');
    const form = await superValidate(fd, memorySettingsFormAdapter);
    if (!form.valid) return fail(400, { form });

    const displayName = form.data.displayName || undefined;
    // Normalize to a bare slug — the field should hold just the slug, but
    // tolerate a user pasting a full/prefixed URN by cutting the slug out of it.
    const urnSlug = toBareMemorySlugInput(form.data.urnSlug) || undefined;
    // A submitted-but-empty slug (the user cleared the field, or pasted
    // something with no extractable slug) would otherwise fall through as
    // `undefined` → urnChanged=false → the old URN silently kept. Reject it so
    // the user gets an actionable error instead of a no-op save.
    if (form.data.urnSlugPresent === 'true' && !urnSlug) {
      return setError(form, 'urnSlug', 'URN slug cannot be empty.', { status: 400 });
    }
    // Only forward `urn` when the user actually edited the slug. The server's
    // updateMemory rebuilds the whole URN from this value (newUrn =
    // `${org.urn}:${slug}`) whenever urn !== undefined, so sending the
    // unchanged slug on a visibility-only edit would re-derive — and corrupt —
    // the URN. The form prefills the slug from the canonical `hrn:memory:…`
    // urn, which doesn't round-trip through that legacy composition, so an
    // unchanged resubmit was failing FR-020 validation server-side.
    const originalUrnSlug = toBareMemorySlugInput(form.data.originalUrnSlug) || undefined;
    const urnChanged = urnSlug !== undefined && urnSlug !== originalUrnSlug;
    const newOrgId = form.data.organizationId || undefined;
    // #260: the org is no longer in the URL, so the no-op-transfer guard
    // compares against the memory's current org id submitted as a hidden field.
    const currentOrgId = form.data.currentOrganizationId || undefined;
    const orgChanged = !!newOrgId && newOrgId !== currentOrgId;
    const tagsRaw = form.data.tags;
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];

    // Pre-flight URN-collision check: when the slug changed within the same org,
    // compose the candidate URN (current `hrn:memory:<org>::` head + new slug)
    // and verify no OTHER memory already owns it, so the user gets a friendly
    // message instead of the server's raw unique-constraint error. The check is
    // a UX nicety; the server's uniqueness enforcement is still the trust
    // boundary (and backstops the org-transfer case we skip here, where the
    // candidate URN's org head would differ from the current one).
    //
    // TODO(#390, hadron-server#355): once the server ships `resourceExists(urn, type)`,
    // swap `resolveUrn` for it here. It's a direct DB existence boolean (not
    // authz-scoped like resolveUrn), so it would also catch a collision with a
    // memory in an org the user can't see — letting us drop the `!orgChanged`
    // skip and check the org-transfer case too.
    const currentUrn = form.data.currentUrn;
    if (urnChanged && !orgChanged && currentUrn.includes('::')) {
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
        id: params.id,
        name: displayName,
        urn: urnChanged ? urnSlug : undefined,
        organizationId: newOrgId && newOrgId !== currentOrgId ? newOrgId : undefined,
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
      return message(form, 'Changes saved.');
    } catch (e: unknown) {
      return message(form, e instanceof Error ? e.message : 'Failed to update', { status: 500 });
    }
  },

  // Spec 033 §2/§3 — vector-index config lives in its own action (not the
  // metadata `update` above) so a memory-wide re-index only fires when these
  // fields actually change, never on an unrelated name/tag edit.
  updateVectorIndex: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const enabled = fd.get('vectorIndexEnabled') === 'true';
    const embeddingSourceRaw = String(fd.get('embeddingSource') ?? '');
    const embeddingSource = (['abstract', 'contentChunks', 'both'] as const).includes(
      embeddingSourceRaw as 'abstract' | 'contentChunks' | 'both',
    )
      ? embeddingSourceRaw
      : undefined;
    // Only assert the encrypted-memory acknowledgement when the user actually
    // accepted it — never send `false`, which would be a no-op the server
    // could misread as an explicit decline.
    const acknowledgeVectorInversionRisk =
      fd.get('acknowledgeVectorInversionRisk') === 'true' ? true : undefined;

    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
        id: params.id,
        vectorIndexEnabled: enabled,
        embeddingSource,
        acknowledgeVectorInversionRisk,
        chunkTokens: intDial(fd.get('chunkTokens')),
        chunkOverlap: intDial(fd.get('chunkOverlap')),
        forceFixedSize: fd.get('forceFixedSize') === 'true',
      });
      return { success: true };
    } catch (e: unknown) {
      // Surface the FR-026 disclosure requirement as a structured failure so
      // the page can render the acknowledgement panel even if the client-side
      // proactive check was bypassed.
      if (isEncryptedAckError(e)) {
        return fail(400, {
          error: 'This encrypted memory requires acknowledging the vector-inversion disclosure before enabling the index.',
          needsEncryptedAck: true,
        });
      }
      return fail(500, { error: extractGqlError(e, 'Failed to update vector index') });
    }
  },

  delete: async ({ request, params, locals }) => {
    const fd = await request.formData();
    // #260: org is no longer in the URL — the delete form submits the memory's
    // owning org id so we can land the user back on that org's memories list.
    // The deleter is always a member of the owning org (canDelete requires it),
    // so the redirect is reachable; fall back to the active-org redirector.
    const orgId = String(fd.get('organizationId') ?? '').trim();
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_MUTATION, { id: params.id });
      redirect(303, orgId ? `/app/orgs/${orgId}/memories` : '/app/memories');
    } catch (e: unknown) {
      // Re-throw SvelteKit's redirect-as-thrown-exception so it isn't
      // swallowed by the catch and surfaced as "Failed to delete".
      // (Same load-bearing pattern as deleteAgent.)
      if (isRedirect(e)) throw e;
      return fail(500, { error: extractGqlError(e, 'Failed to delete memory') });
    }
  },
};
