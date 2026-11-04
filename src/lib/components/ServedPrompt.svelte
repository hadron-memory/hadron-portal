<!--
  portal#1665: what a bind, a run or a chat was GIVEN, read-only (hrn:node:hadronmemory.com:specs:cor:agt:040:03).

  A served record names ids, revisions, hashes and the recorded variables. It never carries
  text, so this view never shows or fetches any: not the prompt, not a provenance entry's source.

  Honest states, by construction:
    - An empty or null answer renders NO section and no "no records" text. It means "nothing you
      may read" (the provider conceals), never "there is none".
    - A failed read renders "Couldn't load the served prompt." It is never shown as empty.
    - Null lint renders "Warnings unavailable", never "no warnings".
    - Names come only from an independent read the endpoint made as the viewer; a missing name
      shows nothing, and nothing is inferred from the record's ids or hashes.

  Reused across worker/session/run/chat hosts, so a host that switches its subject (worker A to
  worker B, one chat to another) must never show the earlier subject's records: every response
  is dropped unless the subject and the generation it was asked under are still current.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import Urn from '$lib/components/Urn.svelte';
  import { t } from '$lib/i18n/t';
  import {
    POINTER_LEVEL_LABEL,
    hasMore,
    pageRange,
    type ServedLintWarning,
    type ServedPromptSource,
    type ServedPromptView,
    type ServedPromptsResponse,
  } from '$lib/served-prompts';

  let {
    source,
    refId = null,
    agentId = null,
    chatId = null,
    collapsible = false,
    fetchImpl = undefined,
  }: {
    source: ServedPromptSource;
    /** Worker ref, session id or run id. */
    refId?: string | null;
    /** Chat only: the Agent and the chat loc the panel already holds. Never a record id. */
    agentId?: string | null;
    chatId?: string | null;
    /** Wrap the records in a closed <details> that appears only when there is something to show. */
    collapsible?: boolean;
    fetchImpl?: typeof fetch;
  } = $props();

  type Extra = {
    provenance?: ServedPromptView['provenance'];
    lintItems?: ServedLintWarning[];
    lintCursor?: string | null;
    lintUnavailable?: boolean;
    lintTotal?: number;
    busy?: 'provenance' | 'lint';
    failed?: 'provenance' | 'lint';
  };

  let phase = $state<'loading' | 'failed' | 'ok'>('loading');
  let page = $state.raw<ServedPromptsResponse | null>(null);
  let extra = $state<Record<string, Extra>>({});

  // Everything that identifies the subject. A change drops every in-flight response.
  const subject = $derived(`${source}\u0000${refId ?? ''}\u0000${agentId ?? ''}\u0000${chatId ?? ''}`);
  let generation = 0;
  let controller: AbortController | null = null;

  function query(offset: number, limit: number, more: Record<string, string | number | null> = {}): string {
    const q = new URLSearchParams({ source, offset: String(offset), limit: String(limit) });
    if (source === 'chat') {
      if (agentId) q.set('agentId', agentId);
      if (chatId) q.set('chatId', chatId);
    } else if (refId) {
      q.set('ref', refId);
    }
    for (const [k, v] of Object.entries(more)) if (v !== null) q.set(k, String(v));
    return q.toString();
  }

  async function get(qs: string, signal: AbortSignal): Promise<ServedPromptsResponse> {
    const res = await (fetchImpl ?? fetch)(`/api/served-prompts?${qs}`, { signal });
    if (!res.ok) throw new Error(`served-prompts ${res.status}`);
    return (await res.json()) as ServedPromptsResponse;
  }

  /** Load one record page. Drops its own result unless the subject and generation are still current. */
  async function load(offset: number) {
    const mine = ++generation;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    // Paging keeps the page that is up (an open <details> must not close under the reader);
    // only the first load of a subject shows the loading state.
    if (page === null) phase = 'loading';
    try {
      const res = await get(query(offset, 5), signal);
      if (mine !== generation) return;
      if (res.items.length === 0 && offset > 0 && res.total > 0) {
        // The list shrank under the pager: start over rather than show an empty page as the answer.
        void load(0);
        return;
      }
      page = res;
      extra = {};
      phase = 'ok';
    } catch {
      if (mine !== generation) return;
      page = null;
      phase = 'failed';
    }
  }

  // A new subject resets everything first, then loads. Reads of `subject` only: the writes are untracked.
  $effect(() => {
    void subject;
    untrack(() => {
      page = null;
      extra = {};
      void load(0);
    });
    return () => {
      generation++;
      controller?.abort();
    };
  });

  /**
   * One record's nested page: asked as a page of ONE record at its absolute index, so the siblings are
   * never re-paged. If the record at that index is no longer this one the list moved: reload instead.
   */
  async function nested(record: ServedPromptView, index: number, kind: 'provenance' | 'lint', more: Record<string, string | number | null>) {
    const mine = generation;
    const signal = (controller ??= new AbortController()).signal;
    extra[record.id] = { ...extra[record.id], busy: kind, failed: undefined };
    try {
      const res = await get(query(index, 1, more), signal);
      if (mine !== generation) return;
      const row = res.items[0];
      if (!row || row.id !== record.id) {
        void load(page?.offset ?? 0);
        return;
      }
      const prev = extra[record.id] ?? {};
      if (kind === 'provenance') {
        extra[record.id] = { ...prev, provenance: row.provenance, busy: undefined };
      } else {
        // A later page answered "unavailable": say so instead of leaving the earlier warnings up.
        extra[record.id] = row.lint === null
          ? { ...prev, lintItems: [], lintCursor: null, lintUnavailable: true, busy: undefined }
          : {
              ...prev,
              lintItems: [...(prev.lintItems ?? record.lint?.items ?? []), ...row.lint.items],
              lintCursor: row.lint.nextCursor,
              lintTotal: row.lint.total,
              busy: undefined,
            };
      }
    } catch {
      if (mine !== generation) return;
      extra[record.id] = { ...extra[record.id], busy: undefined, failed: kind };
    }
  }

  const KIND_LABEL: Record<ServedPromptView['kind'], string> = {
    BIND: t('served.kind.bind', 'Bind'),
    CHAT: t('served.kind.chat', 'Chat'),
    RUN: t('served.kind.run', 'Run'),
  };

  const LINT_LABEL: Record<string, string> = {
    BROKEN_INCLUDE: t('served.lint.broken-include', 'An include is broken or unreadable'),
    NO_QUALIFYING_REVISION: t('served.lint.no-qualifying-revision', 'An include has no revision that meets its settings'),
    PINNED_NEWER_APPROVED: t('served.lint.pinned-newer-approved', 'A pinned include has a newer approved revision'),
    POLICY_OVERRIDE: t('served.lint.policy-override', 'An install-memory node replaces an Agent node'),
    RECOMPILE_AVAILABLE: t('served.lint.recompile-available', 'A recompile would select a newer revision'),
    RETIRED_TARGET: t('served.lint.retired-target', 'An include’s target was deleted'),
    SIGNING_NOT_CHECKED: t('served.lint.signing-not-checked', 'An include asks for signed; signing is not checked yet'),
    WORKER_LINK_MISSING: t('served.lint.worker-link-missing', 'A worker signature or trailer does not carry the worker link'),
  };

  function fmtDate(value: string): string {
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? value : new Date(ms).toLocaleString();
  }

  /** The recorded model source, as a label: never a verified model. */
  function modelSource(variables: unknown): string | null {
    // The server records flat dotted keys (hadron-server resolvers.mutation.chat.ts), not a nested object.
    const source = (variables as Record<string, unknown> | null)?.['session.llmModel.source'];
    if (source === undefined) return null;
    return source === 'client-reported'
      ? t('served.model.client-reported', 'client-reported')
      : t('served.model.unspecified', 'unspecified');
  }

  const btn =
    'rounded-md border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800';
</script>

{#if phase === 'loading'}
  <!-- A collapsible host (the chat panel) shows nothing while it waits: most readers get an empty answer. -->
  <p role="status" class="text-sm text-zinc-500 {collapsible ? 'sr-only' : ''}" data-testid="served-prompt-loading">
    {t('served.loading', 'Loading the served prompt…')}
  </p>
{:else if phase === 'failed'}
  <div role="alert" class="flex flex-wrap items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200" data-testid="served-prompt-failed">
    <span>{t('served.failed', 'Couldn’t load the served prompt.')}</span>
    <button type="button" class={btn} onclick={() => load(page?.offset ?? 0)}>{t('served.retry', 'Try again')}</button>
  </div>
{:else if page && page.items.length > 0}
  {@const current = page}
  {#if collapsible}
    <details class="rounded-lg" data-testid="served-prompt-details">
      <summary class="cursor-pointer text-sm font-medium text-zinc-700 dark:text-zinc-200">{t('served.section', 'Served prompt')}</summary>
      <div class="mt-3">{@render records(current)}</div>
    </details>
  {:else}
    {@render records(current)}
  {/if}
{/if}

{#snippet records(current: ServedPromptsResponse)}
  <section class="space-y-4" data-testid="served-prompt" aria-label={t('served.section', 'Served prompt')}>
    {#if !collapsible}
      <h2 class="font-semibold text-zinc-900 dark:text-white">{t('served.section', 'Served prompt')}</h2>
    {/if}
    {#each current.items as record, i (record.id)}
      {@const ex = extra[record.id] ?? {}}
      {@const prov = ex.provenance ?? record.provenance}
      {@const lintItems = ex.lintItems ?? record.lint?.items ?? []}
      {@const lintCursor = ex.lintItems ? (ex.lintCursor ?? null) : (record.lint?.nextCursor ?? null)}
      {@const index = current.offset + i}
      {@const model = modelSource(record.variables)}
      <article class="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900" data-testid="served-record">
        <header class="space-y-1">
          <h3 class="text-sm font-semibold text-zinc-900 dark:text-white">
            {t('served.record.title', '{kind} · served {when}', { kind: KIND_LABEL[record.kind], when: fmtDate(record.servedAt) })}
          </h3>
          {#if record.node}
            <p class="text-sm text-zinc-700 dark:text-zinc-200" data-testid="served-node">
              <span>{record.node.name}</span>
              <Urn value={record.node.urn} type="node" />
            </p>
          {/if}
        </header>

        <dl class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt class="text-zinc-500">{t('served.pointer', 'Chosen at')}</dt>
          <dd>{POINTER_LEVEL_LABEL[record.pointerLevel]}</dd>
          <dt class="text-zinc-500">{t('served.revision', 'Revision served')}</dt>
          <dd>{record.servedRevSeq}</dd>
          {#if record.kind === 'CHAT'}
            <dt class="text-zinc-500">{t('served.ordinal', 'Record')}</dt>
            <dd>{record.ordinal}</dd>
          {/if}
          <dt class="text-zinc-500">{t('served.hash', 'Content hash')}</dt>
          <dd class="break-all font-mono text-xs">{record.compiledContentHash}</dd>
        </dl>

        {#if record.pruned}
          <p class="text-sm text-amber-700 dark:text-amber-300" data-testid="served-pruned">
            {t('served.pruned', 'This revision is no longer kept.')}
          </p>
        {/if}

        <div data-testid="served-variables">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('served.variables', 'Values when served')}</h4>
          {#if model}
            <p class="text-xs text-zinc-500">{t('served.model', 'Model: {source}', { source: model })}</p>
          {/if}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <pre tabindex="0" aria-label={t('served.variables.aria', 'Values recorded when this prompt was served')} class="mt-1 max-h-48 overflow-auto rounded-md bg-zinc-50 p-2 text-xs dark:bg-zinc-950">{JSON.stringify(record.variables, null, 2)}</pre>
        </div>

        {#if prov.items.length > 0}
        <div data-testid="served-provenance">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('served.provenance', 'Provenance')}</h4>
          {#if prov.items.length > 0}
            <ul class="mt-1 space-y-1 text-xs">
              {#each prov.items as entry, pi (pi)}
                <li class="flex flex-wrap gap-x-3">
                  <span>{t('served.prov.rev', 'rev {n}', { n: entry.revSeq })}</span>
                  <span class="break-all font-mono text-zinc-500">{entry.hash}</span>
                  {#if entry.pruned}<span class="text-amber-700 dark:text-amber-300">{t('served.prov.pruned', 'no longer kept')}</span>{/if}
                </li>
              {/each}
            </ul>
            <div class="mt-2 flex items-center gap-2 text-xs text-zinc-500">
              <span data-testid="served-prov-range">{pageRange(prov.offset, prov.items.length, prov.total)}</span>
              {#if prov.offset > 0}
                <button type="button" class={btn} disabled={ex.busy === 'provenance'} onclick={() => nested(record, index, 'provenance', { provOffset: Math.max(0, prov.offset - 20) })}>{t('served.previous', 'Previous')}</button>
              {/if}
              {#if hasMore(prov.offset, prov.items.length, prov.total)}
                <button type="button" class={btn} disabled={ex.busy === 'provenance'} onclick={() => nested(record, index, 'provenance', { provOffset: prov.offset + prov.items.length })}>{t('served.next', 'Next')}</button>
              {/if}
            </div>
          {/if}
          {#if ex.failed === 'provenance'}
            <p role="alert" class="mt-1 text-xs text-red-700 dark:text-red-300">{t('served.failed.more', 'Couldn’t load more. Try again.')}</p>
          {/if}
        </div>
        {/if}

        <div data-testid="served-lint">
          <h4 class="text-xs font-semibold uppercase tracking-wide text-zinc-500">{t('served.lint', 'Current warnings')}</h4>
          {#if record.lint === null || ex.lintUnavailable}
            <p class="text-xs text-zinc-500">{t('served.lint.unavailable', 'Warnings unavailable')}</p>
          {:else}
            <p class="text-xs text-zinc-500">{t('served.lint.caption', 'Warnings that hold now for this revision, not when it was served.')}</p>
            {#if lintItems.length === 0}
              <p class="text-xs text-zinc-500">{t('served.lint.none', 'No current warnings')}</p>
            {:else}
              <ul class="mt-1 space-y-1 text-xs">
                {#each lintItems as w, wi (wi)}
                  <li>
                    <span>{LINT_LABEL[w.kind] ?? w.kind}</span>
                    <span class="text-zinc-500">{t('served.lint.position', '(position {n})', { n: w.position })}</span>
                    {#if w.targetUrn}<Urn value={w.targetUrn} type="node" />{/if}
                  </li>
                {/each}
              </ul>
              <p class="mt-1 text-xs text-zinc-500" data-testid="served-lint-count">
                {t('served.lint.count', '{n} of {total}', { n: lintItems.length, total: ex.lintTotal ?? record.lint.total })}
              </p>
            {/if}
            {#if lintCursor}
              <button type="button" class="{btn} mt-1" disabled={ex.busy === 'lint'} onclick={() => nested(record, index, 'lint', { lintAfter: lintCursor })}>{t('served.lint.more', 'Show more')}</button>
            {/if}
          {/if}
          {#if ex.failed === 'lint'}
            <p role="alert" class="mt-1 text-xs text-red-700 dark:text-red-300">{t('served.failed.more', 'Couldn’t load more. Try again.')}</p>
          {/if}
        </div>
      </article>
    {/each}

    {#if current.total > current.items.length}
      <div class="flex items-center gap-2 text-xs text-zinc-500">
        <span data-testid="served-range">{pageRange(current.offset, current.items.length, current.total)}</span>
        {#if current.offset > 0}
          <button type="button" class={btn} onclick={() => load(Math.max(0, current.offset - 5))}>{t('served.previous', 'Previous')}</button>
        {/if}
        {#if hasMore(current.offset, current.items.length, current.total)}
          <button type="button" class={btn} onclick={() => load(current.offset + current.items.length)}>{t('served.next', 'Next')}</button>
        {/if}
      </div>
    {/if}
  </section>
{/snippet}
