<script lang="ts">
  // #529: read-only snapshot view (opened in a new tab from the History tab).
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  const v = $derived(data.version);
  const nodeHref = $derived(`/app/memories/${data.memoryId}/nodes/${data.nodeId}`);
</script>

<svelte:head><title>{t('node-version.title', 'Version')}: {v.name}</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-4 p-4">
  <div>
    <a href={nodeHref} class="text-xs text-indigo-600 hover:underline dark:text-indigo-300">← {t('node-version.back', 'Back to node')}</a>
    <div class="mt-1 inline-flex items-center gap-2 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {t('node-version.badge', 'Historical version — read-only')}
    </div>
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">{v.name}</h1>
    <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
      {t('node-version.saved', 'Saved')} {new Date(v.createdAt).toLocaleString()}
      {#if v.editedByUser?.handle}
        · {t('node-version.by', 'by')} @{v.editedByUser.handle}
      {:else if v.editedBy}
        · {t('node-version.by', 'by')} {v.editedBy}
      {/if}
    </p>
    <p class="mt-1 font-mono text-xs text-zinc-400">{v.loc}</p>
  </div>

  {#if v.description}
    <p class="text-sm text-zinc-600 dark:text-zinc-400">{v.description}</p>
  {/if}

  {#if v.tags.length > 0}
    <div class="flex flex-wrap gap-1">
      {#each v.tags as tag}
        <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">{tag}</span>
      {/each}
    </div>
  {/if}

  {#if v.editedByUser?.urn}
    <div class="text-xs"><Urn value={v.editedByUser.urn} type="user" size={10} /></div>
  {/if}

  <div>
    <h2 class="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('node-version.content', 'Content')}</h2>
    {#if v.content}
      <pre class="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-300">{v.content}</pre>
    {:else}
      <p class="text-sm text-zinc-400">{t('node-version.no-content', '(no content at this version)')}</p>
    {/if}
  </div>
</div>
