<!--
  portal#1090 — the task page's action bar
  (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-writes §3, §4).

  - Buttons follow the task's STATE only (taskActions). Authority is never
    inferred: every non-impersonating participant sees them, and the server's
    typed refusal answers anyone who may not (hrn:node:hadronmemory.com:specs:cor:agt:050:09). One static line
    says where the right comes from.
  - Park is held pending a ruling: never offered.
  - Each action opens an inline panel under the bar (not a modal): focus moves
    to it, Escape closes it and returns focus to its toggle. Nothing updates
    optimistically: a success reloads the page's data and says what happened
    in a status line; a refusal stays next to the submit, with the values.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { enhance } from '$app/forms';
  import { invalidateAll } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import { partyName } from '$lib/agent-tasks/status';
  import {
    cancelConsequences,
    taskActionLabel,
    taskActions,
    type TaskAction,
    type WriteRefusal,
  } from '$lib/agent-tasks/actions';
  import type { AgentTaskDetail, WriteCandidates } from '$lib/agent-tasks/types';
  import PartyPicker from './PartyPicker.svelte';
  import WriteRefusalAlert from './WriteRefusal.svelte';

  let {
    task,
    canWrite,
    impersonating = null,
    candidates,
    openChildren,
    created = false,
  }: {
    task: AgentTaskDetail;
    canWrite: boolean;
    impersonating?: string | null;
    candidates: WriteCandidates;
    openChildren: { count: number; capped: boolean; unknown?: boolean };
    created?: boolean;
  } = $props();

  const actions = $derived(taskActions(task));
  let open = $state<TaskAction | null>(null);
  let submitting = $state(false);
  let refusal = $state<{ action: TaskAction; refusal: WriteRefusal; inPanel: boolean } | null>(null);
  let status = $state<string | null>(null);
  let values = $state<Record<string, string>>({});
  let assignee = $state('');

  const toggles: Partial<Record<TaskAction, HTMLButtonElement>> = {};
  let panelHeading = $state<HTMLElement | null>(null);
  let defaultButton = $state<HTMLButtonElement | null>(null);
  let statusLine = $state<HTMLElement | null>(null);
  let createdLine = $state<HTMLElement | null>(null);
  // Uma's P3-4 on #1135: "Task created." takes focus like every other result line.
  onMount(() => {
    if (created) createdLine?.focus();
  });

  async function openPanel(a: TaskAction) {
    open = a;
    refusal = null;
    status = null;
    assignee = '';
    values = {};
    await tick();
    // Cancel and Make ready focus their safe choice; Assign focuses its heading.
    (a === 'cancel' || a === 'ready' ? defaultButton : panelHeading)?.focus();
  }

  async function closePanel() {
    const was = open;
    open = null;
    await tick();
    if (was) toggles[was]?.focus();
  }

  function onPanelKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      void closePanel();
    }
  }

  function pickedName(v: string, other: string): string {
    if (v.startsWith('worker:')) return candidates.workers.find((w) => `worker:${w.id}` === v)?.name ?? '';
    if (v.startsWith('user:')) {
      const p = candidates.people.find((x) => `user:${x.id}` === v);
      return p?.name ?? p?.handle ?? '';
    }
    return other.trim();
  }

  function successText(a: TaskAction, fd: FormData): string {
    switch (a) {
      case 'ready':
        return t('app.tasks.write.done.ready', 'Made ready: it’s now queued.');
      case 'cancel':
        return t('app.tasks.write.done.cancel', 'Cancelled.');
      case 'assign':
      case 'reassign': {
        const who = pickedName(String(fd.get('assignee') ?? ''), String(fd.get('assigneeOther') ?? ''));
        return who ? t('app.tasks.write.done.assigned-to', 'Assigned to {who}.', { who }) : t('app.tasks.write.done.assigned', 'Assigned.');
      }
    }
  }

  /** A stale view: someone changed the task first. Reload, close the panel, keep the refusal in view. */
  const STALE = new Set(['TASK_ENDED', 'TASK_INVALID_TRANSITION']);

  function submitter(a: TaskAction) {
    return ({ formData }: { formData: FormData }) => {
      submitting = true;
      values = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        submitting = false;
        if (result.type === 'success') {
          const text = successText(a, formData);
          await invalidateAll();
          open = null;
          refusal = null;
          status = text;
          await tick();
          statusLine?.focus();
          return;
        }
        const r: WriteRefusal =
          result.type === 'failure' && result.data && typeof result.data === 'object' && 'refusal' in result.data
            ? (result.data.refusal as WriteRefusal)
            : { kind: 'uncertain' };
        if (r.kind === 'refused' && STALE.has(r.code)) {
          await invalidateAll();
          open = null;
          refusal = { action: a, refusal: r, inPanel: false };
          return;
        }
        refusal = { action: a, refusal: r, inPanel: true };
        if (r.kind === 'invalid' || (r.kind === 'refused' && r.code === 'TASK_ASSIGNEE_INVALID')) {
          await tick();
          document.getElementById('task-assignee')?.focus();
        }
      };
    };
  }

  const currentAssignee = $derived(task.assignee ? `${task.assignee.kind === 'WORKER' ? 'worker' : 'user'}:${task.assignee.id}` : null);
</script>

<!-- Escape closes an open panel and returns focus to its toggle. -->
<svelte:window onkeydown={(e) => { if (open) onPanelKey(e); }} />

{#snippet refusalFor(a: TaskAction, inPanel: boolean)}
  {#if refusal && refusal.action === a && refusal.inPanel === inPanel}
    <WriteRefusalAlert refusal={refusal.refusal} />
  {/if}
{/snippet}

<div class="mt-3 space-y-2">
  {#if created && !status}
    <p bind:this={createdLine} tabindex="-1" role="status" class="text-sm font-medium text-green-700 dark:text-green-300">{t('app.tasks.write.done.created', 'Task created.')}</p>
  {/if}
  {#if status}
    <p bind:this={statusLine} tabindex="-1" role="status" aria-live="polite" class="text-sm font-medium text-green-700 dark:text-green-300">{status}</p>
  {/if}

  <!-- Uma's P3-1 on #1135: a stale-view refusal (e.g. TASK_ENDED) renders here, outside the
       has-actions branch, so it stays in view when the reload ends the task's actions. -->
  {@render refusalFor(refusal?.action ?? 'cancel', false)}

  {#if !canWrite}
    <p class="text-sm text-zinc-500 dark:text-zinc-400" data-testid="task-actions-off">
      {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating ?? '—' })}
    </p>
  {:else if actions.length === 0}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.tasks.write.ended', 'An ended task can’t be changed.')}</p>
  {:else}
    <div class="flex flex-wrap items-center gap-2" data-testid="task-actions">
      {#each actions as a (a)}
        <button
          type="button"
          bind:this={toggles[a]}
          onclick={() => (open === a ? closePanel() : openPanel(a))}
          aria-expanded={open === a}
          aria-controls={open === a ? `task-panel-${a}` : undefined}
          class={a === 'cancel'
            ? 'rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950'
            : 'rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800'}
        >{taskActionLabel(a)}</button>
      {/each}
    </div>
    <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.write.who', 'You can change a task you own, or any task if you manage the App.')}</p>

    {#if open === 'assign' || open === 'reassign'}
      {@const reassigning = open === 'reassign'}
      <form
        id="task-panel-{open}"
        aria-labelledby="task-panel-{open}-title"
        method="POST"
        action="?/{open}"
        use:enhance={submitter(open)}
        class="w-full space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h3 id="task-panel-{open}-title" bind:this={panelHeading} tabindex="-1" class="text-sm font-semibold text-zinc-900 dark:text-white">
          {reassigning ? t('app.tasks.write.reassign.title', 'Reassign this task') : t('app.tasks.write.assign.title', 'Assign this task')}
        </h3>
        <PartyPicker
          name="assignee"
          id="task-assignee"
          label={t('app.tasks.write.assignee', 'Assignee')}
          bind:value={assignee}
          other={values.assigneeOther ?? ''}
          workers={candidates.workers}
          people={candidates.people}
          exclude={reassigning ? currentAssignee : null}
          required
        />
        <div>
          <input type="hidden" name="closeSessionWhenDoneWas" value={String(task.closeSessionWhenDone)} />
          <label class="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200">
            <input type="checkbox" name="closeSessionWhenDone" checked={task.closeSessionWhenDone} aria-describedby="close-session-help" class="mt-0.5" />
            {t('app.tasks.write.close-session', 'End the assignee’s session when the task finishes')}
          </label>
          <p id="close-session-help" class="ml-6 text-xs text-zinc-500 dark:text-zinc-400">
            {t('app.tasks.write.close-session.help', 'On: the assignee is asked to end its session when the task finishes or is cancelled. Off: its session stays open.')}
          </p>
        </div>
        <ul class="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
          {#if reassigning && task.status === 'STARTED' && task.assignee}
            <li>{t('app.tasks.write.reassign.started', 'It stays started. {who} can no longer move it.', { who: partyName(task.assignee) })}</li>
          {/if}
          {#if assignee.startsWith('worker:')}
            <li>{t('app.tasks.write.assign.worker', 'Assigning to a worker can also start its session through its host.')}</li>
          {/if}
          {#if task.status === 'BACKLOG'}
            <li>{t('app.tasks.write.assign.backlog', 'This moves it out of the backlog to pending.')}</li>
          {/if}
        </ul>
        {@render refusalFor(open, true)}
        <div class="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {submitting ? t('app.tasks.write.assigning', 'Assigning…') : reassigning ? t('app.tasks.write.reassign.submit', 'Reassign') : t('app.tasks.write.assign.submit', 'Assign')}
          </button>
          <button type="button" onclick={closePanel} class="text-sm text-zinc-600 hover:underline dark:text-zinc-300">{t('app.tasks.write.close', 'Cancel')}</button>
        </div>
      </form>
    {:else if open === 'ready'}
      <form
        id="task-panel-ready"
        aria-labelledby="task-panel-ready-title"
        method="POST"
        action="?/ready"
        use:enhance={submitter('ready')}
        class="w-full space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h3 id="task-panel-ready-title" bind:this={panelHeading} tabindex="-1" class="text-sm font-semibold text-zinc-900 dark:text-white">
          {t('app.tasks.write.ready.title', 'Make “{title}” ready?', { title: task.title })}
        </h3>
        <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.tasks.write.ready.body', 'It becomes pending and joins the queue, where Hadron can match it to a worker.')}</p>
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.write.ready.no-park', 'To put it back in the backlog, use the CLI or MCP for now.')}</p>
        {@render refusalFor('ready', true)}
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" bind:this={defaultButton} onclick={closePanel} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200">{t('app.tasks.write.ready.no', 'Not yet')}</button>
          <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {submitting ? t('app.tasks.write.readying', 'Making ready…') : t('app.tasks.write.ready.submit', 'Make ready')}
          </button>
        </div>
      </form>
    {:else if open === 'cancel'}
      <form
        id="task-panel-cancel"
        aria-labelledby="task-panel-cancel-title"
        method="POST"
        action="?/cancel"
        use:enhance={submitter('cancel')}
        class="w-full space-y-3 rounded-lg border border-red-200 bg-white p-4 dark:border-red-900 dark:bg-zinc-900"
      >
        <h3 id="task-panel-cancel-title" bind:this={panelHeading} tabindex="-1" class="text-sm font-semibold text-zinc-900 dark:text-white">
          {t('app.tasks.write.cancel.title', 'Cancel “{title}”?', { title: task.title })}
        </h3>
        <ul class="list-disc space-y-0.5 pl-5 text-sm text-zinc-700 dark:text-zinc-300" data-testid="cancel-consequences">
          {#each cancelConsequences(task, openChildren) as line (line)}<li>{line}</li>{/each}
        </ul>
        {@render refusalFor('cancel', true)}
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" bind:this={defaultButton} onclick={closePanel} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200">{t('app.tasks.write.cancel.keep', 'Keep task')}</button>
          <button type="submit" disabled={submitting} class="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50">
            {submitting ? t('app.tasks.write.cancelling', 'Cancelling…') : t('app.tasks.write.cancel.submit', 'Cancel task')}
          </button>
        </div>
      </form>
    {/if}
  {/if}
</div>
