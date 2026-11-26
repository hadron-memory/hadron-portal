<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import ListPageNav from '$lib/components/ListPageNav.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { fmtRunTime } from '$lib/flow/runs';
  import { questionStateLabels } from '$lib/questions/labels';
  import type { ListAsker, ListPerson, QuestionListRow } from '$lib/server/app-questions';
  import { t } from '$lib/i18n/t';
  import type { ActionData, PageData } from './$types';
  import {
    SORT_KEYS,
    STATUS_FILTERS,
    questionsHref,
    type PriorityKey,
    type SortKey,
    type StatusFilter,
  } from './filters';

  /**
   * portal#2235 (Questions P2): the App's Questions list. Read only: a row links to the question's own page, where the card
   * answers it. Every filter, sort and page is the server's (hrn:node:hadronmemory.com:specs:cor:dmo:140:09), so the table sorts and pages nothing itself.
   */
  let { data, form }: { data: PageData; form?: ActionData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}/questions`);
  const appHref = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const filter = $derived(data.filter);
  // A question log read that answers APP_NOT_FOUND says the same thing the question read would.
  const read = $derived(data.logs?.kind === 'not-participant' ? ({ kind: 'not-participant' } as const) : data.questions);
  const rows = $derived<QuestionListRow[]>(read?.kind === 'ok' ? read.value.items : []);
  const total = $derived<number>(read?.kind === 'ok' ? read.value.total : 0);
  const people = $derived<{ id: string; name: string | null; handle: string | null }[]>(data.people.people);

  const STATUS_LABEL = $derived<Record<StatusFilter, string>>({
    pending: t('app.questions.status.pending', 'Pending'),
    answered: t('app.questions.status.answered', 'Answered'),
    all: t('app.questions.status.all', 'All'),
  });
  const SORT_LABEL = $derived<Record<SortKey, string>>({
    priority: t('app.questions.sort.priority', 'Priority'),
    newest: t('app.questions.sort.newest', 'Newest first'),
    oldest: t('app.questions.sort.oldest', 'Oldest first'),
    answered: t('app.questions.sort.answered', 'Recently answered'),
  });
  const PRIORITY_LABEL = $derived<Record<PriorityKey, string>>({
    low: t('app.questions.priority.low', 'Low'),
    normal: t('app.questions.priority.normal', 'Normal'),
    high: t('app.questions.priority.high', 'High'),
    urgent: t('app.questions.priority.urgent', 'Urgent'),
  });
  const PRIORITY_CHOICES = $derived<{ value: string; label: string }[]>([
    { value: '', label: t('app.questions.priority.any', 'Any priority') },
    { value: 'urgent', label: PRIORITY_LABEL.urgent },
    { value: 'high,urgent', label: t('app.questions.priority.high-up', 'High and urgent') },
    { value: 'normal', label: PRIORITY_LABEL.normal },
    { value: 'low', label: PRIORITY_LABEL.low },
  ]);
  const priorityValue = $derived(filter.priority.join(','));
  // A priority list typed into the URL that no choice names still shows, so the select never says "Any" while a filter applies.
  const priorityChoices = $derived(
    PRIORITY_CHOICES.some((c) => c.value === priorityValue)
      ? PRIORITY_CHOICES
      : [...PRIORITY_CHOICES, { value: priorityValue, label: filter.priority.map((p) => PRIORITY_LABEL[p]).join(', ') }],
  );
  // A person is shown by name, else handle, and never by account id (hrn:node:hadronmemory.com:specs:cor:dmo:140:09).
  const personName = (p: { name: string | null; handle: string | null }) => p.name ?? p.handle ?? t('app.questions.person.unnamed', 'Unnamed person');
  // The state labels, built once per render rather than once per row cell.
  const STATE_LABEL = $derived(questionStateLabels());
  const assigneeValue = $derived(filter.assignee.kind === 'user' ? filter.assignee.id : filter.assignee.kind);
  const assigneeUnlisted = $derived.by(() => {
    const a = filter.assignee;
    return a.kind === 'user' && !people.some((p) => p.id === a.id) ? a.id : null;
  });

  const logs = $derived(data.logs?.kind === 'ok' ? data.logs.value : []);
  const setup = $derived(data.setup ?? null);
  const COMMAND_SLOT = '\u0001'; // marks where the command goes in the translated sentence; never shown
  // One translatable sentence with the command as a placeholder, split around it so the command can be set in code style:
  // a translation can reorder or repunctuate it, and the sentence is never stitched from fragments.
  const changeDecidersParts = $derived(t('app.questions.log.change-deciders', 'To change who decides, use {command}.', { command: COMMAND_SLOT }).split(COMMAND_SLOT));
  // After a refused submit the form shows what was chosen, not its defaults.
  const submitted = $derived(form?.createLog?.values ?? null);
  let pickedMemory = $state<string | null>(null);
  const chosenMemory = $derived(setup?.memories?.find((m) => m.id === (pickedMemory ?? submitted?.memoryId)) ?? setup?.memories?.[0] ?? null);
  const everything = $derived(filter.status === 'all' && filter.assignee.kind === 'all' && filter.priority.length === 0);
  const firstPageHref = $derived(questionsHref(basePath, filter, { offset: 0 }));
  const clearHref = $derived(questionsHref(basePath, filter, { status: 'all', assignee: { kind: 'all' }, priority: [], offset: 0 }));

  function actorOf(a: ListAsker | null): { name: string; urn: string | null } | null {
    if (!a) return null;
    // A worker or an App is shown by name with the URN the projection offers; a person by name or handle only.
    if (a.worker) return { name: a.worker.name ?? t('app.questions.worker.unnamed', 'Unnamed worker'), urn: a.worker.urn };
    if (a.user) return { name: personName(a.user as ListPerson), urn: null };
    if (a.app) return { name: a.app.name ?? t('app.questions.app.unnamed', 'Unnamed App'), urn: a.app.urn };
    return null;
  }
  const dateOf = fmtRunTime;
  const priorityText = (p: string | null) => (p ? (PRIORITY_LABEL[p.toLowerCase() as PriorityKey] ?? p) : PRIORITY_LABEL.normal);

  // The server sorts and filters (hrn:node:hadronmemory.com:specs:cor:dmo:140:09): no column sorts or searches this one page.
  const col = (c: PortalColumnDef<QuestionListRow>): PortalColumnDef<QuestionListRow> => ({ ...c, enableSorting: false, enableGlobalFilter: false });
  const columns: PortalColumnDef<QuestionListRow>[] = [
    col({ id: 'code', accessorFn: (r) => r.code, header: t('app.questions.col.code', 'Code'), enableHiding: false, size: 110 }),
    col({ id: 'title', accessorFn: (r) => r.title, header: t('app.questions.col.question', 'Question'), enableHiding: false, size: 340 }),
    col({ id: 'priority', accessorFn: (r) => r.priority ?? '', header: t('app.questions.col.priority', 'Priority'), size: 110 }),
    col({ id: 'state', accessorFn: (r) => r.state, header: t('app.questions.col.status', 'Status'), size: 190 }),
    col({ id: 'for', accessorFn: (r) => (r.effectiveAssignee ? personName(r.effectiveAssignee) : ''), header: t('app.questions.col.for', 'For'), size: 170 }),
    col({ id: 'askedBy', accessorFn: (r) => actorOf(r.askedBy)?.name ?? '', header: t('app.questions.col.asked-by', 'Asked by'), size: 300 }),
    col({ id: 'asked', accessorFn: (r) => r.askedAt ?? '', header: t('app.questions.col.asked', 'Asked'), size: 170 }),
    col({ id: 'answer', accessorFn: (r) => r.answer?.key ?? r.answer?.text ?? '', header: t('app.questions.col.answer', 'Answer'), size: 190 }),
  ];

  const table = createSvelteTable<QuestionListRow>({
    get data() { return rows; },
    columns,
    // The server sorts and pages (hrn:node:hadronmemory.com:specs:cor:dmo:140:09): a client-side sort would reorder this page alone.
    enableSorting: false,
    manualPagination: true,
    manualFiltering: true,
    enableGlobalFilter: false,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    initialState: { pagination: { pageIndex: 0, pageSize: 50 } },
  });
</script>

<svelte:head><title>{t('app.questions.head', 'Questions')} · {data.app.name} · Hadron</title></svelte:head>

<div class="space-y-4">
  <Breadcrumb items={[
    { label: t('app.questions.crumb.apps', 'Apps'), href: appsHref },
    { label: data.app.name, href: appHref },
    { label: t('app.questions.crumb.questions', 'Questions') },
  ]} />

  <h1 class="text-xl font-bold text-zinc-900 dark:text-white">
    <span class="font-normal text-zinc-400">{t('app.questions.title.prefix', 'Questions:')}</span> {data.app.name}
  </h1>

  {#if read?.kind !== 'not-participant'}
    <nav aria-label={t('app.questions.status.label', 'Filter questions by status')} class="flex flex-wrap items-center gap-1.5">
      {#each STATUS_FILTERS as s (s)}
        <a
          href={questionsHref(basePath, filter, { status: s, offset: 0 })}
          aria-current={filter.status === s ? 'page' : undefined}
          class="rounded-full px-2.5 py-1 text-xs font-medium {filter.status === s
            ? 'bg-indigo-600 text-white'
            : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'}"
        >{STATUS_LABEL[s]}</a>
      {/each}
    </nav>

    <form method="GET" action={basePath} class="flex min-w-0 flex-wrap items-end gap-3" aria-label={t('app.questions.form.label', 'Filter and sort questions')}>
      <input type="hidden" name="status" value={filter.status} />
      <div class="min-w-0 basis-60">
        <label for="questions-assignee" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.questions.filter.assignee', 'For')}</label>
        <select id="questions-assignee" name="assignee" value={assigneeValue}
          class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          <option value="me">{t('app.questions.assignee.me', 'Mine and unassigned')}</option>
          <option value="all">{t('app.questions.assignee.all', 'Everyone')}</option>
          {#each people as p (p.id)}<option value={p.id}>{personName(p)}</option>{/each}
          {#if assigneeUnlisted}<option value={assigneeUnlisted}>{assigneeUnlisted}</option>{/if}
        </select>
        {#if data.people.withheld}
          <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{t('app.questions.people.withheld', 'The member list is not shown to you, so only your own and everyone’s questions can be chosen.')}</p>
        {:else if data.people.failed}
          <p class="mt-1 text-xs text-amber-700 dark:text-amber-300">{t('app.questions.people.failed', 'Couldn’t load the members, so they are not listed here.')}</p>
        {/if}
      </div>
      <div class="min-w-0 basis-40">
        <label for="questions-priority" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.questions.filter.priority', 'Priority')}</label>
        <select id="questions-priority" name="priority" value={priorityValue}
          class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          {#each priorityChoices as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
        </select>
      </div>
      <div class="min-w-0 basis-40">
        <label for="questions-sort" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.questions.filter.sort', 'Sort')}</label>
        <select id="questions-sort" name="sort" value={filter.sort}
          class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          {#each SORT_KEYS as s (s)}<option value={s}>{SORT_LABEL[s]}</option>{/each}
        </select>
      </div>
      <!-- A select that submits on change reloads the page once per arrow key (WCAG 3.2.2), so the choice is applied with this button. -->
      <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('app.questions.filter.apply', 'Apply')}</button>
    </form>
  {/if}

  <!-- One live region, always mounted: its content (the count, an empty state, the not-participant note) comes and goes inside it, so a change is announced once (portal#2344). -->
  <LiveRegion class="space-y-1 text-sm text-zinc-600 dark:text-zinc-300">
    {#if read?.kind === 'not-participant'}
      <div data-testid="questions-not-participant" class="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
        <p class="font-medium text-zinc-900 dark:text-white">{t('app.questions.not-participant.title', 'You don’t take part in this App’s questions.')}</p>
        <p class="mt-1 text-zinc-600 dark:text-zinc-400">{t('app.questions.not-participant.body', 'If you should see them, ask the App’s owner to add you.')}</p>
        {#if data.impersonating}
          <p class="mt-2 text-amber-700 dark:text-amber-300">{t('app.questions.not-participant.impersonating', 'You’re viewing as {user}, who doesn’t take part.', { user: data.impersonating })}</p>
        {/if}
      </div>
    {:else if read?.kind === 'ok'}
      {#if rows.length > 0}
        <p>{total === 1 ? t('app.questions.count.one', '1 question') : t('app.questions.count.many', '{n} questions', { n: total })}</p>
      {:else if total > 0}
        <p data-empty="past-end">{t('app.questions.empty.past-end', 'No questions on this page.')} <a href={firstPageHref} class="text-indigo-600 hover:underline dark:text-indigo-300">{t('app.questions.empty.first-page', 'Go to the first page')}</a></p>
      {:else if data.logs?.kind === 'ok' && data.logs.value.length === 0}
        <p data-empty="no-log">{t('app.questions.empty.no-log', 'This App has no question log yet, so its agents cannot ask questions.')}</p>
      {:else if data.logs?.kind === 'ok' && everything}
        <p data-empty="none">{t('app.questions.empty.none', 'No questions have been asked yet.')}</p>
      {:else if data.logs?.kind === 'ok'}
        <p data-empty="no-match">{t('app.questions.empty.no-match', 'No questions match.')} <a href={clearHref} class="text-indigo-600 hover:underline dark:text-indigo-300">{t('app.questions.empty.clear', 'Clear the filters')}</a></p>
      {/if}
    {/if}
  </LiveRegion>

  {#if read?.kind !== 'not-participant' && logs.length > 0}
    <!-- The logs this App's agents ask into: each with its URN and who decides. Changing the deciders stays in the CLI. -->
    <div class="space-y-2">
      {#each logs as l (l.id)}
        <div data-testid="question-log" class="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
          {#if l.portalUrl}<a href={l.portalUrl} class="font-medium text-indigo-600 hover:underline dark:text-indigo-300">{l.name}</a>{:else}<span class="font-medium">{l.name}</span>{/if}
          <div class="mt-1"><Urn value={l.urn} /></div>
          <p class="mt-1 text-zinc-600 dark:text-zinc-300">{l.defaultDeciders.length > 0 ? t('app.questions.log.decided-by', 'Decided by: {names}', { names: l.defaultDeciders.map(personName).join(', ') }) : t('app.questions.log.no-deciders', 'No one is named to decide.')}</p>
        </div>
      {/each}
      <p class="text-xs text-zinc-500 dark:text-zinc-400">{changeDecidersParts[0]}<code class="font-mono">hadron question log set-deciders</code>{changeDecidersParts[1] ?? ''}</p>
    </div>
  {:else if read?.kind !== 'not-participant' && setup}
    <section aria-labelledby="questions-setup-title" class="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <h2 id="questions-setup-title" class="text-base font-semibold text-zinc-900 dark:text-white">{t('app.questions.setup.title', 'Set up questions for this App')}</h2>
      {#if form?.createLog?.error}
        <p role="alert" class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{form.createLog.error}</p>
      {/if}
      {#if data.impersonating}
        <p class="text-sm text-amber-700 dark:text-amber-300">{t('app.questions.setup.impersonating', 'Questions cannot be set up while impersonating.')}</p>
      {:else if setup.memories === null}
        <p role="alert" class="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{t('app.questions.setup.memories-failed', 'Couldn’t load the App’s memories. Reload to try again.')}</p>
      {:else if setup.memories.length === 0}
        <p class="text-sm text-zinc-600 dark:text-zinc-300">{t('app.questions.setup.no-memory', 'This App has no memory that can hold a question log.')}</p>
      {:else}
        <form method="POST" action="?/createQuestionLog" data-testid="question-log-setup" class="space-y-4">
          <div class="min-w-0">
            {#if setup.memories.length === 1}
              <span class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.questions.setup.memory', 'Memory')}</span>
              <input type="hidden" name="memoryId" value={setup.memories[0].id} />
              <span class="[overflow-wrap:anywhere] text-sm text-zinc-900 dark:text-white">{setup.memories[0].name}</span>
              <div class="mt-1"><Urn value={setup.memories[0].urn} /></div>
            {:else}
              <label for="questions-setup-memory" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.questions.setup.memory', 'Memory')}</label>
              <select id="questions-setup-memory" name="memoryId" value={chosenMemory?.id} onchange={(e) => (pickedMemory = e.currentTarget.value)} class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
                {#each setup.memories as m (m.id)}<option value={m.id}>{m.name}</option>{/each}
              </select>
              {#if chosenMemory}<div class="mt-1"><Urn value={chosenMemory.urn} /></div>{/if}
            {/if}
          </div>
          <fieldset class="min-w-0">
            <legend class="mb-1 text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.questions.setup.deciders', 'Who decides')}</legend>
            {#if setup.deciders.fixed}
              {#each setup.deciders.people as p (p.id)}
                <input type="hidden" name="deciders" value={p.id} />
                <p class="text-sm text-zinc-900 dark:text-white">{personName(p)}</p>
              {/each}
            {:else}
              <div class="space-y-1">
                {#each setup.deciders.people as p (p.id)}
                  <div class="flex items-center gap-2">
                    <input id="questions-decider-{p.id}" type="checkbox" name="deciders" value={p.id} checked={submitted ? submitted.deciders.includes(p.id) : p.id === setup.viewer.id} class="h-4 w-4 shrink-0 rounded border-zinc-300" />
                    <label for="questions-decider-{p.id}" class="text-sm text-zinc-900 dark:text-white">{personName(p)}</label>
                  </div>
                {/each}
              </div>
            {/if}
            <p class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{setup.deciders.fixed
              ? t('app.questions.setup.deciders-help-fixed', 'Only you can be named here, because the member list is not shown to you. You need write access to the memory.')
              : t('app.questions.setup.deciders-help', 'Choose at least one. They need write access to the memory.')}</p>
          </fieldset>
          <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('app.questions.setup.submit', 'Create question log')}</button>
        </form>
      {/if}
    </section>
  {/if}

  {#if read?.kind !== 'not-participant'}
    {#if read?.kind === 'failed'}
      <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        {t('app.questions.load-failed', 'Couldn’t load questions. This is a loading failure, not an empty list. Reload to try again.')}
      </div>
    {:else}
      {#if rows.length === 0 && data.logs?.kind === 'failed'}
        <div role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {t('app.questions.logs-failed', 'Couldn’t check whether this App has a question log. Reload to try again.')}
        </div>
      {/if}

      {#if rows.length > 0}
        <DataTable {table} listKey="app-questions:list" showSearch={false} showFooter={false} searchPlaceholder="" searchAriaLabel="">
          {#snippet cell(c, row)}
            {@const asker = actorOf(row.askedBy)}
            {#if c.column.id === 'code'}
              <!-- Plain text: the title is the row's one link, so a keyboard user meets one tab stop per question. -->
              <span class="font-mono">{row.code}</span>
            {:else if c.column.id === 'title'}
              {#if row.portalUrl}<a href={row.portalUrl} title={row.title} class="[overflow-wrap:anywhere] font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.title}</a>{:else}<span class="[overflow-wrap:anywhere] font-medium">{row.title}</span>{/if}
            {:else if c.column.id === 'priority'}
              <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{priorityText(row.priority)}</span>
            {:else if c.column.id === 'state'}
              <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{STATE_LABEL[row.state] ?? row.state}</span>
            {:else if c.column.id === 'for'}
              {#if row.effectiveAssignee}<span class="[overflow-wrap:anywhere]">{personName(row.effectiveAssignee)}</span>
              {:else}<span class="text-zinc-500 dark:text-zinc-400">{t('app.questions.any-decider', 'Any decider')}</span>{/if}
            {:else if c.column.id === 'askedBy'}
              {#if asker}
                <span class="inline-flex min-w-0 flex-col">
                  <span class="[overflow-wrap:anywhere]">{asker.name}</span>
                  {#if asker.urn}<Urn value={asker.urn} />{/if}
                </span>
              {:else}<span class="text-zinc-500">—</span>{/if}
            {:else if c.column.id === 'asked'}
              <span class="text-zinc-500 dark:text-zinc-400">{dateOf(row.askedAt)}</span>
            {:else if c.column.id === 'answer'}
              {#if row.answer}
                <span data-testid="question-answer" class="inline-flex flex-col">
                  <span class="[overflow-wrap:anywhere] font-medium">{row.answer.key ?? t('app.questions.answer.text', 'text')}</span>
                  <span class="text-xs text-zinc-500 dark:text-zinc-400">{dateOf(row.answer.at ?? row.answeredAt)}</span>
                </span>
              {/if}
            {/if}
          {/snippet}
        </DataTable>
      {/if}
      {#if data.navigation && (data.navigation.total > 0 || data.navigation.offset > 0)}
        <ListPageNav page={data.navigation} label={t('app.questions.pages', 'Questions pages')} />
      {/if}
    {/if}
  {/if}
</div>
