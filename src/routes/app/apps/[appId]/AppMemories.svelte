<script lang="ts">
  import { tick, untrack, type Snippet } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import LiveOutcome from '$lib/components/LiveOutcome.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { failedSubmission, submittedForm } from '$lib/forms/submitted-form';
  import { t } from '$lib/i18n/t';
  import type { AppMemoryRow, AttachableMemory, AttachMemoryMessage } from './app-memories';
  import type { AttachableRead } from './attachable/+server';
  import AppMemoryAddDialog from './AppMemoryAddDialog.svelte';
  import { attachAppMemorySchema } from './schema';
  type AttachFields = Infer<typeof attachAppMemorySchema, 'zod4'>;
  let { memories, appId, agentId, hasAgent, canCreate, attachForm, result, createOpen = $bindable(false), create }: {
    memories: AppMemoryRow[] | null;
    appId: string;
    // The installed Agent a memory is added through: the App's primary one.
    agentId: string | null;
    hasAgent: boolean;
    // Whether to OFFER creating a new memory (null: unknown, offered not). The server's gate stays the authority.
    canCreate: boolean | null;
    attachForm: SuperValidated<AttachFields, AttachMemoryMessage>;
    result: unknown;
    // Set when the user asks for a new memory; the form then shows below the list.
    createOpen?: boolean;
    create?: Snippet;
  } = $props();

  let search = $state('');
  const columns: PortalColumnDef<AppMemoryRow>[] = [
    { accessorKey: 'name', header: t('app.memory.name', 'Name'), enableHiding: false, size: 300 },
    { accessorKey: 'class', header: t('app.memory.class', 'Class'), size: 140 },
  ];
  const table = createSvelteTable<AppMemoryRow>({
    get data() { return memories ?? []; }, columns,
    globalFilterFn: makeGlobalFilterFn<AppMemoryRow>({}, { name: row => row.urn }),
    enableColumnResizing: true, columnResizeMode: 'onChange',
    state: { get globalFilter() { return search; } },
    onGlobalFilterChange: u => { search = typeof u === 'function' ? u(search) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });

  // Adding an EXISTING memory: pick one of the user's own, then submit the attach.
  const { form, message, enhance, submit } = superForm(untrack(() => {
    const submitted = submittedForm<AttachFields>(result, 'attachAppMemory') as SuperValidated<AttachFields, AttachMemoryMessage> | null;
    return (failedSubmission<AttachFields>(result, 'attachAppMemory') as SuperValidated<AttachFields, AttachMemoryMessage> | null) ?? { ...attachForm, message: submitted?.message };
  }), { validators: zod4Client(attachAppMemorySchema), invalidateAll: 'force', resetForm: true });

  let chooserOpen = $state(false);
  let pickerOpen = $state(false);
  let loadingCandidates = $state(false);
  let candidates = $state<AttachableMemory[]>([]);
  let candidatesFailed = $state(false);
  // Latest-wins: a late answer for an earlier press must not open a picker the user already left.
  let candidatesRequest = 0;
  async function chooseExisting() {
    const mine = ++candidatesRequest;
    loadingCandidates = true; candidatesFailed = false;
    try {
      const res = await fetch(`/app/apps/${encodeURIComponent(appId)}/attachable`);
      const body = res.ok ? ((await res.json()) as AttachableRead) : { kind: 'failed' as const };
      if (mine !== candidatesRequest) return;
      if (body.kind !== 'ok') { candidatesFailed = true; chooserOpen = false; return; }
      candidates = body.memories;
      chooserOpen = false; pickerOpen = true;
    } catch {
      if (mine === candidatesRequest) { candidatesFailed = true; chooserOpen = false; }
    } finally {
      if (mine === candidatesRequest) loadingCandidates = false;
    }
  }
  async function attach(memory: { id: string }) {
    if (!agentId) return;
    $form.memoryId = memory.id;
    $form.agentId = agentId;
    // The hidden inputs take their values from the store on the next flush; submitting before it would post the
    // previous pick, or nothing.
    await tick();
    submit();
  }
  function chooseNew() { chooserOpen = false; createOpen = true; }
</script>
{#snippet addButton()}
  <button type="button" onclick={() => { chooserOpen = true; }} aria-haspopup="dialog" aria-expanded={chooserOpen || pickerOpen} data-testid="app-memory-add"
    class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.memory.add-button', 'Add memory')}</button>
{/snippet}
<section class="mb-6 space-y-4">
  {#if memories === null}
    <div class="flex flex-wrap items-center gap-3">
      <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('app.memory.load-failed', 'Could not load this App’s memories. Reload to try again.')}</p>
      {@render addButton()}
    </div>
  {:else if memories.length === 0}
    <div class="flex flex-wrap items-center gap-3">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.memory.empty', 'No App memories to show.')}</p>
      {@render addButton()}
    </div>
  {:else}
    <DataTable {table} listKey="app-memories" bind:globalFilter={search} searchPlaceholder={t('app.memory.search', 'Search App memories')} searchAriaLabel={t('app.memory.search', 'Search App memories')} footerStart={addButton}>
      {#snippet cell(cell, memory)}
        {#if cell.column.id === 'name'}
          <a href="/app/memories/{memory.id}" class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{memory.name}</a>
          <div class="mt-1"><Urn value={memory.urn} type="memory" size={10} /></div>
        {:else}{memory.class}{/if}
      {/snippet}
    </DataTable>
  {/if}
  <!-- The outcome of adding an existing memory, beside the list it changed. -->
  <LiveOutcome failed={$message?.type === 'error' || candidatesFailed}>
    {#if candidatesFailed}
      <p class="text-sm text-red-600 dark:text-red-400">{t('app.memory.candidates-failed', 'Could not load your memories. Please try again.')}</p>
    {:else if $message}
      <p class="text-sm {$message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$message.text}</p>
    {/if}
  </LiveOutcome>
  {#if createOpen && create}{@render create()}{/if}
</section>
<form method="POST" action="?/attachMemory" use:enhance class="hidden">
  <input type="hidden" name="_kind" value="attachAppMemory" />
  <input type="hidden" name="memoryId" value={$form.memoryId} />
  <input type="hidden" name="agentId" value={$form.agentId} />
</form>
<AppMemoryAddDialog bind:open={chooserOpen} hasAgent={hasAgent && agentId !== null} {canCreate} loading={loadingCandidates} onexisting={chooseExisting} onnew={chooseNew} />
<SelectMemory bind:open={pickerOpen} memories={candidates} onselect={attach} placeholder={t('app.memory.pick-placeholder', 'Search your memories by name or URN...')} />
