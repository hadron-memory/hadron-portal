<!--
  portal#1090 — the task page's action bar
  (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-writes §3, §4).

  - Buttons follow the task's STATE only (taskActions). Authority is never
    inferred: every non-impersonating participant sees them, and the server's
    typed refusal answers anyone who may not (hrn:node:hadronmemory.com:specs:cor:agt:050:09). One static line
    says where the right comes from.
  - Park (portal#1143) is offered for a PENDING task with no assignee only.
  - Each action opens an inline panel under the bar (not a modal): focus moves
    to it, Escape closes it and returns focus to its toggle. Nothing updates
    optimistically: a success reloads the page's data and says what happened
    in a status line; a refusal stays next to the submit, with the values.
-->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { onMount, tick, untrack } from 'svelte';
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
  import TaskEditFields from './TaskEditFields.svelte';
  import WriteRefusalAlert from './WriteRefusal.svelte';
  import TaskWarnings from './TaskWarnings.svelte';
  import { HAND_BACK_CODES } from '$lib/agent-tasks/hand-back';
  import { warningsBelow, type TaskWarning } from '$lib/agent-tasks/warnings';
  import type { MemoriesRead } from '$lib/node-choices';
  import type { PickersOk, PickersRead } from '$lib/agent-tasks/sections';

  let {
    task,
    canWrite,
    impersonating = null,
    loadPickers,
    openChildren,
    created = false,
    viewerId = null,
    appUrn = null,
    loadMemories,
    cloneHref = null,
  }: {
    task: AgentTaskDetail;
    canWrite: boolean;
    impersonating?: string | null;
    /**
     * portal#2261: reads the assignee and requirement pickers' options. Called when an Assign, Reassign or
     * Edit details panel first opens (never at page load); a failed read is a value, shown as a failure
     * with a retry, never as an empty list.
     */
    loadPickers: () => Promise<PickersRead>;
    openChildren: { count: number; capped: boolean; unknown?: boolean };
    created?: boolean;
    /** portal#1571: the signed-in user's id; Hand back is offered only to the started task's own assignee. */
    viewerId?: string | null;
    /** portal#1575: the App's server-supplied URN, for a picked TASK reference in Edit details. */
    appUrn?: string | null;
    /** portal#2261: reads the NODE reference picker's memories when that picker opens (portal#1576 step 2). A failed read is a VALUE ({kind:'failed'}), never a rejection (#1588 QA F2). */
    loadMemories: () => Promise<MemoriesRead>;
    /**
     * portal#2161: the Clone link's destination (the New task form pre-filled from this task), or
     * null to hide it. Unlike every other control here, Clone is a CREATE, not a change to this
     * task: it is offered on every status, ended ones included (replacing an ended task is what the
     * action is for, hrn:node:hadronmemory.com:specs:cor:agt:050:02). AT0 shows none — the page passes no href for it.
     */
    cloneHref?: string | null;
  } = $props();

  const actions = $derived(taskActions(task, viewerId));
  let open = $state<TaskAction | null>(null);
  let submitting = $state(false);
  let refusalState = $state<{ taskId: string; action: TaskAction; refusal: WriteRefusal; inPanel: boolean } | null>(null);
  // Tagged with its task like `status`: the page reuses this bar across tasks, so a refusal shows only while
  // the task it was about is in view (Gabriel's P2 on #1466).
  const refusal = $derived(refusalState && refusalState.taskId === task.id ? refusalState : null);
  /**
   * The last successful write's result line and, portal#1214, the warnings its
   * response carried. Tagged with the task it was about: the page reuses this
   * bar across tasks, so a result shows only while that task is the one in view
   * (Gene's P2 on #1216), and survives the same task's own reload.
   */
  let status = $state<{ taskId: string; text: string; caution: boolean; warnings: TaskWarning[]; more: number } | null>(null);
  const shown = $derived(status && status.taskId === task.id ? status : null);
  let values = $state<Record<string, string>>({});
  let assignee = $state('');

  // portal#1357 (Edit details), portal#1571 (Hand back): an open panel's draft belongs to the
  // task it was opened on. The page reuses this bar across tasks, so moving to another one closes
  // it, and a draft never posts to a task it wasn't written for.
  let panelTaskId = untrack(() => task.id);
  $effect(() => {
    const id = task.id;
    untrack(() => {
      if (id !== panelTaskId) {
        panelTaskId = id;
        if (open === 'edit' || open === 'handBack') open = null;
      }
    });
  });
  // portal#1571: a hand-back draft also belongs to the eligibility it was opened under. If the task stops being
  // one this viewer can hand back (PENDING, reassigned away, ended), the panel closes so the draft can't post.
  $effect(() => {
    if (!actions.includes('handBack')) {
      untrack(() => {
        if (open === 'handBack') open = null;
      });
    }
  });
  const editInvalid = $derived(refusal && refusal.action === 'edit' && refusal.refusal.kind === 'invalid' ? refusal.refusal : null);

  const toggles: Partial<Record<TaskAction, HTMLButtonElement>> = {};
  let panelHeading = $state<HTMLElement | null>(null);
  let defaultButton = $state<HTMLButtonElement | null>(null);
  let statusLine = $state<HTMLElement | null>(null);
  let createdLine = $state<HTMLElement | null>(null);
  // Uma's P3-4 on #1135: "Task created." takes focus like every other result line.
  onMount(() => {
    if (created) createdLine?.focus();
  });

  // portal#2261: the pickers' options, read the first time a panel that needs them opens and kept for the
  // page visit. A failed read stays visible as a failure and is read again on the reader's Retry.
  const EMPTY_PICKERS: WriteCandidates = { workers: [], people: [], peopleWithheld: false, peopleFailed: false };
  let pickers = $state.raw<{ kind: 'idle' | 'loading' | 'failed' } | { kind: 'ok'; value: PickersOk }>({ kind: 'idle' });
  const candidates = $derived(pickers.kind === 'ok' ? pickers.value : EMPTY_PICKERS);
  const roles = $derived(pickers.kind === 'ok' ? pickers.value.roles : []);
  const families = $derived(pickers.kind === 'ok' ? pickers.value.families : []);
  // The page reuses this bar across tasks: another App's workers, people and roles never carry over.
  let pickersApp: string | null = null;
  $effect(() => {
    const app = task.appId;
    untrack(() => {
      const moved = pickersApp !== null && app !== pickersApp;
      pickersApp = app;
      if (moved) {
        pickers = { kind: 'idle' };
        // A panel that needs the options is still open on the new task: read them for this App now.
        if (open === 'assign' || open === 'reassign' || open === 'edit') void ensurePickers();
      }
    });
  });
  async function ensurePickers() {
    if (pickers.kind === 'ok' || pickers.kind === 'loading') return;
    pickers = { kind: 'loading' };
    const forApp = task.appId;
    const read = await loadPickers();
    // The reader moved to a task in another App while this read ran: its options are not theirs to see.
    if (task.appId !== forApp) return;
    pickers = read.kind === 'ok' ? { kind: 'ok', value: read.value } : { kind: 'failed' };
  }

  async function openPanel(a: TaskAction) {
    open = a;
    if (a === 'assign' || a === 'reassign' || a === 'edit') void ensurePickers();
    refusalState = null;
    status = null;
    assignee = '';
    values = {};
    await tick();
    // Cancel, Park and Make ready focus their safe choice; Assign focuses its heading.
    (a === 'cancel' || a === 'ready' || a === 'park' ? defaultButton : panelHeading)?.focus();
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

  function successText(a: TaskAction, fd: FormData, d: Record<string, unknown> = {}): string {
    switch (a) {
      case 'edit':
        return d.unchanged === true ? t('app.tasks.write.done.edit-unchanged', 'No changes to save.') : t('app.tasks.write.done.edit', 'Details saved.');
      case 'handBack':
        return t('app.tasks.write.done.hand-back', 'Handed back: it’s back in the queue.');
      case 'ready':
        return t('app.tasks.write.done.ready', 'Made ready: it’s now queued.');
      case 'park':
        return t('app.tasks.write.done.park', 'Parked: it’s back in the backlog.');
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
      const forTask = task.id;
      submitting = true;
      values = Object.fromEntries([...formData.entries()].map(([k, v]) => [k, String(v)]));
      return async ({ result }: { result: { type: string; data?: Record<string, unknown> } }) => {
        submitting = false;
        if (result.type === 'success') {
          const d = result.data ?? {};
          // A committed write whose response also errored: saved, said with a fixed line, never the error itself.
          const caution = d.committedWithError === true;
          const text = caution
            ? t('app.tasks.write.done.committed-error', 'Saved, but the server’s response also reported an error. Reload to check the task.')
            : successText(a, formData, d);
          const warnings = Array.isArray(d.warnings) ? (d.warnings as TaskWarning[]) : [];
          const more = typeof d.more === 'number' ? d.more : 0;
          await invalidateAll();
          // The reader moved to another task while this one was saving: its result isn't theirs to see.
          if (task.id !== forTask) return;
          open = null;
          refusalState = null;
          // Uma's P2 on #1216: the focused line says the warnings are there, so a screen reader hears it.
          const below = warningsBelow(warnings.length + more);
          status = { taskId: forTask, text: below ? `${text} ${below}` : text, caution, warnings, more };
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
          if (task.id !== forTask) return;
          open = null;
          refusalState = { taskId: forTask, action: a, refusal: r, inPanel: false };
          return;
        }
        if (task.id !== forTask) return;
        refusalState = { taskId: forTask, action: a, refusal: r, inPanel: true };
        if (a === 'edit' && r.kind === 'invalid') {
          await tick();
          document.getElementById(r.field === 'startBy' ? 'edit-start-by' : `edit-${r.field}`)?.focus();
        } else if (a === 'handBack' && r.kind === 'invalid') {
          await tick();
          document.getElementById(r.field === 'text' ? 'hand-back-text' : 'hand-back-code')?.focus();
        } else if (r.kind === 'invalid' || (r.kind === 'refused' && r.code === 'TASK_ASSIGNEE_INVALID')) {
          await tick();
          document.getElementById('task-assignee')?.focus();
        }
      };
    };
  }

  const currentAssignee = $derived(task.assignee ? `${task.assignee.kind === 'WORKER' ? 'worker' : 'user'}:${task.assignee.id}` : null);
</script>

{#snippet pickersWait()}
  {#if pickers.kind === 'failed'}
    <div role="alert" class="flex flex-wrap items-center gap-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
      <span>{t('app.tasks.write.pickers-failed', 'Couldn’t load the people and workers to choose from.')}</span>
      <button type="button" onclick={() => void ensurePickers()} class="underline">{t('app.tasks.write.pickers-retry', 'Try again')}</button>
    </div>
  {:else}
    <p role="status" class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.tasks.write.pickers-loading', 'Loading…')}</p>
  {/if}
{/snippet}

<!-- Escape closes an open panel and returns focus to its toggle. -->
<svelte:window onkeydown={(e) => { if (open) onPanelKey(e); }} />

{#snippet refusalFor(a: TaskAction, inPanel: boolean)}
  {#if refusal && refusal.action === a && refusal.inPanel === inPanel}
    <WriteRefusalAlert refusal={refusal.refusal} />
  {/if}
{/snippet}

<div class="mt-3 space-y-2">
  <LiveRegion>
    {#if created && !shown}
      <p bind:this={createdLine} tabindex="-1" class="text-sm font-medium text-green-700 dark:text-green-300">{t('app.tasks.write.done.created', 'Task created.')}</p>
    {/if}
  </LiveRegion>
  <LiveRegion>
    {#if shown}
      <p bind:this={statusLine} tabindex="-1" class="text-sm font-medium {shown.caution ? 'text-amber-800 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}">{shown.text}</p>
    {/if}
  </LiveRegion>
  {#if shown}
    <TaskWarnings warnings={shown.warnings} more={shown.more} />
  {/if}

  <!-- Uma's P3-1 on #1135: a stale-view refusal (e.g. TASK_ENDED) renders here, outside the
       has-actions branch, so it stays in view when the reload ends the task's actions. -->
  {@render refusalFor(refusal?.action ?? 'cancel', false)}

  <!-- portal#2161: the Clone link, rendered by both branches below — a create, not a change to
       this task, so it sits beside the state's actions (or the ended note) without being one of
       them, and never opens a panel here: it is a link to the pre-filled New task form. -->
  {#snippet cloneLink()}
    {#if cloneHref}
      <a href={cloneHref} data-testid="task-clone" class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">{t('app.tasks.write.clone', 'Clone')}</a>
    {/if}
  {/snippet}

  {#if !canWrite}
    <p class="text-sm text-zinc-500 dark:text-zinc-400" data-testid="task-actions-off">
      {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: impersonating ?? '—' })}
    </p>
  {:else if actions.length === 0}
    <!-- portal#2161: an ended task can't be changed, but it can still be cloned into a new one. -->
    <div class="flex flex-wrap items-center gap-3">
      <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.tasks.write.ended', 'An ended task can’t be changed.')}</p>
      {@render cloneLink()}
    </div>
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
      {@render cloneLink()}
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
        {#if pickers.kind !== 'ok'}{@render pickersWait()}{:else}
        <PartyPicker
          name="assignee"
          id="task-assignee"
          label={t('app.tasks.write.assignee', 'Assignee')}
          bind:value={assignee}
          other={values.assigneeOther ?? ''}
          workers={candidates.workers}
          people={candidates.people}
          peopleWithheld={candidates.peopleWithheld ?? false}
          peopleFailed={candidates.peopleFailed ?? false}
          exclude={reassigning ? currentAssignee : null}
          required
        />
        {/if}
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
          <button type="submit" disabled={submitting || pickers.kind !== 'ok'} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {submitting ? t('app.tasks.write.assigning', 'Assigning…') : reassigning ? t('app.tasks.write.reassign.submit', 'Reassign') : t('app.tasks.write.assign.submit', 'Assign')}
          </button>
          <button type="button" onclick={closePanel} class="text-sm text-zinc-600 hover:underline dark:text-zinc-300">{t('app.tasks.write.close', 'Cancel')}</button>
        </div>
      </form>
    {:else if open === 'handBack'}
      {@const invalid = refusal && refusal.action === 'handBack' && refusal.refusal.kind === 'invalid' ? refusal.refusal : null}
      <form
        id="task-panel-handBack"
        aria-labelledby="task-panel-handBack-title"
        method="POST"
        action="?/handBack"
        use:enhance={submitter('handBack')}
        class="w-full space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h3 id="task-panel-handBack-title" bind:this={panelHeading} tabindex="-1" class="text-sm font-semibold text-zinc-900 dark:text-white">
          {t('app.tasks.write.hand-back.title', 'Hand back “{title}”?', { title: task.title })}
        </h3>
        <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.tasks.write.hand-back.body', 'The task goes back to the queue with no assignee, and your reason is shown on it.')}</p>
        <div>
          <label for="hand-back-code" class="block text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('app.tasks.write.hand-back.reason', 'Reason')}</label>
          <select
            id="hand-back-code"
            name="code"
            required
            value={values.code ?? ''}
            aria-invalid={invalid?.field === 'code' ? 'true' : undefined}
            class="mt-1 block w-full max-w-xs rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          >
            <option value="" disabled>{t('app.tasks.write.hand-back.choose', 'Choose a reason')}</option>
            {#each HAND_BACK_CODES as c (c.code)}<option value={c.code}>{c.label}</option>{/each}
          </select>
        </div>
        <div>
          <label for="hand-back-text" class="block text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('app.tasks.write.hand-back.text', 'More detail (optional)')}</label>
          <textarea
            id="hand-back-text"
            name="text"
            rows="3"
            value={values.text ?? ''}
            aria-invalid={invalid?.field === 'text' ? 'true' : undefined}
            class="mt-1 block w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-950 dark:text-white"
          ></textarea>
        </div>
        {#if invalid}<p role="alert" class="text-sm text-red-700 dark:text-red-300">{invalid.message}</p>{:else}{@render refusalFor('handBack', true)}{/if}
        <div class="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {submitting ? t('app.tasks.write.handing-back', 'Handing back…') : t('app.tasks.write.hand-back.submit', 'Hand back')}
          </button>
          <button type="button" onclick={closePanel} class="text-sm text-zinc-600 hover:underline dark:text-zinc-300">{t('app.tasks.write.close', 'Cancel')}</button>
        </div>
      </form>
    {:else if open === 'edit'}
      <form
        id="task-panel-edit"
        aria-labelledby="task-panel-edit-title"
        method="POST"
        action="?/edit"
        use:enhance={submitter('edit')}
        class="w-full space-y-4 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h3 id="task-panel-edit-title" bind:this={panelHeading} tabindex="-1" class="text-sm font-semibold text-zinc-900 dark:text-white">
          {t('app.tasks.write.edit.title', 'Edit details')}
        </h3>
        {#if pickers.kind !== 'ok'}{@render pickersWait()}{:else}
        <TaskEditFields {task} workers={candidates.workers} {roles} {families} invalid={editInvalid} {appUrn} {loadMemories} />
        {/if}
        {#if !editInvalid}{@render refusalFor('edit', true)}{/if}
        <div class="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={submitting || pickers.kind !== 'ok'} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {submitting ? t('app.tasks.write.saving', 'Saving…') : t('app.tasks.write.edit.submit', 'Save details')}
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
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.tasks.write.ready.no-park', 'Until someone is assigned, you can put it back in the backlog with Park.')}</p>
        {@render refusalFor('ready', true)}
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" bind:this={defaultButton} onclick={closePanel} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200">{t('app.tasks.write.ready.no', 'Not yet')}</button>
          <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {submitting ? t('app.tasks.write.readying', 'Making ready…') : t('app.tasks.write.ready.submit', 'Make ready')}
          </button>
        </div>
      </form>
    {:else if open === 'park'}
      <form
        id="task-panel-park"
        aria-labelledby="task-panel-park-title"
        method="POST"
        action="?/park"
        use:enhance={submitter('park')}
        class="w-full space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
      >
        <h3 id="task-panel-park-title" bind:this={panelHeading} tabindex="-1" class="text-sm font-semibold text-zinc-900 dark:text-white">
          {t('app.tasks.write.park.title', 'Park “{title}”?', { title: task.title })}
        </h3>
        <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.tasks.write.park.body', 'It goes back to the backlog and leaves the queue. You can make it ready again later.')}</p>
        {@render refusalFor('park', true)}
        <div class="flex flex-wrap items-center gap-3">
          <button type="button" bind:this={defaultButton} onclick={closePanel} class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 dark:border-zinc-700 dark:text-zinc-200">{t('app.tasks.write.park.no', 'Not yet')}</button>
          <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
            {submitting ? t('app.tasks.write.parking', 'Parking…') : t('app.tasks.write.park.submit', 'Park task')}
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
