<script lang="ts">
  import { onMount } from 'svelte';
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import ListPageNav from '$lib/components/ListPageNav.svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import { questionStateLabel } from '$lib/questions/labels';
  import type { QuestionActor } from '$lib/questions/types';
  import type { QuestionListRow } from '$lib/server/app-questions';
  import { t } from '$lib/i18n/t';
  import type { PageData } from './$types';
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
   * answers it. Every filter, sort and page is the server's (cor:dmo:140:09), so the table sorts and pages nothing itself.
   */
  let { data }: { data: PageData } = $props();

  const basePath = $derived(`/app/apps/${data.app.id}/questions`);
  const appHref = $derived(`/app/apps/${data.app.id}`);
  const appsHref = $derived(data.app.organizationId ? `/app/orgs/${data.app.organizationId}/apps` : '/app/apps');
  const filter = $derived(data.filter);
  const read = $derived(data.questions);
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
  const personName = (p: { id: string; name: string | null; handle: string | null }) => p.name ?? p.handle ?? p.id;
  const assigneeValue = $derived(filter.assignee.kind === 'user' ? filter.assignee.id : filter.assignee.kind);
  const assigneeUnlisted = $derived.by(() => {
    const a = filter.assignee;
    return a.kind === 'user' && !people.some((p) => p.id === a.id) ? a.id : null;
  });

  const everything = $derived(filter.status === 'all' && filter.assignee.kind === 'all' && filter.priority.length === 0);
  const clearHref = $derived(questionsHref(basePath, filter, { status: 'all', assignee: { kind: 'all' }, priority: [], offset: 0 }));

  // The form submits on change when JavaScript runs; without it the button is the way.
  let enhanced = $state(false);
  onMount(() => { enhanced = true; });

  function actorOf(a: QuestionActor | null) {
    if (!a) return null;
    if (a.worker) return { name: a.worker.name ?? a.worker.handle ?? a.worker.id, urn: (a.worker as { urn?: string | null }).urn ?? null };
    if (a.user) return { name: a.user.name ?? a.user.handle ?? a.user.id, urn: null };
    if (a.app) return { name: a.app.name ?? a.app.handle ?? a.app.id, urn: (a.app as { urn?: string | null }).urn ?? null };
    return null;
  }
  const dateOf = (s: string | null | undefined) => {
    if (!s) return '—';
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
  };
  const priorityText = (p: string | null) => (p ? (PRIORITY_LABEL[p.toLowerCase() as PriorityKey] ?? p) : PRIORITY_LABEL.normal);

  // The server sorts and filters (cor:dmo:140:09): no column sorts or searches this one page.
  const col = (c: PortalColumnDef<QuestionListRow>): PortalColumnDef<QuestionListRow> => ({ ...c, enableSorting: false, enableGlobalFilter: false });
  const columns: PortalColumnDef<QuestionListRow>[] = [
    col({ id: 'code', accessorFn: (r) => r.code, header: t('app.questions.col.code', 'Code'), enableHiding: false, size: 110 }),
    col({ id: 'title', accessorFn: (r) => r.title, header: t('app.questions.col.question', 'Question'), enableHiding: false, size: 340 }),
    col({ id: 'priority', accessorFn: (r) => r.priority ?? '', header: t('app.questions.col.priority', 'Priority'), size: 110 }),
    col({ id: 'state', accessorFn: (r) => r.state, header: t('app.questions.col.status', 'Status'), size: 190 }),
    col({ id: 'for', accessorFn: (r) => r.effectiveAssignee?.name ?? '', header: t('app.questions.col.for', 'For'), size: 170 }),
    col({ id: 'askedBy', accessorFn: (r) => actorOf(r.askedBy)?.name ?? '', header: t('app.questions.col.asked-by', 'Asked by'), size: 300 }),
    col({ id: 'asked', accessorFn: (r) => r.askedAt ?? '', header: t('app.questions.col.asked', 'Asked'), size: 170 }),
    col({ id: 'answer', accessorFn: (r) => r.answer?.key ?? r.answer?.text ?? '', header: t('app.questions.col.answer', 'Answer'), size: 190 }),
  ];

  const table = createSvelteTable<QuestionListRow>({
    get data() { return rows; },
    columns,
    // The server sorts and pages (cor:dmo:140:09): a client-side sort would reorder this page alone.
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
        <select id="questions-assignee" name="assignee" value={assigneeValue} onchange={(e) => enhanced && e.currentTarget.form?.requestSubmit()}
          class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          <option value="me">{t('app.questions.assignee.me', 'Mine and unassigned')}</option>
          <option value="all">{t('app.questions.assignee.all', 'Everyone')}</option>
          {#each people as p (p.id)}<option value={p.id}>{personName(p)}</option>{/each}
          {#if assigneeUnlisted}<option value={assigneeUnlisted}>{assigneeUnlisted}</option>{/if}
        </select>
      </div>
      <div class="min-w-0 basis-40">
        <label for="questions-priority" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.questions.filter.priority', 'Priority')}</label>
        <select id="questions-priority" name="priority" value={priorityValue} onchange={(e) => enhanced && e.currentTarget.form?.requestSubmit()}
          class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          {#each priorityChoices as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
        </select>
      </div>
      <div class="min-w-0 basis-40">
        <label for="questions-sort" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">{t('app.questions.filter.sort', 'Sort')}</label>
        <select id="questions-sort" name="sort" value={filter.sort} onchange={(e) => enhanced && e.currentTarget.form?.requestSubmit()}
          class="w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
          {#each SORT_KEYS as s (s)}<option value={s}>{SORT_LABEL[s]}</option>{/each}
        </select>
      </div>
      {#if !enhanced}
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">{t('app.questions.filter.apply', 'Apply')}</button>
      {/if}
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
      {:else if data.logs?.kind === 'ok' && data.logs.value.length === 0}
        <p data-empty="no-log">{t('app.questions.empty.no-log', 'This App has no question log yet, so its agents cannot ask questions.')}</p>
        <p>{t('app.questions.empty.no-log.cli', 'A manager of one of its memories can create one with the CLI: {command}', { command: 'hadron question log create' })}</p>
      {:else if data.logs?.kind === 'ok' && everything}
        <p data-empty="none">{t('app.questions.empty.none', 'No questions have been asked yet.')}</p>
      {:else if data.logs?.kind === 'ok'}
        <p data-empty="no-match">{t('app.questions.empty.no-match', 'No questions match.')} <a href={clearHref} class="text-indigo-600 hover:underline dark:text-indigo-300">{t('app.questions.empty.clear', 'Clear the filters')}</a></p>
      {/if}
    {/if}
  </LiveRegion>

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
              {#if row.portalUrl}<a href={row.portalUrl} class="font-mono text-indigo-600 hover:underline dark:text-indigo-300">{row.code}</a>{:else}<span class="font-mono">{row.code}</span>{/if}
            {:else if c.column.id === 'title'}
              {#if row.portalUrl}<a href={row.portalUrl} title={row.title} class="[overflow-wrap:anywhere] font-medium text-indigo-600 hover:underline dark:text-indigo-300">{row.title}</a>{:else}<span class="[overflow-wrap:anywhere] font-medium">{row.title}</span>{/if}
            {:else if c.column.id === 'priority'}
              <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{priorityText(row.priority)}</span>
            {:else if c.column.id === 'state'}
              <span class="rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">{questionStateLabel(row.state)}</span>
            {:else if c.column.id === 'for'}
              {#if row.effectiveAssignee}<span class="[overflow-wrap:anywhere]">{row.effectiveAssignee.name ?? row.effectiveAssignee.handle ?? row.effectiveAssignee.id}</span>
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
      {#if data.navigation}
        <ListPageNav page={data.navigation} label={t('app.questions.pages', 'Questions pages')} />
      {/if}
    {/if}
  {/if}
</div>
