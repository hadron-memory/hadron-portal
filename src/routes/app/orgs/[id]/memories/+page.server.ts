import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { loadOrgDetail } from '$lib/server/org-detail';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
import {
  ORG_SYSTEM_MEMORIES_QUERY,
  DELETE_MEMORY_MUTATION,
  SYNC_MEMORY_MUTATION,
  PUBLIC_MEMORIES_QUERY,
  MEMORIES_QUERY,
  CREATE_MEMORY_SUBSCRIPTION_MUTATION,
  DELETE_MEMORY_SUBSCRIPTION_MUTATION,
  ORG_MEMORIES_TAB_QUERY,
} from '$lib/server/queries';
import type { Organization, Memory } from '$lib/types';
import type { Actions, PageServerLoad } from './$types';
import {
  deleteOrgMemorySchema,
  orgMemorySubscribeSchema,
  syncOrgMemoriesSchema,
  unsubscribeOrgMemorySchema,
} from './schema';
import { gitFailureMessage } from '$lib/sync-error';

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
  // #382 → #845: the org NO LONGER comes from the layout, which now carries
  // chrome only. This tab renders `memories` and `subscriptions`, and a list
  // resolver that fails nulls the whole org — so asking for it here keeps that
  // failure inside this tab. Superseded comment kept in outline:
  // #382 had this read parent(), which had already run
  // ORGANIZATION_QUERY for this same `params.id` on this same request. Fetching
  // it again here was a second identical round trip per page load, and the
  // layout raises the missing-org 404 before this loader runs at all — so the
  // null check that used to follow could never fire.
  //
  // The ACTIONS below still fetch it themselves, and must: a form POST runs the
  // action BEFORE the layout load re-runs, so `parent()` is not available there.
  // #845: the layout carries chrome only; this tab needs the full org.
  const org = await loadOrgDetail(locals.token, params.id, ORG_MEMORIES_TAB_QUERY);
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
      // #845: the memories SLICE, not ORGANIZATION_QUERY. An action runs
      // before the layout load so it has no parent() to read, but the reason
      // for a narrow selection is the same one the loaders have — this action
      // syncs memories and has no business invoking `exchangeConnections`,
      // whose refusal would fail the sync with an unrelated error.
      data = await client.request<{ organization: Organization }>(
        ORG_MEMORIES_TAB_QUERY, { ref: params.id },
      );
    } catch (e: unknown) {
      return message(
        form,
        { type: 'error', text: extractGqlError(e, 'Failed to list memories to sync') },
        { status: 500 },
      );
    }

    const memories = data.organization.memories ?? [];
    // #988: a failure's text is the raw git error, which can carry
    // credentials (hadron-server#1578), so each is classified into fixed copy
    // and never shown. "All synced" is claimed only when every sync came back
    // OK; one that stopped early returns still SYNCING.
    const errors: string[] = [];
    const unfinished: string[] = [];
    for (const m of memories) {
      if (!m.source) continue;
      try {
        const res = await client.request<{ syncMemory: { syncStatus?: string | null } | null }>(SYNC_MEMORY_MUTATION, { id: m.id });
        if (res.syncMemory?.syncStatus !== 'OK') unfinished.push(m.name);
      } catch (e: unknown) {
        errors.push(`${m.name}: ${gitFailureMessage(extractGqlError(e, ''), 'sync')}`);
      }
    }
    if (errors.length) {
      return message(form, {
        type: 'error',
        text: t('org-memories.sync-errors', 'Sync errors: {errors}', { errors: errors.join(' · ') }),
      }, { status: 500 });
    }
    if (unfinished.length) {
      return message(form, {
        type: 'success',
        text: t('org-memories.sync-not-finished', 'Some syncs didn’t finish yet: {names}. Check their status again shortly.', { names: unfinished.join(', ') }),
      });
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
