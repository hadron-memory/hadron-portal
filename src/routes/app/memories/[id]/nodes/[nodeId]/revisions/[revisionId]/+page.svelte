<script lang="ts">
  // #529: read-only snapshot view (opened in a new tab from the History tab).
  import Urn from '$lib/components/Urn.svelte';
  import NodeProvenanceRows from '$lib/components/NodeProvenanceRows.svelte';
  import RevisionEditedBy from '$lib/components/RevisionEditedBy.svelte';
  import { revisionEditorView } from '$lib/revision-editor';
  import type { NodeProvenance, ProvenanceResult } from '$lib/node-provenance';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const r = $derived(data.revision);
  const nodeHref = $derived(`/app/memories/${data.memoryId}/nodes/${data.nodeId}`);

  // #914: streamed; checked against the current promise so a late answer for
  // another revision can't land here.
  let provenance = $state<ProvenanceResult<NodeProvenance> | null>(null);
  $effect(() => {
    const p = data.provenance;
    provenance = null;
    p.then((res) => {
      if (data.provenance === p) provenance = res;
    });
  });

  // #1001: the edit that replaced this snapshot, streamed; checked against the
  // current promise like provenance above.
  let changes = $state<Awaited<PageData['changes']> | null>(null);
  $effect(() => {
    const p = data.changes;
    changes = null;
    p.then((res) => {
      if (data.changes === p) changes = res;
    });
  });
  const marks = { same: ' ', added: '+', removed: '−' } as const;
  const rowClass = {
    same: 'text-zinc-700 dark:text-zinc-300',
    added: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200',
    removed: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200',
  } as const;
</script>

<svelte:head><title>{t('node-revision.title', 'Revision')}: {r.name}</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-4 p-4">
  <div>
    <a href={nodeHref} class="text-xs text-indigo-600 hover:underline dark:text-indigo-300">← {t('node-revision.back', 'Back to node')}</a>
    <div class="mt-1 inline-flex items-center gap-2 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {t('node-revision.badge', 'Historical revision — read-only')}
    </div>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">{r.name}</h1>
    <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
      {t('node-revision.saved', 'Saved')} {new Date(r.createdAt).toLocaleString()}
      {#if r.editedByUser?.handle}
        · {t('node-revision.by', 'by')} @{r.editedByUser.handle}
      {:else if r.editedByInfo}
        · {t('node-revision.by', 'by')} {r.editedByInfo}
      {/if}
    </p>
    {#if r.revLabel}
      <p class="mt-1 text-sm italic text-zinc-600 dark:text-zinc-400">“{r.revLabel}”</p>
    {/if}
    <p class="mt-1 font-mono text-xs text-zinc-400">{r.loc}</p>
  </div>

  <!-- #914: what was recorded for THIS snapshot, not the node's current state. -->
  <div class="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
    <NodeProvenanceRows result={provenance} revision={r.revNo} />
  </div>

  {#if r.description}
    <p class="text-sm text-zinc-600 dark:text-zinc-400">{r.description}</p>
  {/if}

  {#if r.tags.length > 0}
    <div class="flex flex-wrap gap-1">
      {#each r.tags as tag}
        <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>
      {/each}
    </div>
  {/if}

  {#if r.editedByUser?.urn}
    <div class="text-xs"><Urn value={r.editedByUser.urn} type="user" size={10} /></div>
  {/if}
  <!-- #1171: the Worker and Agent behind this revision, when the server recorded them. -->
  <div class="text-xs"><RevisionEditedBy actorsOnly view={revisionEditorView(r)} /></div>

  <!-- #1001: a revision is the state BEFORE an edit, so this is what that edit changed. -->
  <div>
    <h2 class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('node-revision.changes', 'Changes')}</h2>
    {#if changes === null}
      <p class="text-sm text-zinc-400" role="status">{t('node-revision.changes.loading', 'Loading changes…')}</p>
    {:else if !changes.ok}
      <p class="text-sm text-zinc-500" role="status">{t('node-revision.changes.failed', 'Couldn’t load the changes.')}</p>
    {:else if changes.against === 'unknown'}
      <p class="text-sm text-zinc-500">{t('node-revision.changes.unknown', 'The edit that replaced this revision can’t be shown: the revisions between it and the next one aren’t all available.')}</p>
    {:else}
      <p class="mb-1 text-xs text-zinc-500">
        {changes.against === 'current'
          ? t('node-revision.changes.against-current', 'This revision compared with the current version.')
          : t('node-revision.changes.against-next', 'This revision compared with the next revision.')}
      </p>
      {#if changes.state === 'unavailable'}
        <p class="text-sm text-zinc-500">{t('node-revision.changes.unavailable', 'These revisions can’t be compared: one of them has no readable content (it is empty, encrypted or withheld).')}</p>
      {:else if changes.state === 'too-large'}
        <p class="text-sm text-zinc-500">{t('node-revision.changes.too-large', 'The content is too large to compare here.')}</p>
      {:else if changes.changed}
        <pre class="overflow-x-auto whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-950" aria-label={t('node-revision.changes.label', 'Content changes')}>{#each changes.lines as line}<span class="block px-4 {rowClass[line.kind]}"><span aria-hidden="true" class="select-none">{marks[line.kind]} </span><span class="sr-only">{line.kind === 'added' ? t('node-revision.changes.added', 'Added:') : line.kind === 'removed' ? t('node-revision.changes.removed', 'Removed:') : ''}</span>{line.text}</span>{/each}</pre>
      {:else}
        <p class="text-sm text-zinc-500">{t('node-revision.changes.none', 'The content didn’t change in this edit.')}</p>
      {/if}
    {/if}
  </div>

  <div>
    <h2 class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('node-revision.content', 'Content')}</h2>
    {#if r.content}
      <pre class="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{r.content}</pre>
    {:else}
      <p class="text-sm text-zinc-400">{t('node-revision.no-content', '(no content at this revision)')}</p>
    {/if}
  </div>
</div>
