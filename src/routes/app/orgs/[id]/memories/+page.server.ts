import { fail } from '@sveltejs/kit';
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
import {
  deleteOrgMemorySchema,
  orgMemorySubscribeSchema,
  syncOrgMemoriesSchema,
  unsubscribeOrgMemorySchema,
} from './schema';

type DeleteOrgMemoryForm = Infer<typeof deleteOrgMemorySchema, 'zod4'>;
type OrgMemorySubscribeForm = Infer<typeof orgMemorySubscribeSchema, 'zod4'>;
type SyncOrgMemoriesForm = Infer<typeof syncOrgMemoriesSchema, 'zod4'>;
type UnsubscribeOrgMemoryForm = Infer<typeof unsubscribeOrgMemorySchema, 'zod4'>;

const deleteOrgMemoryFormAdapter = zod4(deleteOrgMemorySchema);
const orgMemorySubscribeFormAdapter = zod4(orgMemorySubscribeSchema);
const syncOrgMemoriesFormAdapter = zod4(syncOrgMemoriesSchema);
const unsubscribeOrgMemoryFormAdapter = zod4(unsubscribeOrgMemorySchema);

export const load: PageServerLoad = async ({ params, locals, parent, url }) => {
  await requireNonConsumer(parent);
  const client = gqlClient(locals.token);
  // #382: the org comes from the LAYOUT, which has already run
  // ORGANIZATION_QUERY for this same `params.id` on this same request. Fetching
  // it again here was a second identical round trip per page load, and the
  // layout raises the missing-org 404 before this loader runs at all — so the
  // null check that used to follow could never fire.
  //
  // The ACTIONS below still fetch it themselves, and must: a form POST runs the
  // action BEFORE the layout load re-runs, so `parent()` is not available there.
  const { org } = await parent();
  const [systemMemories, publicMemories, myMemories] = await Promise.all([
    fetchAllItems<Memory>(client, ORG_SYSTEM_MEMORIES_QUERY, 'memories', { orgId: params.id })
      .catch(() => [] as Memory[]),
    fetchAllItems<Memory>(gqlClient(), PUBLIC_MEMORIES_QUERY, 'memories')
      .catch(() => [] as Memory[]),
    fetchAllItems<Memory>(client, MEMORIES_QUERY, 'memories')
      .catch(() => [] as Memory[]),
  ]);
  // Exclude memories already owned or subscribed to by this org
  const ownedIds = new Set((org.memories ?? []).map((m) => m.id));
  const subscribedIds = new Set((org.subscriptions ?? []).map((s) => s.memory.id));
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
  const [subscribeForm, deleteForm, syncAllForm, unsubscribeForm] = await Promise.all([
    superValidate<OrgMemorySubscribeForm>(
      { memoryId: '', role: 'READER' },
      orgMemorySubscribeFormAdapter,
      { errors: false },
    ),
    superValidate<DeleteOrgMemoryForm>(
      { id: '' },
      deleteOrgMemoryFormAdapter,
      { errors: false },
    ),
    superValidate<SyncOrgMemoriesForm>(
      {},
      syncOrgMemoriesFormAdapter,
      { errors: false },
    ),
    superValidate<UnsubscribeOrgMemoryForm>(
      { memoryId: '' },
      unsubscribeOrgMemoryFormAdapter,
      { errors: false },
    ),
  ]);
  return {
    org,
    systemMemories,
    availableMemories,
    personalMemories,
    initialTab,
    subscribeForm,
    deleteForm,
    syncAllForm,
    unsubscribeForm,
  };
};

export const actions: Actions = {
  delete: async ({ request, locals }) => {
    const form = await superValidate<DeleteOrgMemoryForm>(
      await request.formData(),
      deleteOrgMemoryFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_MUTATION, { id: form.data.id });
      return message(form, { type: 'success', text: t('org-memories.deleted', 'Memory deleted.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to delete memory') },
        { status: 500 },
      );
    }
  },

  syncAll: async ({ request, params, locals }) => {
    const form = await superValidate<SyncOrgMemoriesForm>(
      await request.formData(),
      syncOrgMemoriesFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    const client = gqlClient(locals.token);
    let data: { organization: Organization };
    try {
      data = await client.request<{ organization: Organization }>(
        ORGANIZATION_QUERY, { ref: params.id },
      );
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to list memories to sync') },
        { status: 500 },
      );
    }

    const memories = data.organization.memories ?? [];
    const errors: string[] = [];
    for (const m of memories) {
      if (!m.source) continue;
      try {
        await client.request(SYNC_MEMORY_MUTATION, { id: m.id });
      } catch (e: unknown) {
        errors.push(`${m.name}: ${extractGqlError(e, 'sync failed')}`);
      }
    }
    if (errors.length) {
      return message(form, { type: 'error', text: `Sync errors: ${errors.join('; ')}` }, { status: 500 });
    }
    return message(form, { type: 'success', text: t('org-memories.synced', 'All memories synced.') });
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
    const form = await superValidate<UnsubscribeOrgMemoryForm>(
      await request.formData(),
      unsubscribeOrgMemoryFormAdapter,
    );
    if (!form.valid) return fail(400, { form });

    try {
      await gqlClient(locals.token).request(DELETE_MEMORY_SUBSCRIPTION_MUTATION, {
        memoryId: form.data.memoryId,
        orgId: params.id,
      });
      return message(form, { type: 'success', text: t('org-memories.subscriptions.removed', 'Unsubscribed from memory.') });
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to unsubscribe') },
        { status: 500 },
      );
    }
  },
};
