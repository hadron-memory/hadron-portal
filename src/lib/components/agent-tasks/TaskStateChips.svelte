<!--
  portal#1052 — a task's state as chips (design §3): the status word, plus
  "Waiting on subtasks" as a second chip when it applies. Every chip carries
  its word; tone is a second cue only.
-->
<script lang="ts">
  import {
    WAITING_CHIP_CLASS,
    taskDisplayState,
    taskStateChipClass,
    taskStateLabel,
    waitingOnSubtasksLabel,
  } from '$lib/agent-tasks/status';
  import type { AgentTaskRow } from '$lib/agent-tasks/types';

  let { task }: { task: Pick<AgentTaskRow, 'status' | 'queued' | 'waitingOnChildren'> } = $props();
  const state = $derived(taskDisplayState(task));
</script>

<span class="inline-flex flex-wrap items-center gap-1">
  <span class={taskStateChipClass(state)} data-state={state}>{taskStateLabel(state, task.status)}</span>
  {#if task.waitingOnChildren && task.status === 'STARTED'}
    <span class={WAITING_CHIP_CLASS}>{waitingOnSubtasksLabel()}</span>
  {/if}
</span>
