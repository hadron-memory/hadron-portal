<!--
  Org apps list — TanStack grid (@tanstack/table-core + the Svelte 5
  runes adapter, src/lib/table/*), same chrome conventions as
  /app/usage/sessions and /app/account/api-keys (PR #293/#294).

  009-install-agent-flow FR-011 / T019 still holds: this page is
  list-only; the empty state directs the user to the Agents list to
  install, and creation happens via the install flow.
-->
<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import type { PortalColumnDef } from '$lib/table/features';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import NodeActionsMenu from '$lib/components/NodeActionsMenu.svelte';
  import { scopedActionError, scopedActionSuccess } from '$lib/forms/scoped-message';
  import { submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import { installStrings } from '$lib/i18n/install-strings';
  import type { App as HadronApp } from '$lib/types';
  import type { PageData, ActionData } from './$types';
  import { deleteOrgAppSchema } from './schema';

  type DeleteOrgAppForm = Infer<typeof deleteOrgAppSchema, 'zod4'>;
  type DeleteOrgAppSuperform = SuperValidated<DeleteOrgAppForm, App.Superforms.Message, DeleteOrgAppForm>;

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);
  const apps = $derived(data.apps);
  const initialDeleteForm = untrack(() => submittedForm<DeleteOrgAppForm>(form, 'deleteApp') as DeleteOrgAppSuperform | null ?? data.deleteForm);
  const {
    form: deleteForm,
    errors: deleteErrors,
    message: deleteMessage,
    submitting: deleteSubmitting,
    enhance: deleteEnhance,
  } = superForm<DeleteOrgAppForm, App.Superforms.Message, DeleteOrgAppForm>(initialDeleteForm, {
    validators: zod4Client(deleteOrgAppSchema),
    validationMethod: 'oninput',
    scrollToError: 'smooth',
    autoFocusOnError: 'detect',
    clearOnSubmit: 'none',
  });
  const deleteActionError = $derived(scopedActionError<DeleteOrgAppForm>(form, 'deleteApp', $deleteMessage, $deleteErrors, ['id', '_kind']));
  const deleteActionSuccess = $derived(scopedActionSuccess<DeleteOrgAppForm>(form, 'deleteApp', $deleteMessage));

  function activeKeyCount(app: HadronApp): number {
    return app.keys.filter((k) => !k.revokedAt).length;
  }

  // #1020: Manage and Delete live in the row's ⋯ menu. Rows no longer hold
  // their own delete form; one hidden form below the table is submitted for
  // the picked app, after the same browser confirm.
  let deleteAppFormEl = $state<HTMLFormElement | null>(null);
  async function deleteApp(app: { id: string; name: string }) {
    if ($deleteSubmitting) return;
    if (!confirm(`Delete app "${app.name}"? Active keys will be revoked and sessions invalidated.`)) return;
    prepareDeleteApp(app.id);
    await tick();
    deleteAppFormEl?.requestSubmit();
  }

  function prepareDeleteApp(id: string) {
    deleteForm.update((current) => ({ ...current, id }), { taint: false });
  }

  let globalFilter = $state('');

  const columns: PortalColumnDef<HadronApp>[] = [
    { accessorKey: 'name', header: t('org-apps.column.name', 'Name'), enableHiding: false, size: 180 }, // identity column
    { accessorKey: 'urn', header: t('org-apps.column.urn', 'URN'), size: 260 },
    { accessorFn: (row) => row.agent?.name ?? null, id: 'agent', header: t('org-apps.column.agent', 'Agent'), size: 150 },
    { accessorKey: 'identifyUserMethod', header: t('org-apps.column.identify-users', 'Identify users'), size: 120 },
    { accessorKey: 'createUserPermission', header: t('org-apps.column.create-users', 'Create users'), size: 120 },
    { accessorFn: (row) => activeKeyCount(row), id: 'activeKeys', header: t('org-apps.column.active-keys', 'Active keys'), size: 100 },
    { accessorKey: 'sessionTimeoutSeconds', header: t('org-apps.column.session-timeout', 'Session timeout'), size: 130 },
    { accessorKey: 'anonymousTtlDays', header: t('org-apps.column.anon-ttl', 'Anon TTL'), size: 90 },
    { id: 'actions', header: t('org-apps.column.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 80 },
  ];

  const fmt: Record<string, (v: unknown) => string> = {
    agent: (v) => (v as string | null) ?? '—',
    sessionTimeoutSeconds: (v) => (typeof v === 'number' ? `${Math.round(v / 60)}m` : '—'),
    anonymousTtlDays: (v) => (v != null ? `${v}d` : '—'),
  };

  const table = createSvelteTable<HadronApp>({
    get data() {
      return apps;
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
  });


</script>

<svelte:head><title>Apps · {org.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">Apps</h1>
    <p class="mt-1 text-sm text-zinc-500">Installed Agents that authenticate clients (Micromentor, websites, mobile apps, the coding-agent CLI). Each App is a deployment of an Agent.</p>
  </div>

  {#if deleteActionError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{deleteActionError}</div>
  {:else if deleteActionSuccess}
    <div role="status" class="rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700 dark:border-green-900 dark:bg-green-950 dark:text-green-300">{deleteActionSuccess}</div>
  {/if}

  {#if apps.length === 0}
    <!-- 009-install-agent-flow FR-011 / T019: Apps page is list-only.
         Empty-state copy directs the user to the Agents list to install. -->
    <div class="rounded-xl border border-dashed border-zinc-300 bg-zinc-50 p-8 text-center dark:border-zinc-700 dark:bg-zinc-900/50">
      <p class="text-sm text-zinc-500">{installStrings.emptyAppsPage()}</p>
      <a href="/app/orgs/{org.id}/agents" class="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-semibold text-white" style="background: #fb8500;">
        Browse Agents
      </a>
    </div>
  {:else}
    <!-- 25rem offset tuned to this page's chrome height (taller header
         with lead paragraph than sessions/api-keys). -->
    <DataTable
      {table}
      listKey="orgs:apps"
      searchPlaceholder={t('org-apps.search.placeholder', 'Search apps...')}
      searchAriaLabel={t('org-apps.search.aria-label', 'Search apps')}
      bind:globalFilter
      maxHeight="max(200px, calc(100vh - 25rem))"
    >
      {#snippet cell(cell, app)}
        {#if cell.column.id === 'name'}
          <div class="truncate">
            <a href="/app/apps/{app.id}" class="font-semibold text-indigo-600 hover:underline dark:text-indigo-300">{app.name}</a>
          </div>
        {:else if cell.column.id === 'urn'}
          <Urn value={app.urn} type="app" size={8} />
        {:else if cell.column.id === 'identifyUserMethod' || cell.column.id === 'createUserPermission'}
          <span class="inline-block rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{cell.getValue()}</span>
        {:else if cell.column.id === 'actions'}
          <NodeActionsMenu
            actions={[
              { id: 'manage', label: t('org-apps.action.manage', 'Manage'), href: `/app/apps/${app.id}` },
              { id: 'delete', label: t('org-apps.action.delete', 'Delete'), danger: true },
            ]}
            onselect={(id) => { if (id === 'delete') deleteApp(app); }}
            label={`${t('org-apps.actions.label', 'Actions for')} ${app.name}`}
            disabled={$deleteSubmitting}
            fixed
            compact
          />
        {:else}
          {@const f = fmt[cell.column.id]}
          <div class="truncate">{f ? f(cell.getValue()) : cell.getValue()}</div>
        {/if}
      {/snippet}
    </DataTable>
    <form bind:this={deleteAppFormEl} method="POST" action="?/delete" use:deleteEnhance novalidate class="hidden">
      <input type="hidden" name="_kind" value={$deleteForm._kind} />
      <input type="hidden" name="id" value={$deleteForm.id} />
    </form>
  {/if}
</div>
