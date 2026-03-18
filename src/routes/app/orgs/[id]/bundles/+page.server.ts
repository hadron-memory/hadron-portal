import { error, fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import {
  ORGANIZATION_QUERY,
  CREATE_MEMORY_BUNDLE_MUTATION,
  UPDATE_MEMORY_BUNDLE_MUTATION,
  DELETE_MEMORY_BUNDLE_MUTATION,
  ADD_MEMORY_TO_BUNDLE_MUTATION,
  REMOVE_MEMORY_FROM_BUNDLE_MUTATION,
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

export const load: PageServerLoad = async ({ params, locals, parent }) => {
  await requireNonConsumer(parent);
  const data = await gqlClient(locals.token).request<{ organization: Organization | null }>(
    ORGANIZATION_QUERY,
    { id: params.id },
  ).catch(() => { throw error(404, 'Organization not found'); });

  if (!data.organization) throw error(404, 'Organization not found');
  return { org: data.organization };
};

export const actions: Actions = {
  create: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const name = String(fd.get('name') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim() || null;
    if (!name) return fail(400, { error: 'Name is required' });
    try {
      await gqlClient(locals.token).request(CREATE_MEMORY_BUNDLE_MUTATION, {
        orgId: params.id, name, description,
      });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to create bundle') });
    }
  },

  update: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    const name = String(fd.get('name') ?? '').trim();
    const description = String(fd.get('description') ?? '').trim() || null;
    if (!name) return fail(400, { error: 'Name is required' });
    try {
      await gqlClient(locals.token).request(UPDATE_MEMORY_BUNDLE_MUTATION, { id, name, description });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to update bundle') });
    }
  },

  delete: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_BUNDLE_MUTATION, { id });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to delete bundle') });
    }
  },

  addMemory: async ({ request, locals }) => {
    const fd = await request.formData();
    const bundleId = String(fd.get('bundleId') ?? '');
    const memoryId = String(fd.get('memoryId') ?? '');
    try {
      await gqlClient(locals.token).request(ADD_MEMORY_TO_BUNDLE_MUTATION, { bundleId, memoryId });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to add memory to bundle') });
    }
  },

  removeMemory: async ({ request, locals }) => {
    const fd = await request.formData();
    const bundleId = String(fd.get('bundleId') ?? '');
    const memoryId = String(fd.get('memoryId') ?? '');
    try {
      await gqlClient(locals.token).request(REMOVE_MEMORY_FROM_BUNDLE_MUTATION, { bundleId, memoryId });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to remove memory from bundle') });
    }
  },
};
