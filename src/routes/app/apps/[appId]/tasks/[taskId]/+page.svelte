<script lang="ts">
  import TaskHandBack from '$lib/components/agent-tasks/TaskHandBack.svelte';
  import TaskProperties from '$lib/components/agent-tasks/TaskProperties.svelte';
  import TaskPlanning from '$lib/components/agent-tasks/TaskPlanning.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import CopyCode from '$lib/components/agent-tasks/CopyCode.svelte';
  import NotParticipant from '$lib/components/agent-tasks/NotParticipant.svelte';
  import PartyLabel from '$lib/components/agent-tasks/PartyLabel.svelte';
  import SubtaskTree from '$lib/components/agent-tasks/SubtaskTree.svelte';
  import TaskHistory from '$lib/components/agent-tasks/TaskHistory.svelte';
  import TaskSource from '$lib/components/agent-tasks/TaskSource.svelte';
  import TaskReferences from '$lib/components/agent-tasks/TaskReferences.svelte';
  import TaskStateChips from '$lib/components/agent-tasks/TaskStateChips.svelte';
  import TaskHandle from '$lib/components/agent-tasks/TaskHandle.svelte';
  import { isProjectZero, taskHref } from '$lib/agent-tasks/handle';
  import TaskActionBar from '$lib/components/agent-tasks/TaskActionBar.svelte';
  import { fmtRunTime } from '$lib/flow/runs';
  import { t } from '$lib/i18n/t';
  import { outcomeClass, sourceKind, taskDisplayState } from '$lib/agent-tasks/status';
  import type { PageData } from './$types';

  /**
   * portal#1052 — one task (design §5): facts, description, subtasks and
   * history. Read-only: nothing here writes.
   */
  let { data }: { data: PageData } = $props();

  const task = $derived(data.task);
  // portal#1349: AT0 is the server's fixed "No project" row — read-only here, whatever the viewer may do elsewhere.
  const fixedTask = $derived(isProjectZero(data.task.handle));
  const basePath = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const state = $derived(taskDisplayState(task));

  const crumbs = $derived([
    { label: t('app.tasks.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: basePath },
    { label: t('app.tasks.crumb.tasks', 'Tasks'), href: `${basePath}/tasks` },
    ...(data.ancestorsTruncated ? [{ label: '…' }] : []),
    ...data.ancestors.map((a) => ({
      label: a.title,
      href: taskHref(basePath, a),
      chip: a.handle,
      chipLabel: t('app.tasks.handle.aria', 'Task handle {handle}', { handle: a.handle }),
    })),
    { label: task.title },
  ]);

  /**
   * portal#1090: cancelling counts the task's open (pending or started) DIRECT
   * children and leaves them as they are; the confirmation says how many, from
   * the tree the page already loaded ("at least" when that read was capped).
   */
  const openChildren = $derived.by(() => {
    // Uma's P3-2 on #1135: a failed tree read can't be counted; the panel says so.
    if (data.tree.kind !== 'ok' || !data.tree.value) return { count: 0, capped: false, unknown: data.tree.kind !== 'ok' };
    const count = data.tree.value.rows.filter(
      (r) => r.parentTaskId === task.id && (r.status === 'PENDING' || r.status === 'STARTED'),
    ).length;
    return { count, capped: data.tree.value.capped };
  });

  const parent = $derived(data.ancestors.length ? data.ancestors[data.ancestors.length - 1] : null);

  /** §5.1: who a queued task is waiting for, in the requirements' own terms. */
  const waitingFor = $derived.by(() => {
    const r = task.requirements;
    const parts: string[] = [];
    if (r?.role) parts.push(t('app.tasks.req.role', 'role {role}', { role: r.role }));
    if (r?.familyIn?.length) parts.push(t('app.tasks.req.family-in', 'model family {families}', { families: r.familyIn.join(', ') }));
    if (r?.familyNotIn?.length) parts.push(t('app.tasks.req.family-not-in', 'not {families}', { families: r.familyNotIn.join(', ') }));
    if (r?.minTier) parts.push(t('app.tasks.req.min-tier', 'a {tier}-tier model or higher', { tier: r.minTier }));
    return parts.join(', ');
  });

  const resolutionLabel = (r: string | null) =>
    r === 'ENDED'
      ? t('app.tasks.session-end.ended', 'Ended')
      : r === 'END_ISSUED'
        ? t('app.tasks.session-end.issued', 'End issued to host')
        : r === 'NO_LIVE_HOST'
          ? t('app.tasks.session-end.no-host', 'No live host')
          : null;

  /** The task's own people, so its history can name a person an event names by id only. */
  const people = $derived(
    Object.fromEntries(
      [task.owner, task.assignee, task.createdBy, task.assignedBy]
        .filter((p): p is NonNullable<typeof p> => !!p && p.kind === 'USER' && !!p.name)
        .map((p) => [p.id, p.name as string]),
    ),
  );

  /** Description is free text from any participant: plain text, line breaks kept, http(s) URLs linked. No {@html}. */
  const descriptionParts = $derived(
    (task.description ?? '').split(/(https?:\/\/[^\s<>"']+)/g).map((part, i) => ({ part, link: i % 2 === 1 })),
  );
</script>

<svelte:head><title>{task.title} · {t('app.tasks.head', 'Tasks')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-5">
  <Breadcrumb items={crumbs} />

  <div class="flex flex-wrap items-start justify-between gap-3">
    <div class="min-w-0">
      <h1 class="text-xl font-bold break-words text-zinc-900 dark:text-white">{task.title}</h1>
      <div class="mt-1 flex flex-wrap items-center gap-2"><TaskHandle handle={task.handle} /><TaskStateChips {task} /></div>
      {#if fixedTask}
        <p class="mt-2 text-sm text-zinc-600 dark:text-zinc-300" data-testid="project-zero-note">
          {t('app.tasks.project-zero', 'This is the fixed “No project” task. It can’t be started, assigned, or cancelled.')}
        </p>
      {/if}
      <!-- AT0 has no action bar at all: the note above says why. Passing it canWrite=false
           instead read as a support session ("Viewing as —") to everyone (Celine QA P2, portal#1375). -->
      {#if !fixedTask}
        <TaskActionBar
          {task}
          canWrite={data.canWrite}
          impersonating={data.impersonating}
          candidates={data.candidates}
          roles={data.roles}
          families={data.families}
          {openChildren}
          created={data.created}
          viewerId={data.viewerId}
          appUrn={data.app.urn}
          nodeMemories={data.nodeMemories}
        />
      {/if}
    </div>
    <div class="flex min-w-0 flex-col items-start gap-1 sm:items-end">
      <CopyCode value={task.handle} label={t('app.tasks.copy-handle', 'Copy the task handle')} />
      <CopyCode value={task.id} label={t('app.tasks.copy-id', 'Copy the task id')} />
      <CopyCode value="hadron team task get {task.id}" label={t('app.tasks.copy-cli', 'Copy the CLI command that reads this task')} />
    </div>
  </div>

  <TaskPlanning {task} appId={data.app.id} canWrite={data.canWrite} dependencies={data.dependencies} />

  <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="task-facts">
    <h2 id="task-facts" class="sr-only">{t('app.tasks.facts', 'Facts')}</h2>
    <dl class="grid grid-cols-1 gap-x-6 gap-y-3 text-sm md:grid-cols-[max-content_minmax(0,1fr)_max-content_minmax(0,1fr)]">
      <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.owner', 'Owner')}</dt>
      <dd class="min-w-0"><PartyLabel party={task.owner} /></dd>

      <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.assignee', 'Assignee')}</dt>
      <dd class="min-w-0">
        {#if state === 'queued'}
          <span class="text-zinc-700 dark:text-zinc-300">
            {waitingFor
              ? t('app.tasks.fact.queued-for', 'Nobody yet: waiting for a worker with {req}', { req: waitingFor })
              : t('app.tasks.fact.queued', 'Nobody yet: waiting for a worker')}
          </span>
          {#if task.requirements?.excludeWorkerIds?.length}
            <span class="block text-xs text-zinc-500">{t('app.tasks.fact.excluded', 'Excludes {n} worker(s)', { n: task.requirements.excludeWorkerIds.length })}</span>
          {/if}
        {:else if state === 'backlog'}
          <span class="text-zinc-700 dark:text-zinc-300">{t('app.tasks.fact.backlog-assignee', 'None: backlog tasks have no assignee and aren’t matched')}</span>
        {:else}
          <PartyLabel party={task.assignee} />
        {/if}
      </dd>

      {#if task.parentTaskId}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.parent', 'Parent')}</dt>
        <dd class="flex min-w-0 items-center gap-1.5">
          <a href={taskHref(basePath, parent && parent.id === task.parentTaskId ? parent : { id: task.parentTaskId })} class="min-w-0 truncate text-indigo-600 hover:underline dark:text-indigo-300">
            {parent && parent.id === task.parentTaskId ? parent.title : t('app.tasks.fact.parent-task', 'Parent task')}
          </a>
          <!-- portal#1349: the parent's handle beside its title; an unread parent shows none. -->
          {#if parent && parent.id === task.parentTaskId}<TaskHandle handle={parent.handle} />{/if}
        </dd>
      {/if}

      {#if task.source}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.source', 'Source')}</dt>
        <dd class="min-w-0" data-source-kind={sourceKind(task.source)}><TaskSource source={task.source} /></dd>
      {/if}

      <!-- portal#1575: the task's typed references, in order, under the source; nothing when there are none. -->
      {#if task.references?.length}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.references', 'References')}</dt>
        <dd class="min-w-0"><TaskReferences references={task.references} app={data.app} /></dd>
      {/if}

      {#if task.startBy}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.start-by', 'Start by')}</dt>
        <dd class="min-w-0">{fmtRunTime(task.startBy)}</dd>
      {/if}

      <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.created', 'Created')}</dt>
      <dd class="min-w-0 flex flex-wrap items-center gap-x-2">
        <span>{fmtRunTime(task.createdAt)}</span>
        {#if task.createdBy}
          <PartyLabel party={task.createdBy} showUrn={false} />
        {:else if task.createdByRunId}
          <a href="{basePath}/runs/{task.createdByRunId}" class="text-indigo-600 hover:underline dark:text-indigo-300">
            {t('app.tasks.history.run', 'Run {id}', { id: task.createdByRunId.slice(0, 8) })}
          </a>
        {/if}
      </dd>

      {#if task.assignedAt}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.assigned', 'Assigned')}</dt>
        <dd class="min-w-0 flex flex-wrap items-center gap-x-2">
          <span>{fmtRunTime(task.assignedAt)}</span>
          {#if task.assignedBy}<PartyLabel party={task.assignedBy} showUrn={false} />{/if}
        </dd>
      {/if}
      {#if task.startedAt}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.started', 'Started')}</dt>
        <dd class="min-w-0">{fmtRunTime(task.startedAt)}</dd>
      {/if}
      {#if task.finishedAt}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.finished', 'Finished')}</dt>
        <dd class="min-w-0">{fmtRunTime(task.finishedAt)}</dd>
      {/if}
      {#if task.cancelledAt}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.cancelled', 'Cancelled')}</dt>
        <dd class="min-w-0">{fmtRunTime(task.cancelledAt)}</dd>
      {/if}

      {#if task.result}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.result', 'Result')}</dt>
        <dd class="min-w-0 space-y-1">
          <span class="font-medium {outcomeClass(task.result.outcome)}">{task.result.outcome}</span>
          {#if task.result.summary}<p class="whitespace-pre-line text-zinc-700 dark:text-zinc-300">{task.result.summary}</p>{/if}
          {#if task.result.evidence}<div><TaskSource source={task.result.evidence} /></div>{/if}
        </dd>
      {/if}

      <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.session', 'Session when done')}</dt>
      <dd class="min-w-0">
        {task.closeSessionWhenDone
          ? t('app.tasks.fact.session-ends', 'Ends the assignee’s session when done')
          : t('app.tasks.fact.session-open', 'Leaves the session open')}
        {#if task.sessionEndRequest}
          <span class="block text-xs text-zinc-500 dark:text-zinc-400">
            {t('app.tasks.fact.session-asked', 'Asked {asked}, due {due}', {
              asked: fmtRunTime(task.sessionEndRequest.requestedAt),
              due: fmtRunTime(task.sessionEndRequest.dueAt),
            })}{#if resolutionLabel(task.sessionEndRequest.resolution)}: {resolutionLabel(task.sessionEndRequest.resolution)}{/if}
          </span>
        {/if}
      </dd>

      {#if task.tags.length}
        <dt class="text-zinc-500 dark:text-zinc-400">{t('app.tasks.fact.tags', 'Tags')}</dt>
        <dd class="min-w-0 flex flex-wrap gap-1">
          {#each task.tags as tag (tag)}
            <span class="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">{tag}</span>
          {/each}
        </dd>
      {/if}
    </dl>

    {#if task.description}
      <div class="mt-5 border-t border-zinc-100 pt-4 dark:border-zinc-800">
        <h2 class="mb-1 text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.description', 'Description')}</h2>
        <p class="text-sm whitespace-pre-line break-words text-zinc-700 dark:text-zinc-300" data-testid="task-description">{#each descriptionParts as p, i (i)}{#if p.link}<a href={p.part} rel="noopener noreferrer" target="_blank" class="text-indigo-600 hover:underline dark:text-indigo-300">{p.part}</a>{:else}{p.part}{/if}{/each}</p>
      </div>
    {/if}
  </section>

  <TaskHandBack handBack={task.handBack} />

  <TaskProperties properties={task.properties} />

  <section id="subtasks" class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="subtasks-heading">
    <h2 id="subtasks-heading" class="mb-2 text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.subtasks', 'Subtasks')}</h2>
    {#if data.tree.kind === 'ok' && data.tree.value}
      {#if data.tree.value.capped}
        <p role="status" class="mb-2 text-xs text-amber-700 dark:text-amber-300">
          {t('app.tasks.tree.capped', 'Showing the first 1000 tasks in this tree; deeper or later subtasks aren’t shown.')}
        </p>
      {/if}
      <SubtaskTree rows={data.tree.value.rows} rootId={task.id} {basePath} />
    {:else if data.tree.kind === 'not-participant'}
      <NotParticipant />
    {:else if data.tree.kind === 'ok' && fixedTask}
      <!-- portal#1414: the server answers AT0's tree with null by design (AT0 is not a tree root).
           Neutral on AT0 only: any other null is a race with deletion or revoked access, and keeps the alert. -->
      <p class="text-sm text-zinc-500 dark:text-zinc-400" data-testid="project-zero-tree">
        {t('app.tasks.tree.project-zero.lead', 'Tasks that belong to no project are listed on the')}
        <a href="{basePath}/tasks" class="text-indigo-600 hover:underline dark:text-indigo-300">{t('app.tasks.tree.project-zero.link', 'Tasks page')}</a>{t('app.tasks.tree.project-zero.tail', ', not under this one.')}
      </p>
    {:else}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.tasks.tree.failed', 'Couldn’t load the subtasks.')}
      </div>
    {/if}
  </section>

  <section class="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900" aria-labelledby="history-heading">
    <div class="mb-2 flex items-center justify-between gap-2">
      <h2 id="history-heading" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.tasks.history', 'History')}</h2>
      {#if data.history.kind === 'ok' && data.history.value.events.length > 8}
        <a href="#history-end" class="text-xs text-indigo-600 hover:underline dark:text-indigo-300">{t('app.tasks.history.latest', 'Jump to latest')}</a>
      {/if}
    </div>
    {#if data.history.kind === 'ok'}
      <TaskHistory events={data.history.value.events} {basePath} {people} />
      {#if data.history.value.capped}
        <p role="status" class="mt-2 text-xs text-amber-700 dark:text-amber-300">
          {t('app.tasks.history.capped', 'Showing the first 1000 events; later ones aren’t shown.')}
        </p>
      {/if}
      <span id="history-end"></span>
    {:else if data.history.kind === 'not-participant'}
      <NotParticipant />
    {:else}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.tasks.history.failed', 'Couldn’t load the history.')}
      </div>
    {/if}
  </section>
</div>
