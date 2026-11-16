<script lang="ts">
  import SelectTask from '$lib/components/agent-tasks/SelectTask.svelte';
  import TaskReferencesEditor from '$lib/components/agent-tasks/TaskReferencesEditor.svelte';
  import { readReferences } from '$lib/agent-tasks/references';
  import type { TaskChoice } from '$lib/agent-tasks/types';
  import { onMount, tick, untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import PartyPicker from '$lib/components/agent-tasks/PartyPicker.svelte';
  import TaskHandle from '$lib/components/agent-tasks/TaskHandle.svelte';
  import WriteRefusalAlert from '$lib/components/agent-tasks/WriteRefusal.svelte';
  import TaskWarnings from '$lib/components/agent-tasks/TaskWarnings.svelte';
  import { warningsBelow, type TaskWarning } from '$lib/agent-tasks/warnings';
  import { t } from '$lib/i18n/t';
  import type { WriteRefusal } from '$lib/agent-tasks/actions';
  import { localDateTimeToIso } from '$lib/agent-tasks/start-by';
  import { MIN_TIERS, tierLabel } from '$lib/agent-tasks/tier';
  import { taskHref } from '$lib/agent-tasks/handle';
  import { markStreamHandled } from '$lib/mark-stream-handled';
  import type { ActionData, PageData } from './$types';

  /**
   * portal#1090 — create a root task
   * (hrn:node:hadronmemory.com:hadron-portal:designs:agent-task-writes §6).
   * A refusal keeps every value typed and shows the server's sentence; success
   * redirects to the new task's page, which says "Task created."
   *
   * portal#1214: a create whose response carried warnings (or committed while
   * its response errored) is answered here instead, in place of the form, so
   * the warnings come from this response alone and nothing invites a second
   * create. The link uses the returned id, or the Tasks list without one.
   */
  let { data, form }: { data: PageData; form: ActionData } = $props();

  // portal#1588 QA F2: the streamed memories promise can reject before (or
  // regardless of) when the references editor's {#await} attaches, and a
  // rejected promise with no handler at the checkpoint is an UNCAUGHT PAGE
  // ERROR on the failure path (Celine: 4/4 runs, healthy path 0). Mark it
  // handled here, at the page that owns the stream — the editor's
  // {#await}/{:catch} still renders the failure copy from its own handler.
  $effect(() => {
    markStreamHandled(data.nodeMemories);
  });

  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');

  const result = $derived(form as { refusal?: WriteRefusal; values?: Record<string, string | string[]> } | null);
  const created = $derived(
    form && 'created' in form
      ? (form as { created: { id: string | null; handle: string | null }; cloned?: boolean; committedWithError: boolean; warnings: TaskWarning[]; more: number })
      : null,
  );
  let createdHeading = $state<HTMLElement | null>(null);
  const v = (k: string): string => {
    const x = result?.values?.[k];
    return Array.isArray(x) ? (x[0] ?? '') : (x ?? '');
  };
  const vs = (k: string): string[] => {
    const x = result?.values?.[k];
    return Array.isArray(x) ? x : x ? [x] : [];
  };

  // portal#2161: on ?from= the form is the Clone form. The pre-fill seeds the inputs AND posts as
  // the bases the save diffs against; after a refused submit the posted values re-seed them, as
  // on a plain create (every posted key is in `values`, so the first load is the only seed).
  // Seeded once, on purpose (the Edit panel's pattern): a same-source rerender keeps what was
  // typed, and the effect below re-seeds only when the App or the source changes.
  const cloneSeed = untrack(() => data.clone);
  const cloneReqSeed = cloneSeed
    ? (JSON.parse(cloneSeed.values.requirements) as { role: string | null; familyIn: string[]; familyNotIn: string[]; excludeWorkers: string[]; minTier: string | null })
    : null;
  const cloneReq = $derived(
    data.clone
      ? (JSON.parse(data.clone.values.requirements) as { role: string | null; familyIn: string[]; familyNotIn: string[]; excludeWorkers: string[]; minTier: string | null })
      : null,
  );
  const seed = (k: string, fallback: string): string => (result?.values && k in result.values ? v(k) : fallback);
  const seedList = (k: string, fallback: string[]): string[] => (result?.values && k in result.values ? vs(k) : fallback);

  // The form's live choices; seeded from a refused submit so nothing typed is lost.
  let start = $state(v('start') || 'now');
  // Clark's P2 on #1135: the text fields are bound state, not one-way `value=`.
  // One-way values sit in a template effect that also reads `start`, and after
  // hydration a radio change re-applied the server value ('') over what was typed.
  let title = $state(seed('title', cloneSeed?.values.title ?? ''));
  let description = $state(seed('description', cloneSeed?.values.description ?? ''));
  let source = $state(seed('source', cloneSeed?.values.source ?? ''));
  let tags = $state(seed('tags', cloneSeed?.values.tags ?? ''));
  // 'copied' names no priority: a copied one the caller may not set is left out by the server.
  let priority = $state(seed('priority', cloneSeed ? 'copied' : ''));
  let blockers = $state<string[]>(vs('blockedBy'));
  let blockerLabels = $state<Record<string, string>>({});
  let taskPicker = $state(false);
  // The clone's parent, one choice vocabulary posted as cloneParent beside its base.
  let parentChoice = $state<string>(cloneSeed?.parent.choice ?? 'none');
  let parentTask = $state<{ id: string; handle: string; title: string } | null>(cloneSeed?.parent.task ?? null);
  let parentPicker = $state(false);
  let planningApp = '';
  $effect(() => {
    // A new App or a new clone source re-seeds everything the pre-fill filled; a same-key rerender
    // (a refused submit) keeps what the person typed.
    const key = `${data.app.id}|${data.clone?.source.id ?? ''}`;
    untrack(() => {
      if (planningApp && planningApp !== key) {
        title = data.clone?.values.title ?? '';
        description = data.clone?.values.description ?? '';
        source = data.clone?.values.source ?? '';
        tags = data.clone?.values.tags ?? '';
        priority = data.clone ? 'copied' : '';
        blockers = [];
        blockerLabels = {};
        taskPicker = false;
        parentChoice = data.clone?.parent.choice ?? 'none';
        parentTask = data.clone?.parent.task ?? null;
        parentPicker = false;
        familyIn = [];
        familyNotIn = [];
      }
      planningApp = key;
    });
  });
  let owner = $state(v('owner') || 'me');
  let assignee = $state(v('assignee') || 'nobody');
  let familyIn = $state<string[]>(seedList('familyIn', cloneReqSeed?.familyIn ?? []));
  let familyNotIn = $state<string[]>(seedList('familyNotIn', cloneReqSeed?.familyNotIn ?? []));
  let submitting = $state(false);

  const backlog = $derived(start === 'backlog');
  const fieldRefusal = (field: string) =>
    result?.refusal?.kind === 'invalid' && result.refusal.field === field ? result.refusal.message : null;

  /**
   * Start by in the browser's zone: the instant is computed from the CHOSEN
   * date's own offset (Diego's P2-3 on #1135), and sent as `startByUtc`.
   * Without JS there is none, and the server reads the time as UTC, which
   * the label then says.
   */
  let startByLocal = $state(v('startBy'));
  const startByUtc = $derived(localDateTimeToIso(startByLocal));
  let zoneLabel = $state(t('app.tasks.new.zone-utc', 'UTC'));
  onMount(() => {
    try {
      zoneLabel = Intl.DateTimeFormat().resolvedOptions().timeZone || zoneLabel;
    } catch {
      /* keep UTC */
    }
  });

  // "Run as one of" and "Never run as" are exclusive: choosing one clears the other.
  function pickIn(e: Event) {
    familyIn = [...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value);
    if (familyIn.length) familyNotIn = [];
  }
  function pickNotIn(e: Event) {
    familyNotIn = [...(e.target as HTMLSelectElement).selectedOptions].map((o) => o.value);
    if (familyNotIn.length) familyIn = [];
  }

  // portal#2161: like the Edit panel, a clone's pre-fill may hold a role, family or excluded
  // worker the candidate lists no longer name; union them so the pre-filled choice still shows.
  const union = (listed: string[], held: string[]) => [...new Set([...listed, ...held])];
  const roleOptions = $derived(data.clone && cloneReq ? union(data.roles, cloneReq.role ? [cloneReq.role] : []) : data.roles);
  const familyOptions = $derived(data.clone && cloneReq ? union(data.families, [...cloneReq.familyIn, ...cloneReq.familyNotIn]) : data.families);
  const workerOptions = $derived(
    data.clone && cloneReq
      ? [...data.candidates.workers, ...cloneReq.excludeWorkers.filter((id) => !data.candidates.workers.some((w) => w.id === id)).map((id) => ({ id, name: id }))]
      : data.candidates.workers,
  );

  let alertBox = $state<HTMLElement | null>(null);
  /** A browser-to-portal failure (Diego's P2-1 on #1135): the task may exist, so the fixed line, and the form stays. */
  let transportRefusal = $state<WriteRefusal | null>(null);
  const shownRefusal = $derived(transportRefusal ?? result?.refusal ?? null);
  const submit = ({ cancel }: { cancel: () => void }) => {
    if (submitting) { cancel(); return; }
    submitting = true;
    transportRefusal = null;
    return async ({ result: r0, update }: { result: { type: string }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
      if (r0.type === 'error') {
        // Not the error page: the create may have landed. Keep every field as typed.
        submitting = false;
        transportRefusal = { kind: 'uncertain' };
        await tick();
        alertBox?.focus();
        return;
      }
      await update({ reset: false });
      submitting = false;
      await tick();
      if (created) {
        createdHeading?.focus();
        return;
      }
      const r = (form as { refusal?: WriteRefusal } | null)?.refusal;
      if (r?.kind === 'refused' && (r.code === 'TASK_ASSIGNEE_INVALID' || r.code === 'TASK_OWNER_INVALID')) {
        document.getElementById(r.code === 'TASK_OWNER_INVALID' ? 'new-owner' : 'new-assignee')?.focus();
      } else if (r?.kind === 'invalid') {
        (document.getElementById(`new-${r.field}-other`) ?? document.getElementById(`new-${r.field}`))?.focus();
      } else if (r) {
        alertBox?.focus();
      }
    };
  };

  const inputClass =
    'w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100';
  const labelClass = 'block text-sm font-medium text-zinc-800 dark:text-zinc-200';
  const helpClass = 'text-xs text-zinc-500 dark:text-zinc-400';
</script>

<svelte:head><title>{data.clone ? t('app.tasks.clone.head', 'Clone task') : t('app.tasks.new.head', 'New task')} · {data.app.name} · Hadron</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-4">
  <Breadcrumb items={[
    { label: t('app.tasks.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.tasks.crumb.tasks', 'Tasks'), href: `${basePath}/tasks` },
    { label: data.clone ? t('app.tasks.clone.head', 'Clone task') : t('app.tasks.new.head', 'New task') },
  ]} />

  <div>
    <h1 class="text-xl font-bold text-zinc-900 dark:text-white">{data.clone ? t('app.tasks.clone.head', 'Clone task') : t('app.tasks.new.head', 'New task')}</h1>
    <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
      {#if data.clone}
        {t('app.tasks.clone.intro', 'Starts from {handle} {title}. The copy carries its details; its priority and properties are copied only if you may set them.', { handle: data.clone.source.handle, title: data.clone.source.title })}
      {:else}
        {t('app.tasks.new.root-only', 'Creates a top-level task. To add subtasks, the task’s assignee creates them.')}
      {/if}
    </p>
  </div>

  {#if !data.canWrite}
    <p class="text-sm text-zinc-500 dark:text-zinc-400">
      {t('app.tasks.write.impersonating', 'Viewing as {name}: changes are switched off in a support session.', { name: data.impersonating ?? '—' })}
    </p>
  {:else if created}
    <section class="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" data-testid="task-created">
      <!-- Uma's P2/P3 on #1216: focus lands here, so the heading says warnings follow; no role, so it stays a heading. -->
      <h2 bind:this={createdHeading} tabindex="-1" class="text-sm font-semibold {created.committedWithError ? 'text-amber-800 dark:text-amber-300' : 'text-green-700 dark:text-green-300'}">
        {[
          created.committedWithError
            ? (created.cloned ? t('app.tasks.clone.created-error', 'Task cloned, but the server’s response also reported an error.') : t('app.tasks.new.created-error', 'Task created, but the server’s response also reported an error.'))
            : (created.cloned ? t('app.tasks.clone.done', 'Task cloned.') : t('app.tasks.write.done.created', 'Task created.')),
          warningsBelow(created.warnings.length + created.more),
        ].filter(Boolean).join(' ')}
      </h2>
      <TaskWarnings warnings={created.warnings} more={created.more} />
      {#if created.created.id}
        <a href={taskHref(basePath, { id: created.created.id, handle: created.created.handle })} class="inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-300">{t('app.tasks.new.open-created', 'Open the task')}</a>
      {:else}
        <a href="{basePath}/tasks" class="inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-300">{t('app.tasks.new.find-created', 'Find it in the Tasks list')}</a>
      {/if}
    </section>
  {:else}
    <form method="POST" use:enhance={submit} class="space-y-5 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">

      <input type="hidden" name="startByUtc" value={startByUtc} />

      <!-- portal#2161: the clone mode's bases — every copied field posts the value the form was
           pre-filled with, and only a change against it goes into the clone input. -->
      {#if data.clone}
        <input type="hidden" name="from" value={data.clone.source.id} />
        <input type="hidden" name="titleBase" value={data.clone.values.title} />
        <input type="hidden" name="descriptionBase" value={data.clone.values.description} />
        <input type="hidden" name="sourceBase" value={data.clone.values.source} />
        <input type="hidden" name="tagsBase" value={data.clone.values.tags} />
        <input type="hidden" name="closeSessionWhenDoneBase" value={data.clone.values.closeSessionWhenDone ? 'true' : 'false'} />
        <input type="hidden" name="referencesBase" value={data.clone.values.references} />
        <input type="hidden" name="requirementsBase" value={data.clone.values.requirements} />
        <input type="hidden" name="cloneParentBase" value={data.clone.parent.choice} />
      {/if}

      <div class="space-y-1">
        <label for="new-title" class={labelClass}>{t('app.tasks.new.title', 'Title')}</label>
        <input id="new-title" name="title" type="text" required aria-required="true" bind:value={title} class={inputClass}
          aria-describedby={fieldRefusal('title') ? 'new-title-error' : undefined} />
        {#if fieldRefusal('title')}<p id="new-title-error" class="text-xs text-red-700 dark:text-red-300">{fieldRefusal('title')}</p>{/if}
      </div>

      <div class="space-y-1">
        <label for="new-description" class={labelClass}>{t('app.tasks.new.description', 'Description')}</label>
        <textarea id="new-description" name="description" rows="4" class={inputClass} bind:value={description}></textarea>
      </div>

      <!-- portal#2161: the parent the copy will actually get — the pre-fill never shows a parent
           the server won't keep (ended or AT0 falls back to "No project"; a root stays a project). -->
      {#if data.clone}
        <div class="space-y-1" data-testid="clone-parent">
          <span class={labelClass} id="clone-parent-heading">{t('app.tasks.clone.parent', 'Parent')}</span>
          <p class="text-sm text-zinc-800 dark:text-zinc-200" aria-labelledby="clone-parent-heading">
            {#if parentTask && parentChoice === `parent:${parentTask.id}`}
              <a href={taskHref(basePath, parentTask)} class="text-indigo-600 hover:underline dark:text-indigo-300">{parentTask.title}</a>
              <TaskHandle handle={parentTask.handle} />
            {:else if parentChoice.startsWith('parent:')}
              {t('app.tasks.clone.parent-unreadable', 'A task you can’t see')}
            {:else if parentChoice === 'project'}
              {t('app.tasks.clone.parent.project', 'A project of its own')}
            {:else}
              {t('app.tasks.clone.parent.none', 'No project')}
            {/if}
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800" onclick={() => (parentPicker = true)}>{t('app.tasks.clone.parent.change', 'Change…')}</button>
            {#if parentChoice !== 'none'}
              <button type="button" data-testid="clone-parent-none" class="rounded border border-zinc-300 px-3 py-1 text-sm text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800" onclick={() => (parentChoice = 'none')}>{t('app.tasks.clone.parent.no-project', 'No project')}</button>
            {/if}
          </div>
          <input type="hidden" name="cloneParent" value={parentChoice} />
          <p class={helpClass}>{t('app.tasks.clone.parent.help', 'Unchanged, the copy keeps this parent. “No project” makes it a task under AT0.')}</p>
        </div>
      {/if}

      <fieldset disabled={submitting} class="space-y-3 rounded border border-zinc-200 p-3 dark:border-zinc-700">
        <legend class={labelClass}>{data.clone ? t('app.tasks.priority', 'Priority') : t('app.tasks.planning', 'Priority and blockers')}</legend>
        <label for="new-priority" class={labelClass}>{t('app.tasks.priority', 'Priority')}</label>
        <select id="new-priority" name="priority" bind:value={priority} class={inputClass}>
          {#if data.clone}
            <!-- Not a promise: a copied priority the caller may not set is silently left out. -->
            <option value="copied">
              {data.clone.values.priority != null
                ? t('app.tasks.clone.priority-copied-current', 'Copied if you may set it (current: {n})', { n: data.clone.values.priority })
                : t('app.tasks.clone.priority-copied', 'Copied if you may set it')}
            </option>
          {:else}
            <option value="">{t('app.tasks.priority.default', 'Use default (1, highest)')}</option>
          {/if}
          {#each [1,2,3,4,5] as value}<option value={String(value)}>{value}</option>{/each}
        </select>
        {#if data.clone}
          <!-- Blockers are not copied and the clone input takes none, so the clone form offers no picker. -->
          <p class={helpClass}>{t('app.tasks.clone.priority-help', 'Naming a priority requires permission to assign the new task. Leave it copied to take the source’s, if you may set one.')}</p>
        {:else}
          <p class={helpClass}>{t('app.tasks.planning.create-authority', 'Setting priority or blockers requires permission to assign the new task. Leave them unset to use the defaults.')}</p>
          <div class="flex flex-wrap gap-2">
            {#each blockers as ref (ref)}
              <input type="hidden" name="blockedBy" value={ref} />
              <button type="button" class="rounded border px-2 py-1 text-sm" onclick={() => blockers = blockers.filter((id) => id !== ref)}>{blockerLabels[ref] ?? t('app.tasks.blocker.selected', 'Selected task')} · {t('app.tasks.blocker.remove', 'Remove')}</button>
            {/each}
          </div>
          <button type="button" class="rounded border px-3 py-1 text-sm" onclick={() => taskPicker = true}>{t('app.tasks.blocker.choose', 'Choose a blocker')}</button>
        {/if}
      </fieldset>

      <fieldset class="space-y-1">
        <legend class={labelClass}>{t('app.tasks.new.start', 'Where it starts')}</legend>
        <label class="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
          <input type="radio" name="start" value="now" bind:group={start} checked={start === 'now'} />
          {t('app.tasks.new.start.now', 'Start work now')}
        </label>
        <label class="flex items-center gap-2 text-sm text-zinc-800 dark:text-zinc-200">
          <input type="radio" name="start" value="backlog" bind:group={start} checked={start === 'backlog'} />
          {t('app.tasks.new.start.backlog', 'Put it in the backlog')}
        </label>
        {#if backlog}<p class={helpClass}>{t('app.tasks.new.backlog-note', 'Backlog tasks have no assignee and aren’t matched.')}</p>{/if}
      </fieldset>

      <PartyPicker
        name="owner"
        id="new-owner"
        label={t('app.tasks.new.owner', 'Owner')}
        bind:value={owner}
        other={v('ownerOther')}
        leading={[{ value: 'me', label: t('app.tasks.new.owner.me', 'Me') }]}
        workers={data.candidates.workers}
        people={data.candidates.people}
        peopleWithheld={data.candidates.peopleWithheld ?? false}
        peopleFailed={data.candidates.peopleFailed ?? false}
      />
      {#if fieldRefusal('owner')}<p class="text-xs text-red-700 dark:text-red-300" role="alert">{fieldRefusal('owner')}</p>{/if}

      <!-- A backlog task takes no assignee (hrn:node:hadronmemory.com:specs:cor:agt:050:02): hidden, not disabled. -->
      {#if !backlog}
        <PartyPicker
          name="assignee"
          id="new-assignee"
          label={t('app.tasks.new.assignee', 'Assignee')}
          bind:value={assignee}
          other={v('assigneeOther')}
          leading={[{ value: 'nobody', label: t('app.tasks.new.assignee.nobody', 'Nobody: let Hadron match a worker') }]}
          workers={data.candidates.workers}
          people={data.candidates.people}
          peopleWithheld={data.candidates.peopleWithheld ?? false}
        peopleFailed={data.candidates.peopleFailed ?? false}
        />
        {#if fieldRefusal('assignee')}<p class="text-xs text-red-700 dark:text-red-300" role="alert">{fieldRefusal('assignee')}</p>{/if}

        {#if assignee === 'nobody'}
          <details class="rounded-md border border-zinc-200 p-3 dark:border-zinc-800">
            <summary class="cursor-pointer text-sm font-medium text-zinc-800 dark:text-zinc-200">{t('app.tasks.new.who-may', 'Who may pick it up')}</summary>
            <div class="mt-3 space-y-3">
              <div class="space-y-1">
                <label for="new-role" class={labelClass}>{t('app.tasks.new.role', 'Role')}</label>
                <select id="new-role" name="role" class={inputClass}>
                  <option value="">{t('app.tasks.new.role.any', 'Any role')}</option>
                  {#each roleOptions as r (r)}<option value={r} selected={seed('role', cloneReq?.role ?? '') === r}>{r}</option>{/each}
                </select>
              </div>
              <div class="space-y-1">
                <label for="new-family-in" class={labelClass}>{t('app.tasks.new.family-in', 'Run as one of')}</label>
                <select id="new-family-in" name="familyIn" multiple class={inputClass} onchange={pickIn}>
                  {#each familyOptions as f (f)}<option value={f} selected={familyIn.includes(f)}>{f}</option>{/each}
                </select>
              </div>
              <div class="space-y-1">
                <label for="new-family-not-in" class={labelClass}>{t('app.tasks.new.family-not-in', 'Never run as')}</label>
                <select id="new-family-not-in" name="familyNotIn" multiple class={inputClass} onchange={pickNotIn}>
                  {#each familyOptions as f (f)}<option value={f} selected={familyNotIn.includes(f)}>{f}</option>{/each}
                </select>
                <p class={helpClass}>{t('app.tasks.new.family-help', 'Choose one list or the other.')}</p>
              </div>
              <div class="space-y-1">
                <label for="new-exclude" class={labelClass}>{t('app.tasks.new.exclude', 'Exclude workers')}</label>
                <select id="new-exclude" name="excludeWorkers" multiple class={inputClass}>
                  {#each workerOptions as w (w.id)}<option value={w.id} selected={seedList('excludeWorkers', cloneReq?.excludeWorkers ?? []).includes(w.id)}>{w.name}</option>{/each}
                </select>
              </div>
              <div class="space-y-1">
                <label for="new-min-tier" class={labelClass}>{t('app.tasks.new.min-tier', 'Minimum model tier')}</label>
                <select id="new-min-tier" name="minTier" aria-describedby="new-min-tier-help" class={inputClass}>
                  <option value="">{t('app.tasks.new.min-tier.any', 'Any')}</option>
                  {#each MIN_TIERS as tier (tier)}<option value={tier} selected={seed('minTier', cloneReq?.minTier ?? '') === tier}>{tierLabel(tier)}</option>{/each}
                </select>
                <p id="new-min-tier-help" class={helpClass}>{t('app.tasks.new.min-tier.help', 'The task goes to the cheapest free worker at or above this tier. When a minimum is selected, a worker whose tier is unknown won’t be picked.')}</p>
              </div>
            </div>
          </details>
        {/if}
      {/if}

      <div class="space-y-1">
        <label for="new-start-by" class={labelClass}>{t('app.tasks.new.start-by', 'Start by')} <span class="font-normal text-zinc-500">({zoneLabel})</span></label>
        <input id="new-start-by" name="startBy" type="datetime-local" bind:value={startByLocal} aria-describedby="new-start-by-help" class="{inputClass} max-w-xs" />
        <p id="new-start-by-help" class={helpClass}>{t('app.tasks.new.start-by.help', 'If it’s still pending then, an alarm is raised.')}</p>
      </div>

      <div class="space-y-1">
        <label for="new-source" class={labelClass}>{t('app.tasks.new.source', 'Source')}</label>
        <input id="new-source" name="source" type="text" bind:value={source} aria-describedby="new-source-help" class={inputClass} />
        <p id="new-source-help" class={helpClass}>{t('app.tasks.new.source.help', 'A link, a URN or a note on where this came from.')}</p>
      </div>

      <!-- portal#1575: typed references; a refused submit hands the list back, so nothing added is lost.
           #1576 step 2: NODE is picked with SelectNode over the streamed readable memories. -->
      <TaskReferencesEditor app={{ id: data.app.id, urn: data.app.urn ?? null }} nodeMemories={data.nodeMemories} initial={readReferences(seed('references', data.clone?.values.references ?? '')) ?? []} idPrefix="new" invalid={fieldRefusal('references')} />

      <div class="space-y-1">
        <label for="new-tags" class={labelClass}>{t('app.tasks.new.tags', 'Tags')}</label>
        <input id="new-tags" name="tags" type="text" bind:value={tags} placeholder="a, b" class={inputClass} />
      </div>

      <div>
        <label class="flex items-start gap-2 text-sm text-zinc-800 dark:text-zinc-200">
          <input type="checkbox" name="closeSessionWhenDone" checked={result?.values ? v('closeSessionWhenDone') === 'on' : (data.clone ? data.clone.values.closeSessionWhenDone : true)} aria-describedby="new-close-help" class="mt-0.5" />
          {t('app.tasks.write.close-session', 'End the assignee’s session when the task finishes')}
        </label>
        <p id="new-close-help" class="ml-6 {helpClass}">
          {t('app.tasks.write.close-session.help', 'On: the assignee is asked to end its session when the task finishes or is cancelled. Off: its session stays open.')}
        </p>
      </div>

      {#if shownRefusal && shownRefusal.kind !== 'invalid'}
        <div bind:this={alertBox} tabindex="-1"><WriteRefusalAlert refusal={shownRefusal} /></div>
      {/if}

      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={submitting} class="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50">
          {submitting
            ? (data.clone ? t('app.tasks.clone.submitting', 'Cloning…') : t('app.tasks.new.creating', 'Creating…'))
            : (data.clone ? t('app.tasks.clone.submit', 'Clone task') : t('app.tasks.new.submit', 'Create task'))}
        </button>
        <a href={data.clone ? taskHref(basePath, { id: data.clone.source.id, handle: data.clone.source.handle }) : `${basePath}/tasks`} class="text-sm text-zinc-600 hover:underline dark:text-zinc-300">{t('app.tasks.new.cancel', 'Cancel')}</a>
      </div>
    </form>
  {/if}
</div>

{#if data.clone}
  <SelectTask appId={data.app.id} bind:open={parentPicker} onselect={(task: TaskChoice) => {
    parentChoice = `parent:${task.id}`;
    parentTask = { id: task.id, handle: task.handle, title: task.title };
  }} />
{:else}
  <SelectTask appId={data.app.id} bind:open={taskPicker} onselect={(task: TaskChoice) => {
    if (!blockers.includes(task.id)) blockers = [...blockers, task.id];
    blockerLabels = { ...blockerLabels, [task.id]: task.title };
  }} />
{/if}
