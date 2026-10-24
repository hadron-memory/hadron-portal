<script lang="ts">
  import { enhance } from '$app/forms';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { formatPortalDate } from '$lib/format-portal-date';
  import { t } from '$lib/i18n/t';
  import type { ActionData, PageData } from './$types';

  // #1159 — a retained, soft-deleted node: clearly marked, read-only, with Restore.
  let { data, form }: { data: PageData; form: ActionData } = $props();
  const node = $derived(data.node);
  const basePath = $derived(`/app/memories/${node.memoryId}`);
  let restoring = $state(false);
</script>

<svelte:head><title>{node.name} &middot; {t('node.deleted.badge', 'Deleted')} &middot; Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: 'Memories', href: '/app/memories' },
    { label: t('node.deleted.nodes-crumb', 'Nodes'), href: `${basePath}/nodes` },
    { label: node.name },
  ]} />

  <div class="flex flex-wrap items-center gap-3">
    <h1 class="text-xl font-semibold text-zinc-900 dark:text-white">{node.name}</h1>
    <span class="rounded-full border border-red-300 bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{t('node.deleted.badge', 'Deleted')}</span>
  </div>

  <Urn value={node.urn} type="node" />

  <p class="text-sm text-zinc-600 dark:text-zinc-400">
    {t('node.deleted.explainer', 'This node was deleted on {when}. It is kept and can be restored; descendants and revision history are not restored with it.', { when: formatPortalDate(node.deletedAt) })}
  </p>

  <form
    method="POST"
    action="?/restore"
    use:enhance={() => {
      restoring = true;
      return async ({ update }) => {
        await update();
        restoring = false;
      };
    }}
    class="flex items-center gap-3"
  >
    <button
      type="submit"
      disabled={restoring}
      class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
    >{restoring ? t('node.deleted.restoring', 'Restoring...') : t('node.deleted.restore', 'Restore node')}</button>
    <a href="{basePath}/nodes" class="text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">{t('node.deleted.back', 'Back to nodes')}</a>
  </form>
  {#if form?.error}
    <p role="alert" class="text-sm text-red-500">{form.error}</p>
  {/if}

  {#if node.description}
    <p class="text-sm text-zinc-700 dark:text-zinc-300">{node.description}</p>
  {/if}
  {#if node.content}
    <pre class="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">{node.content}</pre>
  {/if}
</div>
