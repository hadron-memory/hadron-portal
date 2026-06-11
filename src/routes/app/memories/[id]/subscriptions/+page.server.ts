import { fail } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { requireNonConsumer } from '$lib/server/guards';
import { extractGqlError } from '$lib/server/gqlError';
import {
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
} from '$lib/server/queries';
import type { Actions, PageServerLoad } from './$types';

// Subscribe/unsubscribe mutate, so — like /settings — keep consumer-mode users
// out of this tab.
export const load: PageServerLoad = async ({ parent }) => {
  await requireNonConsumer(parent);
};

const ROLES = ['READER', 'CONTRIBUTOR'] as const;

// #266: org subscriptions split out of the Settings page into their own tab.
export const actions: Actions = {
  subscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const orgId = String(fd.get('orgId') ?? '').trim();
    const roleRaw = String(fd.get('role') ?? '').trim();
    // Validate before the round-trip so a blank/tampered field is a 400 the form
    // can surface, not an opaque 500 from a server-side GraphQL validation error.
    if (!orgId) return fail(400, { error: 'Organization ID is required.' });
    const role = (ROLES as readonly string[]).includes(roleRaw) ? roleRaw : 'READER';
    try {
      await gqlClient(locals.token).request(CREATE_MEMORY_SUBSCRIPTION_MUTATION, { memoryId: params.id, orgId, role });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to add subscription') });
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const orgId = String(fd.get('orgId') ?? '').trim();
    if (!orgId) return fail(400, { error: 'Organization ID is required.' });
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SUBSCRIPTION_MUTATION, { memoryId: params.id, orgId });
    } catch (e: unknown) {
      return fail(500, { error: extractGqlError(e, 'Failed to remove subscription') });
    }
  },
};
