<script lang="ts">
  // #529: read-only snapshot view (opened in a new tab from the History tab).
  import Urn from '$lib/components/Urn.svelte';
  import NodeProvenanceRows from '$lib/components/NodeProvenanceRows.svelte';
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

  <div>
    <h2 class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('node-revision.content', 'Content')}</h2>
    {#if r.content}
      <pre class="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{r.content}</pre>
    {:else}
      <p class="text-sm text-zinc-400">{t('node-revision.no-content', '(no content at this revision)')}</p>
    {/if}
  </div>
</div>
