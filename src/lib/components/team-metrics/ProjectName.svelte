<!-- portal#1856 — a server-named project. The No project bucket (AT0) is shown as the server names it, never blank. -->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import type { MetricsProject } from '$lib/team-metrics/types';
  let { project, appId }: { project: MetricsProject; appId: string } = $props();
</script>

<div class="min-w-0">
  {#if project.noProject}
    <div class="truncate font-medium text-zinc-900 dark:text-white" data-testid="metrics-no-project">{t('team-metrics.project.none', 'No project')}</div>
  {:else}
    <div class="truncate">
      {#if project.taskId}
        <a href={`/app/apps/${appId}/tasks/${project.taskId}`} class="font-medium text-indigo-700 hover:underline dark:text-indigo-300">{project.title ?? project.handle}</a>
      {:else}
        <span class="font-medium text-zinc-900 dark:text-white">{project.title ?? project.handle}</span>
      {/if}
    </div>
    {#if project.title}<div class="mt-0.5 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{project.handle}</div>{/if}
  {/if}
</div>
