<!--
  Org agents list — TanStack grid (@tanstack/table-core + the Svelte 5
  runes adapter, src/lib/table/*), same chrome conventions as
  /app/usage/sessions and /app/account/api-keys (PR #293/#294).

  009-install-agent-flow T012's no-nested-interactive constraint carries
  over naturally: the name link and the Install button live in separate
  cells, so neither wraps the other.
-->
<script lang="ts">
  import {
    getCoreRowModel,
    getSortedRowModel,
    getFilteredRowModel,
    getPaginationRowModel,
    type ColumnDef,
  } from '@tanstack/table-core';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import NodeActionsMenu, { type NodeMenuAction } from '$lib/components/NodeActionsMenu.svelte';
  import SelectPublicAgent from '$lib/components/SelectPublicAgent.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { installStrings } from '$lib/i18n/install-strings';
  import type { Agent } from '$lib/types';
  import type { AgentGrant, PublicAgent } from './+page.server';
  import type { ActionData, PageData } from './$types';
  import { orgAgentSubscribeSchema } from './schema';

  type OrgAgentSubscribeForm = Infer<typeof orgAgentSubscribeSchema, 'zod4'>;
  type OrgAgentSubscribeSuperform = SuperValidated<OrgAgentSubscribeForm, App.Superforms.Message, OrgAgentSubscribeForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
  const agents = $derived(org.agents ?? []);
  // agentId → the App it's installed as (id + name), for the "Open" affordance.
  const installedByAgent = $derived(data.installedByAgent ?? {});
  // #486: cross-org AgentOrgGrants; null = fetch failed (≠ empty).
  const subscribedGrants = $derived(data.subscribedGrants);
  // Public agents this org can still subscribe to (own + granted excluded).
  const subscribablePublicAgents = $derived(data.subscribablePublicAgents ?? []);

  // ── Tabs (#486): the org's own agents vs its subscriptions ───────────
  let activeTab = $state<'own' | 'subscribed'>('own');

  function submittedSubscribe(actionData: ActionData): OrgAgentSubscribeSuperform | null {
    const candidate = actionData && 'form' in actionData ? actionData.form : null;
    const candidateData = candidate?.data;
    const kind = candidateData && typeof candidateData === 'object' && '_kind' in candidateData
      ? String(candidateData._kind)
      : null;
    return kind === 'subscribeAgent'
      ? candidate as OrgAgentSubscribeSuperform
      : null;
  }

  // Subscribe picker: selecting a public agent submits the explicit grant
  // mutation through a SvelteKit action; no App is installed (#649).
  let subscribeOpen = $state(false);
  let subscribeForm: HTMLFormElement;
  const initialSubscribeForm = untrack(() => submittedSubscribe(form) ?? data.subscribeForm);
  const {
    form: subscribeFormData,
    errors: subscribeErrors,
    message: subscribeMessage,
    submitting: subscribeSubmitting,
    enhance: subscribeEnhance,
  } = superForm<OrgAgentSubscribeForm, App.Superforms.Message, OrgAgentSubscribeForm>(initialSubscribeForm, {
    validators: zod4Client(orgAgentSubscribeSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
    onUpdated: ({ form }) => {
      if (form.valid && form.message?.type !== 'error') {
        subscribeFormData.update((current) => ({ ...current, agentId: '' }), { taint: false });
        activeTab = 'subscribed';
      }
    },
  });
  const subscribeAgentError = $derived($subscribeErrors.agentId?.[0] ?? null);
  const subscribeActionError = $derived($subscribeMessage?.type === 'error' ? $subscribeMessage.text : null);
  const subscribeActionSuccess = $derived($subscribeMessage?.type === 'success' ? $subscribeMessage.text : null);

  // Row-level unsubscribe state keeps the rest of the table usable while a
  // grant is being revoked and leaves lifecycle history visible afterward.
  let unsubscribeAgentId = $state('');
  let unsubscribePendingAgentId = $state<string | null>(null);
  let unsubscribeError = $state<string | null>(null);
  let unsubscribeForm: HTMLFormElement;

  async function subscribeTo(agent: Pick<PublicAgent, 'id'>) {
    if ($subscribeSubmitting) return;
    subscribeFormData.update((current) => ({ ...current, agentId: agent.id }));
    await tick();
    subscribeForm.requestSubmit();
  }

  const activeGrantActions: NodeMenuAction[] = [
    { id: 'install', label: t('org-agents.subscribed.action.install', 'Install') },
    {
      id: 'unsubscribe',
      label: t('org-agents.subscribed.unsubscribe', 'Unsubscribe'),
      danger: true,
    },
  ];

  async function onGrantAction(actionId: string, grant: AgentGrant) {
    if (actionId === 'install') {
      goto(`/app/orgs/${org.id}/agents/install/${grant.agentId}`);
      return;
    }
    if (actionId !== 'unsubscribe' || unsubscribePendingAgentId) return;

    const agentName = grant.agent?.name ?? grant.agentId;
    const prompt = t('org-agents.subscribed.unsubscribe.confirm', 'Unsubscribe from');
    if (!confirm(`${prompt} "${agentName}"?`)) return;

    unsubscribeAgentId = grant.agentId;
    unsubscribePendingAgentId = grant.agentId;
    await tick();
    unsubscribeForm.requestSubmit();
  }

  let globalFilter = $state('');

  const columns: ColumnDef<Agent>[] = [
    { accessorKey: 'name', header: t('org-agents.column.name', 'Name'), enableHiding: false, size: 200 }, // identity column
    { accessorKey: 'urn', header: t('org-agents.column.urn', 'URN'), size: 280 },
    { accessorKey: 'description', header: t('org-agents.column.description', 'Description'), size: 280 },
    // +1 for the agent's own system memory (when it has one) — it isn't part
    // of memoryItems. Agents without a system memory count only memoryItems.
    { accessorFn: (row) => row.memoryItems.length + (row.systemMemoryId ? 1 : 0), id: 'memories', header: t('org-agents.column.memories', 'Memories'), size: 100 },
    { id: 'actions', header: t('org-agents.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 170 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    description: (v) => (v as string | null) ?? '—',
  };

  const table = createSvelteTable<Agent>({
    get data() {
      return agents;
    },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return globalFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      globalFilter = typeof u === 'function' ? u(globalFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  // ── Subscribed tab table (#486) ───────────────────────────────────────
  /** Owning org's slug out of a canonical agent URN (hrn:agent:<org>::<slug>). */
  function ownerSlugOf(urn: string): string {
    const bare = urn.replace(/^(hrn|urn):agent:/, '');
    const sep = bare.indexOf('::');
    return sep >= 0 ? bare.slice(0, sep) : bare;
  }

  // Lifecycle as a structural kind + a localized label, kept apart so the
  // status-chip styling keys off the KIND — never the translated string
  // (PR-494 review: label comparison breaks under any non-English locale).
  type GrantStatusKind = 'active' | 'revoked' | 'expired' | 'pending';
  function grantStatusKind(g: AgentGrant): GrantStatusKind {
    if (g.revokedAt) return 'revoked';
    if (g.expiresAt && new Date(g.expiresAt).getTime() < Date.now()) return 'expired';
    return g.isActive ? 'active' : 'pending';
  }
  const grantStatusLabel: Record<GrantStatusKind, string> = {
    active: t('org-agents.subscribed.status.active', 'Active'),
    revoked: t('org-agents.subscribed.status.revoked', 'Revoked'),
    expired: t('org-agents.subscribed.status.expired', 'Expired'),
    pending: t('org-agents.subscribed.status.pending', 'Pending'),
  };

  // Pin locale AND timezone so SSR and client format identically — the
  // server may run in UTC while the browser doesn't (PR-494 review).
  function fmtDate(s: string | null): string {
    if (!s) return '—';
    const d = new Date(s);
    return isNaN(d.getTime())
      ? '—'
      : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
  }

  let grantsFilter = $state('');

  const grantColumns: ColumnDef<AgentGrant>[] = [
    { accessorFn: (g) => g.agent?.name ?? g.agentId, id: 'name', header: t('org-agents.subscribed.column.name', 'Name'), enableHiding: false, size: 200 },
    { accessorFn: (g) => g.agent?.urn ?? '', id: 'urn', header: t('org-agents.subscribed.column.urn', 'URN'), size: 280 },
    { accessorFn: (g) => (g.agent ? ownerSlugOf(g.agent.urn) : '—'), id: 'owner', header: t('org-agents.subscribed.column.owner', 'Owner'), size: 140 },
    { accessorFn: (g) => grantStatusLabel[grantStatusKind(g)], id: 'status', header: t('org-agents.subscribed.column.status', 'Status'), size: 100 },
    { accessorFn: (g) => g.activatedAt ?? g.createdAt, id: 'since', header: t('org-agents.subscribed.column.since', 'Since'), size: 120 },
    { id: 'actions', header: t('org-agents.subscribed.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 130 },
  ];

  const grantsTable = createSvelteTable<AgentGrant>({
    get data() {
      return subscribedGrants ?? [];
    },
    columns: grantColumns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: {
      get globalFilter() {
        return grantsFilter;
      },
    },
    onGlobalFilterChange: (u) => {
      grantsFilter = typeof u === 'function' ? u(grantsFilter) : u;
    },
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageIndex: 0, pageSize: 20 } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });
</script>

<svelte:head><title>Agents · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div class="flex items-start justify-between">
    <div>
      <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">Agents</h1>
      <p class="text-sm text-zinc-500">Group memories into agents for app subscriptions.</p>
    </div>
    <div class="flex items-center gap-2">
      {#if activeTab === 'own'}
        <a href="/app/orgs/{org.id}/agents/new" class="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
          New Agent
        </a>
      {:else}
        <button
          type="button"
          onclick={() => (subscribeOpen = true)}
          disabled={$subscribeSubmitting}
          class="rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-50"
          style="background: #fb8500;"
        >
          {$subscribeSubmitting
            ? t('org-agents.subscribed.subscribing', 'Subscribing...')
            : t('org-agents.subscribed.subscribe', 'Subscribe to Public Agent')}
        </button>
      {/if}
    </div>
  </div>

  <form
    bind:this={subscribeForm}
    method="POST"
    action="?/subscribe"
    class="hidden"
    use:subscribeEnhance
    novalidate
  >
    <input type="hidden" name="_kind" value={$subscribeFormData._kind} />
    <input type="hidden" name="agentId" value={$subscribeFormData.agentId} />
  </form>

  <form
    bind:this={unsubscribeForm}
    method="POST"
    action="?/unsubscribe"
    class="hidden"
    use:enhance={() => {
      unsubscribePendingAgentId = unsubscribeAgentId;
      unsubscribeError = null;
      return async ({ result, update }) => {
        try {
          if (result.type === 'failure') {
            unsubscribeError = typeof result.data?.unsubscribeError === 'string'
              ? result.data.unsubscribeError
              : t(
                  'org-agents.subscribed.unsubscribe.error',
                  'Failed to remove the agent subscription.',
                );
          } else if (result.type === 'success') {
            unsubscribeError = null;
          }
          await update({ reset: false });
        } finally {
          unsubscribeAgentId = '';
          unsubscribePendingAgentId = null;
        }
      };
    }}
  >
    <input type="hidden" name="agentId" value={unsubscribeAgentId} />
  </form>

  <!-- Select Public Agent (#486/#649): selection creates the grant in place. -->
  <SelectPublicAgent
    agents={subscribablePublicAgents}
    bind:open={subscribeOpen}
    onselect={subscribeTo}
  />

  {#if subscribeActionError || subscribeAgentError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {subscribeActionError ?? subscribeAgentError}
    </div>
  {/if}

  {#if subscribeActionSuccess}
    <div role="status" class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">
      {subscribeActionSuccess}
    </div>
  {/if}

  {#if unsubscribeError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      {unsubscribeError}
    </div>
  {/if}

  <!-- Own vs Subscribed (#486). Subscribed = the org's AgentOrgGrants for
       agents owned by OTHER orgs. -->
  <div class="flex gap-0 border-b border-zinc-200 dark:border-zinc-800">
    <button
      type="button"
      class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'own' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
      onclick={() => (activeTab = 'own')}
    >{t('org-agents.tab.own', 'Organization agents')}</button>
    <button
      type="button"
      class="border-b-2 px-3 py-1.5 text-sm font-medium {activeTab === 'subscribed' ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400' : 'border-transparent text-zinc-500'}"
      onclick={() => (activeTab = 'subscribed')}
    >{t('org-agents.tab.subscribed', 'Subscribed')}
      {#if subscribedGrants && subscribedGrants.length > 0}
        <span class="ml-1 rounded-full bg-zinc-200 px-1.5 text-xs dark:bg-zinc-800">{subscribedGrants.length}</span>
      {/if}
    </button>
  </div>

  {#if activeTab === 'subscribed'}
    {#if subscribedGrants === null}
      <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
        {t('org-agents.subscribed.unavailable', 'Subscriptions couldn’t be loaded — try again in a moment.')}
      </div>
    {:else if subscribedGrants.length === 0}
      <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
        <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
          {t('org-agents.subscribed.empty.title', 'No subscriptions to agents from other organizations.')}
        </p>
        <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
          {t(
            'org-agents.subscribed.empty.explainer',
            'Use “Subscribe to Public Agent” above to browse public agents from other organizations. Only organization admins can create and see subscriptions.',
          )}
        </p>
      </div>
    {:else}
      <DataTable
        table={grantsTable}
        listKey="orgs:subscribed-agents"
        searchPlaceholder={t('org-agents.subscribed.search.placeholder', 'Search subscriptions...')}
        searchAriaLabel={t('org-agents.subscribed.search.aria-label', 'Search subscriptions')}
        bind:globalFilter={grantsFilter}
        maxHeight="max(200px, calc(100vh - 25rem))"
      >
        {#snippet cell(cell, grant)}
          {#if cell.column.id === 'urn'}
            {#if grant.agent}
              <Urn value={grant.agent.urn} type="agent" size={8} />
            {:else}
              —
            {/if}
          {:else if cell.column.id === 'status'}
            {@const kind = grantStatusKind(grant)}
            <span class="rounded-full px-2 py-0.5 text-xs font-medium {kind === 'active'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
              : 'bg-zinc-200 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}">{grantStatusLabel[kind]}</span>
          {:else if cell.column.id === 'since'}
            <span class="whitespace-nowrap">{fmtDate(grant.activatedAt ?? grant.createdAt)}</span>
          {:else if cell.column.id === 'actions'}
            {#if grantStatusKind(grant) === 'active'}
              <NodeActionsMenu
                actions={activeGrantActions}
                onselect={(actionId) => onGrantAction(actionId, grant)}
                label={`${t('org-agents.subscribed.actions.label', 'Actions for')} ${grant.agent?.name ?? grant.agentId}`}
                disabled={unsubscribePendingAgentId === grant.agentId}
                fixed
              />
            {/if}
          {:else}
            <div class="truncate">{cell.getValue()}</div>
          {/if}
        {/snippet}
      </DataTable>
    {/if}
  {:else if agents.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900">
      No agents yet. <a href="/app/orgs/{org.id}/agents/new" class="text-indigo-600 hover:underline dark:text-indigo-400">Create one →</a>
    </div>
  {:else}
    <!-- 25rem offset tuned to this page's chrome height. -->
    <DataTable
      {table}
      listKey="orgs:agents"
      searchPlaceholder={t('org-agents.search.placeholder', 'Search agents...')}
      searchAriaLabel={t('org-agents.search.aria-label', 'Search agents')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 25rem))"
    >
      {#snippet cell(cell, agent)}
        {#if cell.column.id === 'name'}
          <div class="truncate">
            <a href="/app/orgs/{org.id}/agents/{agent.id}" class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{agent.name}</a>
          </div>
        {:else if cell.column.id === 'urn'}
          <Urn value={agent.urn} type="agent" size={8} />
        {:else if cell.column.id === 'actions'}
          {@const installed = installedByAgent[agent.id]}
          <div class="flex items-center gap-2">
            {#if installed}
              <a
                href="/app/orgs/{org.id}/apps/{installed.appId}"
                title={t('org-agents.action.open-title', 'Open the app this agent is installed as')}
                class="inline-block rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t('org-agents.action.open', 'Open')}
              </a>
            {/if}
            <a
              href="/app/orgs/{org.id}/agents/install/{agent.id}"
              class="inline-block rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
              style="background: #fb8500;"
            >
              {installStrings.buttonLabel()}
            </a>
          </div>
        {:else}
          {@const f = fmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
  {/if}
</div>
