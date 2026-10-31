<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { t } from '$lib/i18n/t';
  import Urn from './Urn.svelte';
  import DataTable from './table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { TextDraft } from '$lib/text-draft.svelte';
  import { postSourceSave } from '$lib/json-draft.svelte';
  import {
    customisationKey,
    type CustomisationRead,
    type InstallNode,
  } from '$lib/install-customisation';
  let {
    appRef,
    agent,
    canManage,
    onClose,
  }: {
    appRef: string;
    agent: { id: string; name: string; urn?: string | null };
    canManage: boolean | null;
    onClose?: () => void;
  } = $props();
  let read = $state<CustomisationRead>({
    list: { state: 'loading' },
    replacement: { state: 'not-shown' },
    original: { state: 'not-shown' },
  });
  let loc = $state<string | null>(null);
  let offset = $state(0);
  let creating = $state(false);
  let newLoc = $state('');
  let name = $state('');
  let busy = $state(false);
  let feedback = $state('');
  let failed = $state(false);
  const draft = new TextDraft();
  let baseContent = $state('');
  let sequence = 0;
  let pendingSave = 0;
  let alive = true;
  let heading = $state<HTMLHeadingElement>();
  const secondaryButton =
    'inline-flex items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-100 disabled:text-zinc-400 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700 dark:disabled:border-zinc-800 dark:disabled:bg-zinc-900 dark:disabled:text-zinc-600';
  const unsaved = $derived(
    ((creating ||
      (loc !== null &&
        read.replacement.state === 'ok' &&
        typeof read.replacement.value.content === 'string')) &&
      draft.dirty) ||
      (creating && (newLoc !== '' || name !== '')),
  );
  function mayDiscard() {
    return (
      !busy &&
      (!unsaved ||
        window.confirm(
          t(
            'customisation.discard-confirm',
            'Discard unsaved customisation changes?',
          ),
        ))
    );
  }
  function openPage(nextOffset: number, nextLoc: string | null) {
    if (!mayDiscard()) return;
    feedback = '';
    void load(nextOffset, nextLoc, true);
  }
  function close() {
    if (mayDiscard()) onClose?.();
  }

  const rows = $derived(read.list.state === 'ok' ? read.list.value.nodes : []);
  const columns: PortalColumnDef<
    Pick<InstallNode, 'id' | 'urn' | 'loc' | 'name'>
  >[] = [
    {
      id: 'name',
      accessorFn: (row) => `${row.name} ${row.loc} ${row.urn ?? ''}`,
      header: t('customisation.column.name-loc', 'Name and loc'),
      enableHiding: false,
      size: 240,
    },
  ];
  const table = createSvelteTable({
    get data() {
      return rows;
    },
    columns,
  });
  async function load(nextOffset = offset, nextLoc = loc, discard = false) {
    pendingSave++;
    busy = false;
    const serial = ++sequence;
    const key = customisationKey(appRef, agent.id, nextLoc);
    const url = `/app/apps/${encodeURIComponent(appRef)}/customisation?agent=${encodeURIComponent(agent.id)}&offset=${nextOffset}${nextLoc ? `&loc=${encodeURIComponent(nextLoc)}` : ''}`;
    loc = nextLoc;
    offset = nextOffset;
    creating = false;
    read = {
      ...read,
      list: { state: 'loading' },
      replacement: { state: 'loading' },
      original: { state: 'loading' },
    };
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('read failed');
      const result = (await response.json()) as CustomisationRead;
      if (
        !alive ||
        serial !== sequence ||
        key !== customisationKey(appRef, agent.id, loc)
      )
        return;
      read = result;
      if (
        result.replacement.state === 'ok' &&
        typeof result.replacement.value.content === 'string'
      ) {
        const node = result.replacement.value;
        const source = {
          id: customisationKey(appRef, agent.id, node.loc),
          value: node.content,
          revision: node.revision,
        };
        if (discard) draft.reseed(source);
        else draft.sync(source);
        draft.ensureSeeded();
        // Keep the baseline paired with the draft, even when fresh data changed beneath it.
        if (!draft.isBehind(node.content)) baseContent = node.content ?? '';
      }
    } catch {
      if (alive && serial === sequence)
        read = {
          list: { state: 'failed' },
          replacement: { state: 'failed' },
          original: { state: 'failed' },
        };
    }
  }
  export function reveal() {
    if (!alive || !heading?.isConnected) return;
    heading.focus();
    heading.scrollIntoView?.({ block: 'nearest' });
  }
  onMount(() => {
    void load();
    reveal();
  });
  onDestroy(() => {
    alive = false;
    sequence++;
  });
  function start() {
    if (!mayDiscard()) return;
    sequence++;
    pendingSave++;
    busy = false;
    loc = null;
    creating = true;
    feedback = '';
    failed = false;
    newLoc = '';
    name = '';
    draft.reseed({
      id: customisationKey(appRef, agent.id, null),
      value: '',
      revision: null,
    });
    draft.ensureSeeded();
  }
  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (busy) return;
    const key = customisationKey(appRef, agent.id, loc);
    const serial = sequence;
    const selectedLoc = creating ? newLoc : loc;
    const first = creating;
    if (!selectedLoc) return;
    const fd = new FormData();
    fd.set('agentRef', agent.id);
    fd.set('loc', selectedLoc);
    fd.set('content', draft.text);
    if (first) fd.set('name', name);
    else {
      fd.set('baseContent', baseContent);
      fd.set('expectedRevision', String(draft.baseRevision ?? ''));
    }
    const url = `/app/apps/${encodeURIComponent(appRef)}?/${first ? 'createCustomisation' : 'saveCustomisation'}`;
    const write = ++pendingSave;
    busy = true;
    feedback = '';
    try {
      const result = await postSourceSave({
        url,
        body: fd,
        field: 'customisation',
      });
      if (
        !alive ||
        serial !== sequence ||
        key !== customisationKey(appRef, agent.id, loc)
      )
        return;
      failed = !result.ok;
      feedback = result.ok
        ? t('customisation.saved', 'Saved.')
        : (result.detail ??
          t(
            'customisation.failed-save',
            'The customisation could not be saved. Your draft is kept.',
          ));
      if (result.ok) await load(offset, selectedLoc, true);
    } catch {
      if (alive && serial === sequence) {
        failed = true;
        feedback = t(
          'customisation.failed-save',
          'The customisation could not be saved. Your draft is kept.',
        );
      }
    } finally {
      if (alive && write === pendingSave) busy = false;
    }
  }
</script>
<section aria-label={t('customisation.title','Customisation')} class="mt-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
  <div class="flex items-start justify-between gap-3">
  <h3 bind:this={heading} tabindex="-1" class="min-w-0 text-lg font-semibold text-zinc-900 dark:text-white">{t('customisation.title-for','Customisation for {name}',{name:agent.name})}</h3>
  {#if onClose}<button type="button" class={secondaryButton} disabled={busy} onclick={close}>{t('customisation.close','Close')}</button>{/if}
  </div>
  {#if agent.urn}<div class="mt-1"><Urn value={agent.urn} compact /></div>{/if}
  <p class="mt-3 text-sm text-zinc-500">{t('customisation.not-served','Customisations are recorded but not used to start agents yet.')}</p>
  <p class="text-sm text-zinc-500">{t('customisation.compile-only','Replacements apply when compiling for this App. Ordinary node reads are unchanged.')}</p>
  {#if read.list.state==='loading'}<p role="status">{t('customisation.loading','Loading…')}</p>
  {:else if read.list.state==='failed'}<p role="alert">{t('customisation.load-failed','Couldn’t load customisations.')}</p><button type="button" class={secondaryButton} disabled={busy} onclick={()=>openPage(offset,loc)}>{t('customisation.retry','Retry')}</button>
  {:else if read.list.state==='not-shown'}<p>{t('customisation.not-shown','Not shown')}</p>
  {:else if read.list.value.nodes.length===0}
    <!-- portal#1524 (Xan's condition): the server may answer this list with an
         EMPTY page while its node-list flag is on (hadron-server#2990), and an
         empty page cannot say "no customisations exist". So an empty page is a
         note, never an empty table or a count of 0, and this holds whether or
         not the flag is on. -->
    {#if read.list.value.urn}<div class="mt-2"><Urn value={read.list.value.urn} compact /></div>{/if}
    <p role="status" data-testid="customisation-list-unavailable" class="mt-2 text-sm text-zinc-500">{t('customisation.list-unavailable','Nothing is listed here. The node list is temporarily limited, so this may not be the full set.')}</p>
  {:else}
    {#if read.list.value.urn}<div class="mt-2"><Urn value={read.list.value.urn} compact /></div>{/if}
    <DataTable {table} searchPlaceholder={t('customisation.search','Search customisations…')} searchAriaLabel={t('customisation.search-label','Search customisations')} listKey={`install-customisation:${appRef}:${agent.id}`}>
      {#snippet cell(cell)}
        <div class="min-w-0 whitespace-normal break-words font-medium">{cell.row.original.name}</div>
        <div class="mt-1 whitespace-normal break-all font-mono text-xs text-zinc-500">{cell.row.original.loc}</div>
        {#if cell.row.original.urn}<div class="mt-1 min-w-0"><Urn value={cell.row.original.urn} compact /></div>{/if}
        <button type="button" class={`mt-2 ${secondaryButton}`} disabled={busy} onclick={()=>openPage(offset,cell.row.original.loc)}>{t('customisation.open','Open')}</button>
      {/snippet}
    </DataTable>
    <div class="mt-2 flex flex-wrap gap-3"><button type="button" class={secondaryButton} disabled={busy||offset===0} title={offset===0?t('customisation.first-page','Already on the first page'):undefined} onclick={()=>openPage(Math.max(0,offset-20),null)}>{t('customisation.previous','Previous')}</button><button type="button" class={secondaryButton} disabled={busy||offset+20>=read.list.value.total} title={offset+20>=read.list.value.total?t('customisation.last-page','No more customisations'):undefined} onclick={()=>openPage(offset+20,null)}>{t('customisation.next','Next')}</button><span>{t('customisation.total','{total} customisations',{total:String(read.list.value.total)})}</span></div>
  {/if}
  {#if canManage!==false}<button type="button" class={`mt-3 ${secondaryButton}`} disabled={busy} onclick={start}>{t('customisation.start','Start customising')}</button>{/if}
  {#if loc||creating}
    <div class="mt-4 grid gap-4 md:grid-cols-2">
      <div class="min-w-0"><h4 class="font-semibold text-zinc-900 dark:text-zinc-100">{t('customisation.original','Original')}</h4>
      {#if read.original.state==='ok'&&typeof read.original.value.content==='string'&&!creating}<pre class="mt-2 whitespace-pre-wrap break-words text-sm">{read.original.value.content}</pre>
      {:else if read.original.state==='loading'&&!creating}<p role="status">{t('customisation.loading','Loading…')}</p>
      {:else if read.original.state==='failed'&&!creating}<p role="alert">{t('customisation.original-failed','Couldn’t load the original.')}</p>
      {:else}<p class="text-sm text-zinc-500">{t('customisation.original-hidden','Original not shown')}</p>{#if loc&&!loc.startsWith('boot:')&&loc!=='boot'}<p class="text-sm text-zinc-500">{t('customisation.base-hint','An inherited base may hold this loc, or your access may not show it.')}</p>{/if}{/if}</div>
      <div class="min-w-0"><h4 class="font-semibold text-zinc-900 dark:text-zinc-100">{t('customisation.replacement','Replacement')}</h4>
        {#if creating||(read.replacement.state==='ok'&&typeof read.replacement.value.content==='string')}
          {#if canManage!==false}
          <form method="POST" action={`?/`+(creating?'createCustomisation':'saveCustomisation')} onsubmit={save}>
            {#if creating}<label class="block text-sm">{t('customisation.loc-label','Loc (bare address)')}<input required bind:value={newLoc} class="block w-full rounded border p-2 dark:bg-zinc-900" /></label><label class="block text-sm">{t('customisation.name-label','Name')}<input required bind:value={name} class="block w-full rounded border p-2 dark:bg-zinc-900" /></label>{/if}
            <label class="block text-sm">{t('customisation.content-label','Content')}<textarea aria-label={t('customisation.content-label','Content')} bind:value={draft.text} rows="10" class="block w-full rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-900"></textarea></label>
            {#if canManage===null}<p class="text-sm text-zinc-500">{t('customisation.may-refuse','This change may be refused. The server checks your access when you save.')}</p>{/if}
            <button type="submit" disabled={busy||(!creating&&!draft.dirty)} class="mt-2 rounded bg-indigo-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">{busy?t('customisation.saving','Saving…'):t('customisation.save','Save')}</button>
          </form>
          {:else}<pre class="whitespace-pre-wrap break-words text-sm">{draft.text}</pre>{/if}
        {:else if read.replacement.state==='loading'}<p role="status">{t('customisation.loading','Loading…')}</p>
        {:else if read.replacement.state==='failed'}<p role="alert">{t('customisation.node-failed','Couldn’t load this replacement.')}</p>
        {:else}<p>{t('customisation.not-shown','Not shown')}</p>{/if}
        <button type="button" disabled={busy} onclick={()=>openPage(offset,loc)} class={`mt-2 ${secondaryButton}`}>{t('customisation.reload-discard','Reload and discard draft')}</button>
        {#if feedback}<p role={failed?'alert':'status'} class="mt-2 text-sm">{feedback}</p>{/if}
      </div>
    </div>
  {/if}
</section>
