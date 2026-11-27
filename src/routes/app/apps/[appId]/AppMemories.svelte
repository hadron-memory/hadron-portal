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
  import type { AppMemoryRow, AttachableMemory, AttachMemoryMessage, OwnMemoryClass, OwnMemoryMessage } from './app-memories';
  import { notYetInScope } from './attachable-candidates';
  import type { AttachableRead } from './attachable/+server';
  import AppMemoryAddDialog from './AppMemoryAddDialog.svelte';
  import AppMemoryDetachDialog from './AppMemoryDetachDialog.svelte';
  import { attachAppMemorySchema, createOwnAppMemorySchema, detachAppMemorySchema } from './schema';
  type AttachFields = Infer<typeof attachAppMemorySchema, 'zod4'>;
  type OwnFields = Infer<typeof createOwnAppMemorySchema, 'zod4'>;
  type DetachFields = Infer<typeof detachAppMemorySchema, 'zod4'>;
  let { memories, appId, agentId, hasAgent, canCreate, attachForm, detachForm, ownForm, ownClasses = null, result, createOpen = $bindable(false), create }: {
    memories: AppMemoryRow[] | null;
    appId: string;
    // The installed Agent a memory is added through: the App's primary one.
    agentId: string | null;
    // Whether an Agent is installed: only creating a new memory needs one. Linking an existing memory does not.
    hasAgent: boolean;
    // Whether to OFFER creating a new memory (null: unknown, offered not). The server's gate stays the authority.
    canCreate: boolean | null;
    attachForm: SuperValidated<AttachFields, AttachMemoryMessage>;
    detachForm: SuperValidated<DetachFields, AttachMemoryMessage>;
    ownForm: SuperValidated<OwnFields, OwnMemoryMessage>;
    // The classes the server says this viewer may still create for themselves (App.viewerAppUserMemoryClasses), as is.
    ownClasses?: OwnMemoryClass[] | null;
    result: unknown;
    // Set when the user asks for a new memory; the form then shows below the list.
    createOpen?: boolean;
    create?: Snippet;
  } = $props();

  let search = $state('');
  const columns: PortalColumnDef<AppMemoryRow>[] = [
    { accessorKey: 'name', header: t('app.memory.name', 'Name'), enableHiding: false, size: 300 },
    { accessorKey: 'class', header: t('app.memory.class', 'Class'), size: 140 },
    { id: 'actions', header: t('app.memory.actions', 'Actions'), enableSorting: false, enableHiding: false, size: 110 },
  ];
  const table = createSvelteTable<AppMemoryRow>({
    get data() { return memories ?? []; }, columns,
    globalFilterFn: makeGlobalFilterFn<AppMemoryRow>({}, { name: row => row.urn }),
    enableColumnResizing: true, columnResizeMode: 'onChange',
    state: { get globalFilter() { return search; } },
    onGlobalFilterChange: u => { search = typeof u === 'function' ? u(search) : u; },
    initialState: { pagination: { pageIndex: 0, pageSize: 10 } },
  });

  // Linking an EXISTING memory: pick any memory the user can read, then submit the attach.
  const { form, message, enhance, submit, submitting } = superForm(untrack(() => {
    const submitted = submittedForm<AttachFields>(result, 'attachAppMemory') as SuperValidated<AttachFields, AttachMemoryMessage> | null;
    return (failedSubmission<AttachFields>(result, 'attachAppMemory') as SuperValidated<AttachFields, AttachMemoryMessage> | null) ?? { ...attachForm, message: submitted?.message };
  }), { validators: zod4Client(attachAppMemorySchema), invalidateAll: 'force', resetForm: true });

  // Removing a link: one memory, after a confirmation. The server decides who may and answers a link already gone with success.
  const { form: detachValues, message: detachMessage, enhance: detachEnhance, submit: detachSubmit, submitting: detachSubmitting } = superForm(untrack(() => {
    const submitted = submittedForm<DetachFields>(result, 'detachAppMemory') as SuperValidated<DetachFields, AttachMemoryMessage> | null;
    return (failedSubmission<DetachFields>(result, 'detachAppMemory') as SuperValidated<DetachFields, AttachMemoryMessage> | null) ?? { ...detachForm, message: submitted?.message };
  }), { validators: zod4Client(detachAppMemorySchema), invalidateAll: 'force', resetForm: true });
  let detaching = $state<AppMemoryRow | null>(null);
  async function detach() {
    if (!detaching || $detachSubmitting) return;
    $detachValues.memoryId = detaching.id;
    await tick();
    detaching = null;
    detachSubmit();
  }

  // Creating the viewer's OWN memory: the class is the only choice, the server names it and decides every outcome.
  const { form: ownValues, message: ownMessage, enhance: ownEnhance, submit: ownSubmit, submitting: ownSubmitting } = superForm(untrack(() => {
    const submitted = submittedForm<OwnFields>(result, 'createOwnAppMemory') as SuperValidated<OwnFields, OwnMemoryMessage> | null;
    return (failedSubmission<OwnFields>(result, 'createOwnAppMemory') as SuperValidated<OwnFields, OwnMemoryMessage> | null) ?? { ...ownForm, message: submitted?.message };
  }), { validators: zod4Client(createOwnAppMemorySchema), invalidateAll: 'force', resetForm: true });
  async function createOwn(memoryClass: OwnMemoryClass) {
    if (!agentId || $ownSubmitting) return;
    $ownValues.memoryClass = memoryClass;
    $ownValues.agentId = agentId;
    await tick();
    chooserOpen = false;
    ownSubmit();
  }

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
      candidates = notYetInScope(body.memories, memories);
      chooserOpen = false; pickerOpen = true;
    } catch {
      if (mine === candidatesRequest) { candidatesFailed = true; chooserOpen = false; }
    } finally {
      if (mine === candidatesRequest) loadingCandidates = false;
    }
  }
  async function attach(memory: { id: string }) {
    // One attach at a time: a second pick while the first is in flight would link the same memory twice.
    if ($submitting) return;
    $form.memoryId = memory.id;
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
          {#if memory.link && !memory.link.active}
            <span data-testid="app-memory-inactive" class="ml-2 rounded border border-amber-500 px-1.5 py-0.5 text-xs text-amber-800 dark:border-amber-400 dark:text-amber-200">{t('app.memory.inactive', 'Inactive')}</span>
          {/if}
          <div class="mt-1"><Urn value={memory.urn} type="memory" size={10} /></div>
          {#if memory.link && !memory.link.active}
            <p data-testid="app-memory-inactive-help" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('app.memory.inactive-help', 'This link does not count right now. It counts again by itself when the reason ends.')}</p>
          {/if}
        {:else if cell.column.id === 'actions'}
          {#if memory.link}
            <button type="button" data-testid="app-memory-detach" aria-label={t('app.memory.detach-aria', 'Detach {name}', { name: memory.name })} onclick={() => { detaching = memory; }}
              class="rounded-lg border border-zinc-300 px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">{t('app.memory.detach-button', 'Detach')}</button>
          {/if}
        {:else}{memory.class}{/if}
      {/snippet}
    </DataTable>
  {/if}
  <!-- The outcome of adding an existing memory, beside the list it changed. -->
  <LiveOutcome failed={$message?.type === 'error' || $ownMessage?.type === 'error' || $detachMessage?.type === 'error' || candidatesFailed}>
    {#if candidatesFailed}
      <p class="text-sm text-red-600 dark:text-red-400">{t('app.memory.candidates-failed', 'Could not load your memories. Please try again.')}</p>
    {:else if $ownMessage}
      <div class="text-sm {$ownMessage.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">
        <p>{$ownMessage.text}</p>
        {#if $ownMessage.type === 'success' && $ownMessage.created}
          <a href="/app/memories/{encodeURIComponent($ownMessage.created.id)}" class="mt-1 inline-block font-medium text-indigo-600 hover:underline dark:text-indigo-300">{$ownMessage.created.name}</a>
          <div class="mt-1"><Urn value={$ownMessage.created.urn} type="memory" size={10} /></div>
        {/if}
      </div>
    {:else if $detachMessage}
      <p class="text-sm {$detachMessage.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$detachMessage.text}</p>
    {:else if $message}
      <p class="text-sm {$message.type === 'error' ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-300'}">{$message.text}</p>
    {/if}
  </LiveOutcome>
  {#if createOpen && create}{@render create()}{/if}
</section>
<form method="POST" action="?/attachMemory" use:enhance class="hidden">
  <input type="hidden" name="_kind" value="attachAppMemory" />
  <input type="hidden" name="memoryId" value={$form.memoryId} />
</form>
<form method="POST" action="?/detachMemory" use:detachEnhance class="hidden">
  <input type="hidden" name="_kind" value="detachAppMemory" />
  <input type="hidden" name="memoryId" value={$detachValues.memoryId} />
</form>
{#if detaching}
  <AppMemoryDetachDialog memory={detaching} pending={$detachSubmitting} onconfirm={detach} oncancel={() => { detaching = null; }} />
{/if}
<form method="POST" action="?/createOwnMemory" use:ownEnhance class="hidden">
  <input type="hidden" name="_kind" value="createOwnAppMemory" />
  <input type="hidden" name="memoryClass" value={$ownValues.memoryClass} />
  <input type="hidden" name="agentId" value={$ownValues.agentId} />
</form>
<AppMemoryAddDialog bind:open={chooserOpen} hasAgent={hasAgent && agentId !== null} {canCreate} {ownClasses} onown={createOwn} loading={loadingCandidates} onexisting={chooseExisting} onnew={chooseNew} />
<SelectMemory bind:open={pickerOpen} memories={candidates} onselect={attach} placeholder={t('app.memory.pick-placeholder', 'Search memories by name or URN...')} />