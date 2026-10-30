<!--
  portal#1349 — a reference to one task from a view that carries only its bare
  id (the Roster's Detail cell, the Alarms list): the title as the link, the
  immutable handle as a quiet chip beside it, the link pointing at the handle
  under the current App.

  An unavailable reference (missing, unreadable, another App's, or the read
  failed) is neutral text with no link: not a stale title, not the raw id, and
  not a fallback to some other task.
-->
<script lang="ts">
  import { taskHref } from '$lib/agent-tasks/handle';
  import { taskRefLabel } from '$lib/agent-tasks/roster';
  import type { TaskRefs } from '$lib/agent-tasks/types';
  import TaskHandle from './TaskHandle.svelte';

  let { id, refs, basePath }: { id: string; refs: TaskRefs; basePath: string } = $props();
  const ref = $derived(refs[id] ?? null);
</script>

{#if ref}
  <span class="inline-flex min-w-0 max-w-full items-center gap-1.5">
    <a href={taskHref(basePath, ref)} class="min-w-0 truncate text-indigo-600 hover:underline dark:text-indigo-300">{taskRefLabel(id, refs)}</a>
    <TaskHandle handle={ref.handle} />
  </span>
{:else}
  <span class="text-zinc-500">{taskRefLabel(id, refs)}</span>
{/if}
