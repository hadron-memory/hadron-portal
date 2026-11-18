import { classifySyncOutcome, type SyncOutcomeFields } from '$lib/sync-report';
import { fail } from '@sveltejs/kit';
import type { Infer } from 'sveltekit-superforms';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { loadOrgDetail } from '$lib/server/org-detail';
import { fetchAllItems } from '$lib/server/paginate';
import { extractGqlError, extractGqlErrorCode, hasClientErrorResponse } from '$lib/server/gqlError';
import { requireNonConsumer } from '$lib/server/guards';
import { t } from '$lib/i18n/t';
import {
  ORG_SYSTEM_MEMORIES_QUERY,
  OWN_SYSTEM_MEMORY_IDS_QUERY,
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

// portal#2175 (FIT 6884373873 c): a failing read still hides its rows
// (fail-closed, unchanged) but no longer silently — one warn line names the
// read and the org (params.id, the same non-PII ref class as appRef in the
// sibling loaders) plus the error's code, or its class when the server sent
// no code. Why a structural test names the class (hasClientErrorResponse in
// gql-error.ts), not e.name and not instanceof:
// - e.name is 'Error' for ClientError: graphql-request's class never sets
//   this.name, so a codeless GraphQL/HTTP failure is indistinguishable from
//   a portal-side envelope bug. TypeError (network) does name itself.
// - instanceof goes silently false on a duplicated graphql-request in the
//   graph, or a re-thrown error: shape survives, class identity does not.
// NOTHING else from the error is logged: a ClientError's message/stack carry
// the request/response payloads (bearer token, row content) —
// hrn:node:hadronmemory.com:hadron-portal:findings:custom-handle-error-replaces-framework-copy-and-logging.
//
// The failure is also no longer indistinguishable from an empty list for the
// reader: every list a failed read feeds gets a degraded flag, and the page
// renders truthful unavailable copy instead of "No … memories yet" for a
// flagged tab (the acceptance: a failed ownership read never renders as "no
// memories"). Rows stay hidden either way — the flag changes copy, not access.
//
// The tracker is created PER LOAD, inside load(): the flags are request state,
// and a module-level object would leak one request's degradation into a
// concurrently running healthy load (SvelteKit runs loads concurrently).
type DegradedReads = { systemMemories: boolean; personalMemories: boolean; availableMemories: boolean };
function degradedReadsTracker() {
  const state: DegradedReads = {
    systemMemories: false,
    personalMemories: false,
    availableMemories: false,
  };
  const degradedRead = <T,>(orgId: string, what: string, fallback: T, feeds: (keyof DegradedReads)[]) =>
    (e: unknown): T => {
      // ClientError structurally, before e.name (why: the header comment).
      const label =
        extractGqlErrorCode(e) ??
        (hasClientErrorResponse(e) ? 'ClientError' : e instanceof Error ? e.name : 'non-error');
      console.warn(`[org-memories] ${what} read failed for ${orgId} (${label}); rows hidden, fail-closed`);
      for (const fed of feeds) state[fed] = true;
      return fallback;
    };
  return { degradedRead, state };
}

// portal#2175: the paged reads behind this tab can hand back the same id twice
// — a row shifting across a page boundary mid-fetch lists twice wherever the
// caller doesn't dedupe. One shared helper keeps the rule identical for every
// read this loader consumes (dedupe by id, first occurrence wins, BEFORE any
// owner-field sort, so a duplicate never moves a row between tabs — the #2147
// rule). The shared fetchAllItems pager itself is unchanged: making it dedupe
// for every consumer is its own slice, not this one.
function uniqueById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

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
  const { degradedRead, state: degradedReads } = degradedReadsTracker();
  const [systemRows, ownSystemIds, publicMemories, myMemories] = await Promise.all([
    // Feeds systemMemories AND personalMemories (ownSystemMemories below is
    // cut from systemRows), so its failure degrades both tabs.
    fetchAllItems<Memory>(client, ORG_SYSTEM_MEMORIES_QUERY, 'memories', { orgId: params.id })
      .catch(degradedRead(params.id, 'org system memories', [] as Memory[], ['systemMemories', 'personalMemories'])),
    // #2140: whose org-less system rows are the caller's is the server's call. A
    // failed read leaves the set empty, which hides those rows rather than
    // showing someone else's — and flags the personal tab they were headed for.
    fetchAllItems<{ id: string }>(client, OWN_SYSTEM_MEMORY_IDS_QUERY, 'memories')
      .then((rows) => new Set(rows.map((m) => m.id)))
      .catch(degradedRead(params.id, 'own system-memory ids', new Set<string>(), ['personalMemories'])),
    fetchAllItems<Memory>(gqlClient(), PUBLIC_MEMORIES_QUERY, 'memories')
      .catch(degradedRead(params.id, 'public memories', [] as Memory[], ['availableMemories'])),
    fetchAllItems<Memory>(client, MEMORIES_QUERY, 'memories')
      .catch(degradedRead(params.id, 'my memories', [] as Memory[], ['personalMemories'])),
  ]);
  // Exclude memories already owned or subscribed to by this org
  const ownedIds = new Set((org.memories ?? []).map((m) => m.id));
  const subscribedIds = new Set((org.subscriptions ?? []).map((s) => s.memory.id));
  const availableMemories = uniqueById(publicMemories).filter(
    (m) => !ownedIds.has(m.id) && !subscribedIds.has(m.id) && m.organizationId !== params.id,
  );
  // #2140: memories(orgId:) is not an "owned by this org" list. It returns the
  // caller's own user-owned memories in every org context, and unions in the
  // install memory of every App the caller reaches, in ANY org
  // (hrn:node:hadronmemory.com:specs:cor:api:100,
  // hrn:node:hadronmemory.com:specs:cor:api:100:01,
  // hrn:node:hadronmemory.com:specs:cor:api:120:03). So the rows are sorted here
  // by who owns them: this org's stay in Org Memories, the caller's own org-less
  // ones go to Personal Memories, and everything else (another org's install
  // memory, someone else's user-owned row) is not shown. An install memory sits
  // in its App's own tenancy, so an App of this org carries this org's id and
  // survives.
  //
  // portal#2175 (FIT 6884373873 a): the paginated system read can hand back the
  // same id twice — a row shifting across a page boundary mid-fetch. Dedupe by
  // id (uniqueById), first occurrence wins, BEFORE the owner-field sort below,
  // so a duplicate lists once and never moves between tabs: where a row shows
  // depends only on its owner fields (the #2147 rule).
  const uniqueSystemRows = uniqueById(systemRows);
  const systemMemories = uniqueSystemRows.filter((m) => m.organizationId === params.id);
  // The class predicate is explicit, not left to the query's memoryClasses
  // filter: this slice and the personal/private one below must stay disjoint
  // however the server answers, or a row would render twice.
  const ownSystemMemories = uniqueSystemRows.filter(
    (m) => m.class === 'system' && m.organizationId == null && ownSystemIds.has(m.id),
  );
  // Spec 034: personal memories (the personal + private classes) are owner-only
  // and excluded from Organization.memories server-side, so surface the caller's
  // own ones whose container is this org (memories() scopes to the caller via
  // userId). The caller's own org-less system memories join them (above), and a
  // row already listed is never listed twice — the memories() read paginates
  // too, so it is deduped the same way (portal#2175).
  const ownPrivate = uniqueById(myMemories).filter(
    (m) =>
      m.organizationId === params.id &&
      !!locals.user?.id &&
      m.userId === locals.user.id &&
      (m.class === 'personal' || m.class === 'private'),
  );
  const seen = new Set(ownPrivate.map((m) => m.id));
  const personalMemories = ownPrivate.concat(ownSystemMemories.filter((m) => !seen.has(m.id)));
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
    // portal#2175: per-list degraded flags — true when a read feeding that
    // list failed. The page trades its empty-state copy for truthful
    // unavailable copy on a flagged tab; the rows themselves stay hidden.
    // (Suffixed keys: the tracker keys name the LISTS the failed read feeds,
    // and spreading those here would clobber the lists themselves.)
    systemMemoriesDegraded: degradedReads.systemMemories,
    personalMemoriesDegraded: degradedReads.personalMemories,
    availableMemoriesDegraded: degradedReads.availableMemories,
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
    const unconfirmed: string[] = [];
    const notes: string[] = [];
    for (const m of memories) {
      if (!m.source) continue;
      try {
        const res = await client.request<{ syncMemory: SyncOutcomeFields | null }>(SYNC_MEMORY_MUTATION, { id: m.id });
        const { view, message: outcome } = classifySyncOutcome(res.syncMemory);
        if (outcome.type === 'error') errors.push(`${m.name}: ${outcome.text}`);
        else if (res.syncMemory?.syncStatus !== 'OK') unfinished.push(m.name);
        else if (['partial', 'unknown', 'unavailable'].includes(view.state)) notes.push(m.name);
        else if (view.state !== 'clean') unconfirmed.push(m.name);
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
    if (notes.length || unfinished.length || unconfirmed.length) {
      const parts: string[] = [];
      if (notes.length) parts.push(t('org-memories.sync-notes', 'Synced with notes: {names}.', { names: notes.join(', ') }));
      if (unfinished.length) parts.push(t('org-memories.sync-not-finished', 'Some syncs didn’t finish yet: {names}. Check their status again shortly.', { names: unfinished.join(', ') }));
      if (unconfirmed.length) parts.push(t('org-memories.sync-completion-unconfirmed', 'Clean completed syncs are not confirmed for: {names}. Check their status and last-synced time.', { names: unconfirmed.join(', ') }));
      return message(form, { type: 'success', text: parts.join(' ') });
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
