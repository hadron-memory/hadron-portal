import { fail, redirect, isRedirect } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  UPDATE_MEMORY_MUTATION,
  SYNC_MEMORY_MUTATION,
  PUSH_MEMORY_TO_GIT_MUTATION,
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_MUTATION,
  MY_ORGANIZATIONS_QUERY,
} from '$lib/server/queries';
import type { Organization } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';

function extractGqlError(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const resp = (e as { response: { errors?: { message: string }[] } }).response;
    if (resp.errors?.[0]?.message) return resp.errors[0].message;
  }
  return e instanceof Error ? e.message : fallback;
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
    const tagsRaw = String(fd.get('tags') ?? '').trim();
    const tags = tagsRaw ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean) : [];
    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_MUTATION, {
        id: params.gid,
        name: displayName,
        urn: urnSlug,
        organizationId: newOrgId !== params.id ? newOrgId : undefined,
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
        source: String(fd.get('source') ?? '').trim() || null,
        readBranch: String(fd.get('readBranch') ?? '').trim() || null,
        writeBranch: String(fd.get('writeBranch') ?? '').trim() || null,
        visibility: String(fd.get('visibility') ?? 'PRIVATE'),
      });
      return { success: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to update' });
    }
  },

  sync: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(SYNC_MEMORY_MUTATION, { id: params.gid });
      return { synced: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Sync failed' });
    }
  },

  pushToGit: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(PUSH_MEMORY_TO_GIT_MUTATION, { id: params.gid });
      return { pushed: true };
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Push to Git failed' });
    }
  },

  subscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const orgId = String(fd.get('orgId') ?? '');
    const role = String(fd.get('role') ?? 'READER');
    try {
      await gqlClient(locals.token).request(CREATE_MEMORY_SUBSCRIPTION_MUTATION, { memoryId: params.gid, orgId, role });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to add subscription' });
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const orgId = String(fd.get('orgId') ?? '');
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SUBSCRIPTION_MUTATION, { memoryId: params.gid, orgId });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to remove subscription' });
    }
  },

  delete: async ({ params, locals }) => {
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_MUTATION, { id: params.gid });
      redirect(303, `/app/orgs/${params.id}/memories`);
    } catch (e: unknown) {
      // Re-throw SvelteKit's redirect-as-thrown-exception so it isn't
      // swallowed by the catch and surfaced as "Failed to delete".
      // (Same load-bearing pattern as deleteAgent.)
      if (isRedirect(e)) throw e;
      return fail(500, { error: extractGqlError(e, 'Failed to delete memory') });
    }
  },
};
