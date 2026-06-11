import { fail, redirect, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  UPDATE_MEMORY_MUTATION,
  DELETE_MEMORY_MUTATION,
  MY_ORGANIZATIONS_QUERY,
} from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    // `response` can be null/undefined on transport errors even though the
    // `'response' in e` check passes — optional-chain before reading errors.
    const resp = (e as { response?: { errors?: { message: string }[] } }).response;
    if (resp?.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
}

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

export const load: PageServerLoad = async ({ locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token)
    .request<{ myOrganizations: Organization[] }>(MY_ORGANIZATIONS_QUERY)
    .catch(() => ({ myOrganizations: [] as Organization[] }));
  return { allOrgs: data.myOrganizations };
};

export const actions: Actions = {
  update: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const displayName = String(fd.get('displayName') ?? '').trim() || undefined;
    const urnSlug = String(fd.get('urnSlug') ?? '').trim() || undefined;
    const newOrgId = String(fd.get('organizationId') ?? '').trim() || undefined;
    // #260: the org is no longer in the URL, so the no-op-transfer guard
    // compares against the memory's current org id submitted as a hidden field.
    const currentOrgId = String(fd.get('currentOrganizationId') ?? '').trim() || undefined;
    const tagsRaw = String(fd.get('tags') ?? '').trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
        id: params.id,
        name: displayName,
        urn: urnSlug,
        organizationId: newOrgId && newOrgId !== currentOrgId ? newOrgId : undefined,
        shortDescription: String(fd.get('shortDescription') ?? '').trim() || null,
        description: String(fd.get('description') ?? '').trim() || null,
        tags,
        license: String(fd.get('license') ?? '').trim() || null,
        category0: String(fd.get('category0') ?? '').trim() || null,
        category1: String(fd.get('category1') ?? '').trim() || null,
        category2: String(fd.get('category2') ?? '').trim() || null,
        iconUrl: String(fd.get('iconUrl') ?? '').trim() || null,
        heroUrl: String(fd.get('heroUrl') ?? '').trim() || null,
        homeUrl: String(fd.get('homeUrl') ?? '').trim() || null,
        // GitHub integration fields (source/readBranch/writeBranch) moved to the
        // /integrations tab (#266) so this update can't clobber them.
        // Spec 034: the visibility control only renders for knowledge memories;
        // when it's absent (owner-only/group/system), omit it so updateMemory
        // leaves the stored value untouched rather than forcing a default.
        visibility: fd.has('visibility') ? String(fd.get('visibility')) : undefined,
      });
      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update' });
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
