<!--
  portal#1575 — set a task's typed references, on the new-task form and in
  Edit details (hadron-server#3112, hrn:node:hadronmemory.com:specs:cor:agt:050:09).

  Add a reference (choose a kind, enter or pick the target, an optional label),
  remove one, or move one up or down. The form posts ONE field, `references`,
  the whole ordered list as JSON; the add fields have no name and post nothing.
  How each kind is entered (Patrick's rulings on #1575):

  - ISSUE, PULL_REQUEST, URL: a text field. These targets are URLs by nature.
  - NODE: a URN text field, a narrow exception to "no free-text URN field"
    while no node picker exists (#1576). The client checks the `hrn:node:`
    shape and shows the chip under a valid value; the server stays the
    authority.
  - TASK: picked with SelectTask, never typed, ended tasks included. The
    target is built from the App's server-supplied URN and the handle.

  Seeded once: the list is a draft, so a refusal keeps it. A target typed or a
  task picked but not added blocks the submit with a message, rather than
  being dropped silently (the pick's message sits on the Label field, the one
  validatable control in that branch, where Enter adds). Switching kind to or
  from TASK clears the draft it hides, so no unseen draft is ever lost or
  posted. Enter in an add field adds; it never submits the outer form.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { t } from '$lib/i18n/t';
  import Urn from '$lib/components/Urn.svelte';
  import SelectTask from './SelectTask.svelte';
  import TaskHandle from './TaskHandle.svelte';
  import { taskReferenceTarget } from '$lib/agent-tasks/handle';
  import {
    MAX_LABEL_LENGTH,
    MAX_REFERENCES,
    MAX_TARGET_LENGTH,
    REFERENCE_KINDS,
    isNodeUrn,
    neutralizeFormatChars,
    referenceKindLabel,
    type ReferenceKind,
    type TaskReference,
  } from '$lib/agent-tasks/references';
  import type { TaskChoice } from '$lib/agent-tasks/types';

  let {
    app,
    initial = [],
    idPrefix,
    replaces = false,
    invalid = null,
  }: {
    /** The App the form is in. Without its URN a TASK target can't be built, so TASK isn't offered. */
    app: { id: string; urn: string | null };
    initial?: TaskReference[];
    /** `new` or `edit`: every id in here starts with it. */
    idPrefix: string;
    /** Edit details: say that saving replaces the whole list. */
    replaces?: boolean;
    /** The action's local refusal on this field (an unreadable post). */
    invalid?: string | null;
  } = $props();

  // Seeded once, on purpose: a draft, not a view.
  let list = $state<TaskReference[]>(untrack(() => initial.map((r) => ({ kind: r.kind, target: r.target, label: r.label ?? null }))));
  const kinds = $derived(REFERENCE_KINDS.filter((k) => k !== 'TASK' || !!app.urn));
  let kind = $state<ReferenceKind>('ISSUE');
  let target = $state('');
  let label = $state('');
  let picked = $state<TaskChoice | null>(null);
  let picking = $state(false);
  let targetEl = $state<HTMLInputElement | null>(null);
  let labelEl = $state<HTMLInputElement | null>(null);

  const full = $derived(list.length >= MAX_REFERENCES);
  const draftTarget = $derived(kind === 'TASK' ? (picked && app.urn ? (taskReferenceTarget(app.urn, picked.handle) ?? '') : '') : target.trim());
  const nodeError = $derived(
    kind === 'NODE' && target.trim() !== '' && !isNodeUrn(target.trim())
      ? t('app.tasks.ref.node-invalid', 'Enter a node URN that starts with hrn:node:.')
      : null,
  );
  const canAdd = $derived(!full && draftTarget !== '' && !nodeError);
  // A typed target or a picked task that isn't in the list yet must not be lost on submit: the browser refuses the form with this.
  const pending = $derived(
    kind !== 'TASK' && target.trim() !== ''
      ? (nodeError ?? t('app.tasks.ref.pending', 'Add this reference, or clear the field.'))
      : '',
  );
  const pendingTask = $derived(kind === 'TASK' && picked ? t('app.tasks.ref.pending-task', 'Add this reference, or clear the selection.') : '');
  $effect(() => {
    targetEl?.setCustomValidity(pending);
  });
  $effect(() => {
    labelEl?.setCustomValidity(pendingTask);
  });

  function setKind(next: ReferenceKind) {
    // The TASK branch and the text branch each hide the other's draft: clear it rather than keep an unseen one.
    if ((next === 'TASK') !== (kind === 'TASK')) {
      target = '';
      picked = null;
    }
    kind = next;
  }

  function add() {
    if (!canAdd) return;
    const l = label.trim();
    list = [...list, { kind, target: draftTarget, label: l ? l : null }];
    target = '';
    label = '';
    picked = null;
  }
  function remove(i: number) {
    list = list.filter((_, j) => j !== i);
  }
  function move(i: number, by: -1 | 1) {
    const j = i + by;
    if (j < 0 || j >= list.length) return;
    const next = [...list];
    [next[i], next[j]] = [next[j]!, next[i]!];
    list = next;
  }
  function onKey(e: KeyboardEvent) {
    // Enter in a text field here (or in the task picker) must never submit the outer form.
    if (e.key !== 'Enter' || !(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    if (e.target === targetEl || e.target === labelEl) add();
  }

  const targetLabel = $derived(
    kind === 'NODE'
      ? t('app.tasks.ref.target.node', 'Node URN')
      : kind === 'ISSUE'
        ? t('app.tasks.ref.target.issue', 'Issue URL')
        : kind === 'PULL_REQUEST'
          ? t('app.tasks.ref.target.pull-request', 'Pull request URL')
          : t('app.tasks.ref.target.url', 'URL'),
  );
  const targetHelp = $derived(
    kind === 'NODE'
      ? t('app.tasks.ref.target.node-help', 'Paste the node’s URN (hrn:node:…). The URN chip on a node’s page copies it.')
      : t('app.tasks.ref.target.url-help', 'The full address, starting with https://.'),
  );

  const inputClass =
    'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'block text-sm font-medium text-zinc-800 dark:text-zinc-200';
  const helpClass = 'text-xs text-zinc-500 dark:text-zinc-400';
  const smallButton =
    'rounded border border-zinc-300 px-2 py-0.5 text-xs text-zinc-700 hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
  const p = $derived(idPrefix);
</script>

<input type="hidden" name="references" value={JSON.stringify(list)} />

<!-- The keydown listener only delegates the Enter guard for the inputs inside (and the task picker's); the
     fieldset takes focus (tabindex -1) only when a refusal on this field moves focus here. -->
<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<fieldset id="{p}-references" tabindex="-1" class="space-y-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800" onkeydown={onKey}>
  <legend class="px-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('app.tasks.ref.title', 'References')}</legend>
  <p class={helpClass}>
    {t('app.tasks.ref.help', 'Issues, pull requests, nodes, tasks or links this task points at, kept in this order.')}
    {#if replaces}{t('app.tasks.ref.replaces', 'Saving replaces the whole list as shown.')}{/if}
  </p>
  {#if invalid}<p role="alert" class="text-xs text-red-700 dark:text-red-300">{invalid}</p>{/if}

  {#if list.length}
    <ol data-testid="{p}-reference-list" class="space-y-1.5">
      {#each list as ref, i (i)}
        <li class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span class="shrink-0 font-medium text-zinc-600 dark:text-zinc-300">{referenceKindLabel(ref.kind)}</span>
          {#if ref.label}<span class="min-w-0 text-zinc-800 [overflow-wrap:anywhere] dark:text-zinc-100">{neutralizeFormatChars(ref.label)}</span>{/if}
          <span class="min-w-0 grow font-mono text-zinc-500 [overflow-wrap:anywhere] dark:text-zinc-400">{neutralizeFormatChars(ref.target)}</span>
          <span class="flex shrink-0 gap-1">
            <button type="button" class={smallButton} disabled={i === 0} onclick={() => move(i, -1)}
              aria-label={t('app.tasks.ref.up', 'Move reference {n} up', { n: i + 1 })}>{t('app.tasks.ref.up-short', 'Move up')}</button>
            <button type="button" class={smallButton} disabled={i === list.length - 1} onclick={() => move(i, 1)}
              aria-label={t('app.tasks.ref.down', 'Move reference {n} down', { n: i + 1 })}>{t('app.tasks.ref.down-short', 'Move down')}</button>
            <button type="button" class={smallButton} onclick={() => remove(i)}
              aria-label={t('app.tasks.ref.remove', 'Remove reference {n}', { n: i + 1 })}>{t('app.tasks.ref.remove-short', 'Remove')}</button>
          </span>
        </li>
      {/each}
    </ol>
  {:else}
    <p class={helpClass}>{t('app.tasks.ref.none', 'No references.')}</p>
  {/if}

  {#if full}
    <p class={helpClass}>{t('app.tasks.ref.full', 'A task holds at most {n} references. Remove one to add another.', { n: MAX_REFERENCES })}</p>
  {:else}
    <div class="space-y-2 border-t border-zinc-200 pt-3 dark:border-zinc-800">
      <div class="space-y-1">
        <label for="{p}-ref-kind" class={labelClass}>{t('app.tasks.ref.kind', 'Kind')}</label>
        <select id="{p}-ref-kind" value={kind} onchange={(e) => setKind(e.currentTarget.value as ReferenceKind)} class="{inputClass} max-w-xs">
          {#each kinds as k (k)}<option value={k}>{referenceKindLabel(k)}</option>{/each}
        </select>
      </div>

      {#if kind === 'TASK'}
        <div class="space-y-1">
          <span class={labelClass}>{t('app.tasks.ref.target.task', 'Task')}</span>
          <div class="flex flex-wrap items-center gap-2">
            <button type="button" onclick={() => (picking = true)} class="rounded-md border border-zinc-300 px-3 py-1 text-sm text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">{t('app.tasks.ref.choose-task', 'Choose a task…')}</button>
            {#if picked}
              <span class="min-w-0 text-sm text-zinc-800 [overflow-wrap:anywhere] dark:text-zinc-100">{picked.title}</span>
              <TaskHandle handle={picked.handle} />
              <button type="button" class={smallButton} onclick={() => (picked = null)}
                aria-label={t('app.tasks.ref.clear-task', 'Clear the selected task')}>{t('app.tasks.ref.clear-task-short', 'Clear')}</button>
            {/if}
          </div>
          <p class={helpClass}>{t('app.tasks.ref.task-help', 'Any task in this App, finished and cancelled ones included.')}</p>
        </div>
      {:else}
        <div class="space-y-1">
          <label for="{p}-ref-target" class={labelClass}>{targetLabel}</label>
          <input id="{p}-ref-target" type="text" inputmode="url" autocomplete="off" spellcheck="false" maxlength={MAX_TARGET_LENGTH}
            bind:this={targetEl} bind:value={target} class={inputClass}
            aria-invalid={nodeError ? 'true' : undefined}
            aria-describedby={nodeError ? `${p}-ref-target-error ${p}-ref-target-help` : `${p}-ref-target-help`} />
          {#if nodeError}<p id="{p}-ref-target-error" class="text-xs text-red-700 dark:text-red-300">{nodeError}</p>{/if}
          {#if kind === 'NODE' && target.trim() !== '' && !nodeError}
            <div data-testid="{p}-ref-node-chip"><Urn value={target.trim()} size={10} linked compact label={t('app.tasks.ref.node-chip', 'node')} /></div>
          {/if}
          <p id="{p}-ref-target-help" class={helpClass}>{targetHelp}</p>
        </div>
      {/if}

      <div class="space-y-1">
        <label for="{p}-ref-label" class={labelClass}>{t('app.tasks.ref.label', 'Label')} <span class="font-normal text-zinc-500">{t('app.tasks.ref.optional', '(optional)')}</span></label>
        <input id="{p}-ref-label" type="text" autocomplete="off" maxlength={MAX_LABEL_LENGTH} bind:this={labelEl} bind:value={label} class={inputClass} />
      </div>

      <button type="button" disabled={!canAdd} onclick={add}
        class="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800">{t('app.tasks.ref.add', 'Add reference')}</button>
    </div>
  {/if}

  <!-- Inside the fieldset (it is a fixed overlay, so this doesn't move it) so Enter in its lookup field never submits the outer form. -->
  {#if app.urn}
    <SelectTask appId={app.id} includeEnded bind:open={picking} onselect={(choice: TaskChoice) => (picked = choice)} />
  {/if}
</fieldset>
