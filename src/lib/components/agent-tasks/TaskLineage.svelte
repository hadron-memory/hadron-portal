<script lang="ts">
  import { taskHref } from '$lib/agent-tasks/handle';
  import { t } from '$lib/i18n/t';

  /**
   * portal#2161 (hrn:node:hadronmemory.com:specs:cor:agt:050:02, hadron-server#3244): where this task came from. The link reads
   * "Replaces <handle title>" when the source has ended (finished or cancelled — replacing an
   * ended task is what a clone is for) and "Cloned from <handle title>" otherwise. A null
   * `clonedFrom` (not a clone, or a source this caller can't read) renders NOTHING — no
   * placeholder, because the server gives no existence oracle (hrn:node:hadronmemory.com:specs:cor:acl:110:02).
   */
  let {
    clonedFrom,
    basePath,
  }: {
    clonedFrom: { id: string; handle: string; title: string; status: string } | null;
    basePath: string;
  } = $props();

  const replaces = $derived(clonedFrom?.status === 'FINISHED' || clonedFrom?.status === 'CANCELLED');
</script>

{#if clonedFrom}
  <dt class="sr-only">{t('app.tasks.fact.lineage', 'Lineage')}</dt>
  <dd class="min-w-0" data-testid="task-lineage">
    <a href={taskHref(basePath, clonedFrom)} class="text-indigo-600 hover:underline dark:text-indigo-300">
      {#if replaces}
        {t('app.tasks.lineage.replaces', 'Replaces {handle} {title}', { handle: clonedFrom.handle, title: clonedFrom.title })}
      {:else}
        {t('app.tasks.lineage.cloned-from', 'Cloned from {handle} {title}', { handle: clonedFrom.handle, title: clonedFrom.title })}
      {/if}
    </a>
  </dd>
{/if}
