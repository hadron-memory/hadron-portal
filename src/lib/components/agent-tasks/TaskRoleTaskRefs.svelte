<!--
  portal#2245 — the role tasks a finished task followed, in the order stored
  (hrn:node:hadronmemory.com:specs:cor:agt:050:30). Read only. One row each:
  the node's name, its URN chip directly below (linked to the node page), and
  the revision it had at finish. A task with none renders nothing at all.

  Names and URNs are untrusted stored strings: rendered as text, with format
  characters neutralized.
-->
<script lang="ts">
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import { neutralizeFormatChars } from '$lib/agent-tasks/references';
  import { roleTaskLabel, type RoleTaskRef } from '$lib/agent-tasks/role-task-refs';

  let { refs, names }: { refs: RoleTaskRef[] | null | undefined; names?: Record<string, string> } = $props();
</script>

{#if refs?.length}
  <ol data-testid="task-role-task-refs" class="min-w-0 space-y-2" aria-label={t('app.tasks.role-tasks.title', 'Role tasks followed')}>
    {#each refs as ref, i (i)}
      <li class="min-w-0 text-xs">
        <div class="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span data-testid="role-task-name" class="min-w-0 font-medium text-zinc-800 [overflow-wrap:anywhere] dark:text-zinc-100">{neutralizeFormatChars(roleTaskLabel(ref, names))}</span>
          <span data-testid="role-task-revision" class="shrink-0 text-zinc-500 dark:text-zinc-400">{t('app.tasks.role-tasks.revision', 'rev {n} at finish', { n: ref.revision })}</span>
        </div>
        <span class="block min-w-0 max-w-full overflow-hidden"><Urn value={ref.urn} size={10} compact linked label={t('app.tasks.role-tasks.urn-label', 'role task {n}', { n: i + 1 })} /></span>
      </li>
    {/each}
  </ol>
{/if}
