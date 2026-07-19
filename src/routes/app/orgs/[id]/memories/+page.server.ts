import { error, fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
import {
  ORGANIZATION_QUERY,
  ORG_SYSTEM_MEMORIES_QUERY,
  DELETE_MEMORY_MUTATION,
  SYNC_MEMORY_MUTATION,
  PUBLIC_MEMORIES_QUERY,
  MEMORIES_QUERY,
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
} from '$lib/server/queries';
import type { Organization, Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import { orgMemorySubscribeSchema } from './schema';

type OrgMemorySubscribeForm = Infer<typeof orgMemorySubscribeSchema, 'zod4'>;

const orgMemorySubscribeFormAdapter = zod4(orgMemorySubscribeSchema);

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  const [orgData, systemMemories, publicMemories, myMemories] = await Promise.all([
    client.request<{ organization: Organization | null }>(
      ORGANIZATION_QUERY, { id: params.id },
    ),
    fetchAllItems<Memory>(client, ORG_SYSTEM_MEMORIES_QUERY, 'memories', { orgId: params.id })
      .catch(() => [] as Memory[]),
    fetchAllItems<Memory>(gqlClient(), PUBLIC_MEMORIES_QUERY, 'memories')
      .catch(() => [] as Memory[]),
    fetchAllItems<Memory>(client, MEMORIES_QUERY, 'memories')
      .catch(() => [] as Memory[]),
  ]);
  // organization(ref:) returns null for a missing org (denied throws above) —
  // surface it as a clean 404 rather than a TypeError 500.
  if (!orgData?.organization) throw error(404, 'Organization not found');
  // Exclude memories already owned or subscribed to by this org
  const ownedIds = new Set((orgData.organization.memories ?? []).map((m) => m.id));
  const subscribedIds = new Set((orgData.organization.subscriptions ?? []).map((s) => s.memory.id));
  const availableMemories = publicMemories.filter(
    (m) => !ownedIds.has(m.id) && !subscribedIds.has(m.id) && m.organizationId !== params.id,
  );
  // Spec 034: personal memories (the personal + private classes) are owner-only
  // and excluded from Organization.memories server-side, so surface the caller's
  // own ones whose container is this org. memories() already scopes to the
  // caller via userId.
  const personalMemories = myMemories.filter(
    (m) =>
      m.organizationId === params.id &&
      !!locals.user?.id &&
      m.userId === locals.user.id &&
      (m.class === 'personal' || m.class === 'private'),
  );
  // #555/#556: the create flow deep-links back with ?tab= so a just-created
  // personal memory lands on the tab that actually shows it. Validate against
  // the known tabs; anything else falls back to the org grid.
  const tabParam = url.searchParams.get('tab');
  const initialTab: 'personal' | 'org' | 'subscriptions' =
    tabParam === 'personal' || tabParam === 'subscriptions' ? tabParam : 'org';
  return {
    org: orgData.organization,
    systemMemories,
    availableMemories,
    personalMemories,
    initialTab,
    subscribeForm: await superValidate<OrgMemorySubscribeForm>(
      { memoryId: '', role: 'READER' },
      orgMemorySubscribeFormAdapter,
      { errors: false },
    ),
  };
};

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const fd = await request.formData();
    const id = String(fd.get('id') ?? '');
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_MUTATION, { id });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to delete memory' });
    }
  },

  syncAll: async ({ params, locals }) => {
    const data = await gqlClient(locals.token).request<{ organization: Organization }>(
      ORGANIZATION_QUERY, { id: params.id },
    );
    const memories = data.organization.memories ?? [];
    const errors: string[] = [];
    for (const m of memories) {
      if (!m.source) continue;
      try {
        await gqlClient(locals.token).request(SYNC_MEMORY_MUTATION, { id: m.id });
      } catch (e: unknown) {
        errors.push(`${m.name}: ${e instanceof Error ? e.message : 'sync failed'}`);
      }
    }
    if (errors.length) {
      return fail(500, { error: `Sync errors: ${errors.join('; ')}` });
    }
    return { synced: true };
  },

  subscribe: async ({ request, params, locals }) => {
    const form = await superValidate<OrgMemorySubscribeForm>(
      await request.formData(),
      orgMemorySubscribeFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(CREATE_MEMORY_SUBSCRIPTION_MUTATION, {
        memoryId: form.data.memoryId,
        orgId: params.id,
        role: form.data.role,
      });
      return message(form, { type: 'success', text: t('org-memories.subscriptions.added', 'Subscribed to memory.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to subscribe') },
        { status: 500 },
      );
    }
  },

  unsubscribe: async ({ request, params, locals }) => {
    const fd = await request.formData();
    const memoryId = String(fd.get('memoryId') ?? '');
    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SUBSCRIPTION_MUTATION, {
        memoryId,
        orgId: params.id,
      });
    } catch (e: unknown) {
      return fail(500, { error: e instanceof Error ? e.message : 'Failed to unsubscribe' });
    }
  },
};
