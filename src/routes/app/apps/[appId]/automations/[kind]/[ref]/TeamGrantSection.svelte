<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { enhance } from '$app/forms';
  import { onDestroy, tick, untrack } from 'svelte';
  import type { SubmitFunction } from '@sveltejs/kit';
  import Urn from '$lib/components/Urn.svelte';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { formatPortalDate } from '$lib/format-portal-date';
  import { t } from '$lib/i18n/t';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { makeGlobalFilterFn } from '$lib/table/global-filter';
  import type { PortalColumnDef } from '$lib/table/features';
  import { parseTeamGrant, type TeamGrant, type TeamGrantPerson, type TeamGrantRow } from '$lib/automation/team-grant';
  import type { ActionData } from './$types';

  /**
   * portal#1650 — the user wants to decide whether this automation's runs may
   * read the App's team roster and tasks. Everything shown is the server's:
   * the only copy kept is the last re-read, so the control is always the stored
   * one. Only an
   * App manager's read comes back as anything but `hidden`
   * (hrn:node:hadronmemory.com:specs:cor:agt:050:23, rulings:0112 amended).
   * `hidden` still mounts this: a refused write can be what hides the section,
   * and what happened must outlive it, with no heading and no control.
   */
  let { grant, identity, href, form }: {
    grant: TeamGrant;
    /** The automation this page shows, as a scalar. */
    identity: string;
    /** This page, with no query. */
    href: string;
    form: ActionData;
  } = $props();

  let submitting = $state(false);
  let outcome = $state<HTMLElement>();
  /** The submit this control is waiting on. Any other submit's answer has no say here. */
  let attempt: object | null = null;
  /** The stored state as re-read after a write. Any later load of the page replaces it. */
  let reread = $state.raw<{ against: TeamGrant; grant: TeamGrant } | null>(null);
  const shown = $derived(reread?.against === grant ? reread.grant : grant);
  /** A write's re-read failed, so what's on the page may be behind. */
  let unread = $state(false);
  // The page component is reused for the next automation: a write in flight belongs to this one.
  $effect.pre(() => {
    void identity;
    untrack(() => { attempt = null; submitting = false; });
  });
  // A stored state arrived, so nothing on the page is behind any more.
  $effect.pre(() => {
    void grant;
    untrack(() => { unread = false; });
  });
  onDestroy(() => { attempt = null; });

  const live = $derived(shown.status === 'ready' ? shown.live : null);
  const ended = $derived(shown.status === 'ready' ? shown.ended : null);
  const someone = () => t('app.automations.team.someone', 'a person not visible to you');

  async function readStored(): Promise<TeamGrant | null> {
    try {
      const res = await fetch(`${href}/team-grant${ended === null ? '' : '?ended=1'}`);
      return res.ok ? parseTeamGrant(await res.json()) : null;
    } catch (e) {
      console.warn('[automation-team-grant] re-read after a write failed:', e);
      return null;
    }
  }

  // Kit applies an answer only after its own re-read, which can't be fenced and
  // puts a failure on the error page. So it applies the answer now, while this
  // submit owns the page, and the section re-reads for itself. A refused write
  // re-reads too: it may mean the stored state moved.
  const submitted: SubmitFunction = () => {
    const mine = {};
    attempt = mine;
    submitting = true;
    unread = false;
    return async ({ result, update }) => {
      if (attempt !== mine) return;
      const applied = await update({ reset: false, invalidateAll: false }).then(() => true, (e) => {
        console.warn('[automation-team-grant] applying the answer failed:', e);
        return false;
      });
      if (attempt !== mine) return;
      if (!applied) unread = true;
      else if (result.type === 'success' || result.type === 'failure') {
        const against = grant;
        const stored = await readStored();
        if (attempt !== mine) return;
        if (stored) reread = { against, grant: stored };
        else unread = true;
      }
      attempt = null;
      submitting = false;
      await tick();
      if (attempt === null) outcome?.focus();
    };
  };

  const hasOutcome = $derived(Boolean(form?.teamGrantRefused || form?.teamGrant || unread));

  type Row = TeamGrantRow & { givenByText: string; endedByText: string; givenMs: number; endedMs: number };
  const rows = $derived<Row[]>((ended ?? []).map((g) => ({
    ...g,
    givenByText: g.givenBy?.name ?? someone(),
    endedByText: g.endedBy?.name ?? someone(),
    givenMs: new Date(g.createdAt).getTime(),
    endedMs: g.revokedAt ? new Date(g.revokedAt).getTime() : 0,
  })));
  let globalFilter = $state('');
  const columns: PortalColumnDef<Row>[] = [
    { id: 'givenBy', accessorFn: (r) => r.givenByText, header: t('app.automations.team.col.given-by', 'Given by'), enableHiding: false, size: 220 },
    { id: 'given', accessorFn: (r) => r.givenMs, header: t('app.automations.team.col.given', 'Given'), size: 130 },
    { id: 'endedBy', accessorFn: (r) => r.endedByText, header: t('app.automations.team.col.ended-by', 'Ended by'), size: 220 },
    { id: 'ended', accessorFn: (r) => r.endedMs, header: t('app.automations.team.col.ended', 'Ended'), size: 130 },
  ];
  const fmtMs = (v: unknown) => (typeof v === 'number' && v > 0 ? formatPortalDate(new Date(v).toISOString()) : '');
  const table = createSvelteTable<Row>({
    get data() { return rows; },
    columns,
    enableMultiSort: false,
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    state: { get globalFilter() { return globalFilter; } },
    onGlobalFilterChange: (u) => { globalFilter = typeof u === 'function' ? u(globalFilter) : u; },
    globalFilterFn: makeGlobalFilterFn<Row>({ given: fmtMs, ended: fmtMs }),
    initialState: { pagination: { pageIndex: 0, pageSize: 20 }, sorting: [{ id: 'ended', desc: true }] },
  });
</script>

{#snippet person(p: TeamGrantPerson | null, text: string)}
  <div class="flex min-w-0 flex-col">
    <span class="truncate">{text}</span>
    {#if p?.urn}<span class="mt-1"><Urn value={p.urn} type="user" size={9} compact /></span>{/if}
  </div>
{/snippet}

{#snippet outcomeRegion()}
  <div bind:this={outcome} tabindex="-1" data-testid="team-grant-outcome" class="space-y-2 outline-none">
    <LiveRegion>
      {#if !form?.teamGrantRefused}
        {#if form?.teamGrant === 'given'}
          <p class="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">{t('app.automations.team.given-done', 'Given.')}</p>
        {:else if form?.teamGrant === 'stopped'}
          <p class="rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">{t('app.automations.team.stopped-done', 'Stopped.')}</p>
        {/if}
      {/if}
    </LiveRegion>
    {#if form?.teamGrantRefused}
      <p role="alert" class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300">{form.teamGrantMessage || t('app.automations.refused', 'The server refused this action.')}</p>
    {/if}
    <LiveRegion>
      {#if unread}
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.automations.team.unread', "This page couldn't be refreshed, so what it shows may be out of date. Reload the page to check.")}</p>
      {/if}
    </LiveRegion>
  </div>
{/snippet}

{#if shown.status === 'hidden'}
  {#if hasOutcome}{@render outcomeRegion()}{/if}
{:else}
<section class="space-y-2 border-t border-zinc-200 pt-4 dark:border-zinc-800" aria-labelledby="auto-team">
  <h2 id="auto-team" class="text-sm font-semibold text-zinc-900 dark:text-white">{t('app.automations.team.heading', 'Team roster and tasks')}</h2>
  <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.automations.team.line', "Let this automation's runs read this App's team roster and tasks. Read-only, this App only.")}</p>

  {@render outcomeRegion()}

  <LiveRegion>
    {#if shown.status === 'unavailable'}
      <p data-testid="team-grant-unavailable" class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.automations.team.unavailable', "This couldn't be read. Reload the page to try again.")}</p>
    {/if}
  </LiveRegion>
  {#if shown.status === 'unavailable'}
    <!-- announced by the region above -->
  {:else}
    {#if live}
      <div class="text-sm text-zinc-700 dark:text-zinc-300">
        <p>{t('app.automations.team.given', 'Given by {name} on {date}.', { name: live.givenBy?.name ?? someone(), date: formatPortalDate(live.createdAt) })}</p>
        {#if live.givenBy?.urn}<div class="mt-1"><Urn value={live.givenBy.urn} type="user" size={9} compact /></div>{/if}
      </div>
      <form method="POST" action="?/stop" use:enhance={submitted} class="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={submitting} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200">{t('app.automations.team.stop', 'Stop')}</button>
        <span class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.automations.team.stop-note', 'Stopping ends this grant. You can give it again, which makes a new grant.')}</span>
      </form>
    {:else}
      <p class="text-sm text-zinc-700 dark:text-zinc-300">{t('app.automations.team.not-given', 'Not given.')}</p>
      <form method="POST" action="?/give" use:enhance={submitted}>
        <button type="submit" disabled={submitting} class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-800 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200">{t('app.automations.team.give', 'Give')}</button>
      </form>
    {/if}

    {#if ended === null}
      <a href="{href}?ended=1" data-sveltekit-noscroll class="inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-300">{t('app.automations.team.show-ended', 'Show ended')}</a>
    {:else}
      <a {href} data-sveltekit-noscroll class="inline-block text-sm text-indigo-600 hover:underline dark:text-indigo-300">{t('app.automations.team.hide-ended', 'Hide ended')}</a>
      {#if ended.length === 0}
        <p class="text-sm text-zinc-500 dark:text-zinc-400">{t('app.automations.team.none-ended', 'No ended grants.')}</p>
      {:else}
        <div data-testid="team-grant-ended">
          <DataTable
            {table}
            listKey="automation:team-grants-ended"
            searchPlaceholder={t('app.automations.team.search', 'Search ended grants…')}
            searchAriaLabel={t('app.automations.team.search', 'Search ended grants…')}
            bind:globalFilter
          >
            {#snippet cell(cell, row)}
              {#if cell.column.id === 'givenBy'}
                {@render person(row.givenBy, row.givenByText)}
              {:else if cell.column.id === 'given'}
                <time datetime={row.createdAt} class="whitespace-nowrap">{formatPortalDate(row.createdAt)}</time>
              {:else if cell.column.id === 'endedBy'}
                {@render person(row.endedBy, row.endedByText)}
              {:else if cell.column.id === 'ended'}
                <time datetime={row.revokedAt} class="whitespace-nowrap">{formatPortalDate(row.revokedAt)}</time>
              {/if}
            {/snippet}
          </DataTable>
        </div>
      {/if}
    {/if}
  {/if}
</section>
{/if}
