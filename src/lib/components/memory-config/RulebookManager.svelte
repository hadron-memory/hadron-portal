<script lang="ts">
  import { onDestroy, tick, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import { ruleGlobalFilterFn } from '$lib/memory-config/rule-search';
  import type { PortalColumnDef } from '$lib/table/features';
  import RuleReference from './RuleReference.svelte';
  import RuleEditor from './RuleEditor.svelte';
  import { configCall, type ConfigFailure } from '$lib/memory-config/client';
  import type { MemoryConfigWarning, Rule, Rulebook } from '$lib/memory-config/types';
  import { normalizeWarnings, warningSearchText } from '$lib/memory-config/warnings';
  import TaskWarnings from './TaskWarnings.svelte';
  let { initial, memoryRef, readOnly, memories, memoriesFailed = false }: { initial: Rulebook | null; memoryRef: string; readOnly: boolean; memories: { id: string; name: string; urn: string }[]; memoriesFailed?: boolean } = $props();
  let snapshot = untrack(() => initial);
  let book = $state(untrack(() => initial)), editing = $state<Rule | null | undefined>(undefined);
  let editorVersion = $state(0);
  let heading = $state<HTMLHeadingElement>(), feedbackFocus = $state<HTMLElement>();
  let notice = $state(''), warnings = $state<MemoryConfigWarning[]>([]), failure = $state<ConfigFailure | null>(null), busy = $state(false);
  // Plain counters are ownership tokens, never deep-proxied response state.
  // feedbackSequence and warningGeneration bump TOGETHER at every operation
  // start and at the view reset; they diverge only at completions, which bump
  // feedbackSequence alone. beginOperation() makes the start half structural;
  // the view-reset effect keeps the pairing by bumping both.
  let alive = true, viewEpoch = 0, readSequence = 0, feedbackSequence = 0, warningGeneration = 0;
  let busyOwner: object | null = null;
  const currentFailure = (): ConfigFailure | null => failure;
  const announcement = $derived([failure?.error ?? '', notice, ...warnings.map(warningSearchText)].filter(Boolean).join(' '));
  const liveAnnouncement = $derived(editing === undefined ? announcement : '');
  $effect(() => {
    if (initial !== snapshot) {
      viewEpoch++; warningGeneration++; feedbackSequence++;
      snapshot = initial; book = initial; warnings = []; notice = ''; failure = null;
      busyOwner = null; busy = false;
    }
  });
  onDestroy(() => { alive = false; });
  type Owner = { current: () => boolean };
  function ownView(editor?: number): Owner {
    const view = viewEpoch, basedOn = initial;
    return { current: () => alive && view === viewEpoch && basedOn === initial && (editor === undefined || editor === editorVersion) };
  }
  function edit(next: Rule | null | undefined) { editorVersion++; editing = next; }
  // Every operation starts here: both counters advance together and the
  // feedback slate is cleared. Completions bump feedbackSequence alone, so a
  // completion can retire a notice but never a persisted write's advisory.
  function beginOperation(): number {
    feedbackSequence++; warningGeneration++;
    failure = null; notice = ''; warnings = [];
    return warningGeneration;
  }
  type ReadResult = { kind: 'stale' } | { kind: 'applied'; current: () => boolean } | { kind: 'error'; error: ConfigFailure; current: () => boolean };
  beforeNavigate(({ cancel }) => {
    if (editing !== undefined && !window.confirm(t('config.discard-draft', 'Leave this page and discard your unsaved changes?'))) cancel();
  });
  const fields = ['authorTask', 'validationTask', 'descriptionNode'] as const;
  const labels = { authorTask: t('config.author', 'Author task'), validationTask: t('config.validator', 'Validation task'), descriptionNode: t('config.description-node', 'Description node') };
  const columns: PortalColumnDef<Rule>[] = [
    { accessorKey: 'role', header: t('config.role', 'Role / sub-role'), size: 180 },
    { id: 'settings', header: t('config.settings', 'Settings'), size: 250 },
    { id: 'references', header: t('config.references', 'References'), size: 340 },
    { id: 'actions', header: t('config.actions', 'Actions'), size: 220 },
  ];
  let ruleFilter = $state('');
  const table = createSvelteTable<Rule>({ get data() { return book?.rules ?? []; }, columns, getRowId: r => r.id ?? r.role, state: { get globalFilter() { return ruleFilter; } }, onGlobalFilterChange: value => { ruleFilter = typeof value === 'function' ? value(ruleFilter) : value; }, globalFilterFn: ruleGlobalFilterFn, initialState: { sorting: [{ id: 'role', desc: false }] } });
  async function reload(owner: Owner): Promise<ReadResult> {
    if (!owner.current()) return { kind: 'stale' };
    // Only an issued read supersedes an earlier read. A refused mutation has
    // no read outcome and must not retire another operation in this view.
    const read = ++readSequence;
    const current = () => owner.current() && read === readSequence;
    try {
      const result = await configCall<{ value: Rulebook | null }>({ kind: 'rules', op: 'read', memoryRef });
      if (!current()) return { kind: 'stale' };
      book = result.value;
      return { kind: 'applied', current };
    } catch (e) {
      if (!current()) return { kind: 'stale' };
      return { kind: 'error', error: e as ConfigFailure, current };
    }
  }
  async function save(input: Record<string, unknown>): Promise<ConfigFailure | null> {
    if (readOnly) return { error: t('config.impersonation', 'This page is read-only while impersonating.') };
    const owner = ownView(editorVersion);
    // The advisory's own ownership token, captured before any await: operation
    // starts and view resets advance it, another operation's completion never
    // does. A newer operation that STARTS during this save's write retires the
    // advisory even if its completion precedes this save's publication —
    // retirement is ordered by starts, publication by completions.
    const warningEpoch = beginOperation();
    let answer: { warnings?: unknown };
    try {
      answer = await configCall({ kind: 'rules', op: editing ? 'update' : 'create', memoryRef, ref: editing?.id, revision: editing?.revision, input });
    } catch (e) { return owner.current() ? e as ConfigFailure : null; }
    if (!owner.current()) return null;
    // Close the native modal before changing the external live region; while it
    // is open, content outside the dialog is inert and will not be announced.
    const normalizedWarnings = normalizeWarnings(answer?.warnings);
    const result = await reload(owner);
    // Read ordering owns the book; this confirmed write still owns its editor.
    // A newer read cannot strand that editor, while a newer view/session can.
    if (!owner.current()) return null;
    const saveReadFailure = result.kind === 'error' && result.current()
      ? { error: t('config.reload-failed', 'Saved, but the rules could not be reloaded. Reload before another change.') }
      : null;
    const feedback = feedbackSequence;
    edit(undefined);
    const completedView = ownView();
    await tick();
    if (!completedView.current()) return null;
    // Never move focus out of an open editor's modal dialog; the empty-book
    // focus target waits for a view with no editor open.
    if (book === null && editing === undefined) feedbackFocus?.focus();
    const existingFailure = currentFailure();
    if (saveReadFailure) failure = existingFailure
      ? { error: `${existingFailure.error} ${saveReadFailure.error}` }
      : saveReadFailure;
    // Split ownership (#1815): the notice keeps the full outcome guard — a newer
    // row outcome must own it — while the advisory describes a write that already
    // persisted, so another operation's completion must not drop it. Only a newer
    // operation's start or a view reset, which clear the warning slate, retires
    // it. A newer editor merely OPENING retires nothing: the publication lands
    // in state behind the modal and the derived live region announces it when
    // the editor closes (liveAnnouncement is '' only while editing is set), so
    // a persisted write's advisory — and a reload-failure instruction — is
    // deferred, not lost.
    if (feedback === feedbackSequence) { feedbackSequence++; notice = t('config.saved', 'Saved.'); }
    if (warningEpoch === warningGeneration) warnings = normalizedWarnings;
    return null;
  }
  async function rowAction(rule: Rule, op: 'delete' | 'unlock') {
    if (readOnly || busy) return;
    const prompt = op === 'delete' ? t('config.delete-confirm', 'Delete the rule “{role}”?', { role: rule.role }) : t('config.unlock-confirm', 'Unlock “{role}” so it can be edited or deleted? On an org memory only an org admin can unlock it; the server may refuse this action.', { role: rule.role });
    if (!window.confirm(prompt)) return;
    const owner = ownView(), token = {};
    beginOperation();
    busyOwner = token; busy = true;
    try {
      await configCall({ kind: 'rules', op, memoryRef, ref: rule.id, revision: rule.revision });
      if (!owner.current()) return;
      feedbackSequence++; notice = op === 'delete' ? t('config.deleted', 'Deleted.') : t('config.unlocked', 'Unlocked.');
      const result = await reload(owner);
      if (result.kind === 'error' && result.current()) { feedbackSequence++; failure = { error: t('config.changed-reload-failed', 'The change succeeded, but the rules could not be reloaded. Reload before another change.') }; }
    } catch (e) { if (owner.current()) { feedbackSequence++; failure = e as ConfigFailure; } }
    finally { if (busyOwner === token) { busyOwner = null; busy = false; } }
  }
  async function reloadFailure() {
    const feedback = feedbackSequence;
    const result = await reload(ownView());
    if (result.kind === 'applied' && result.current() && feedback === feedbackSequence) failure = null;
    // A current error preserves the existing truthful failure; a stale result does nothing.
  }
  async function reloadEditor() {
    const owner = ownView(editorVersion), id = editing?.id;
    const result = await reload(owner);
    if (result.kind === 'stale' || !result.current()) return undefined;
    if (result.kind === 'applied') {
      edit(book?.rules.find(r => r.id === id));
      if (book === null) { const completedView = ownView(); await tick(); if (completedView.current()) feedbackFocus?.focus(); }
      return null;
    }
    feedbackSequence++;
    return { error: t('config.reload-kept', 'Could not reload. Your input is kept.') };
  }
</script>
{#snippet feedback()}
  {#if failure}<p class="text-red-700 dark:text-red-300">{failure.error}</p>{/if}
  {#if notice}<p class="text-green-700 dark:text-green-300">{notice}</p>{/if}
  {#if warnings.length}<div class="space-y-2"><TaskWarnings {warnings} /></div>{/if}
{/snippet}
<!-- Announce text only: interactive copy controls stay in the shared visual snippet. -->
<div class="sr-only" role="status" data-rule-feedback>{#if !failure}{liveAnnouncement}{/if}</div>
<div class="sr-only" aria-live="assertive" aria-atomic="true" data-rule-failure>{#if failure}{liveAnnouncement}{/if}</div>
<div bind:this={feedbackFocus} data-rule-feedback-visual tabindex="-1" class="space-y-4">
  {@render feedback()}
  {#if failure}<button type="button" onclick={reloadFailure} class="min-h-11 rounded border px-3">{t('config.reload', 'Reload')}</button>{/if}
</div>
{#if book !== null}
  <section class="space-y-4" aria-label={t('config.node-roles', 'Node roles')}>
    <h1 bind:this={heading} tabindex="-1" class="text-2xl font-semibold text-zinc-900 dark:text-white">{t('config.node-roles', 'Node roles')}</h1>
    {#if readOnly}<p>{t('config.impersonation', 'This page is read-only while impersonating.')}</p>
    {:else}<button type="button" onclick={() => edit(null)} class="min-h-11 rounded bg-indigo-600 px-4 text-white">{t('config.create-rule', 'Create rule')}</button>{/if}
    <DataTable {table} listKey="memory-node-role-rules" bind:globalFilter={ruleFilter} searchPlaceholder={t('config.search-rules', 'Search rules…')} searchAriaLabel={t('config.search-rules', 'Search rules…')}>
      {#snippet cell(cell, r)}
        {#if cell.column.id === 'role'}<span class="font-mono">{r.role}</span>
        {:else if cell.column.id === 'settings'}
          <div class="space-y-1 whitespace-normal">
            <p>{r.enabled ? t('config.enabled', 'Enabled') : t('config.disabled', 'Disabled')}</p>
            <p>{t('config.strict-label', 'Strict sub-roles: {value}', { value: r.strictSubRoles ? t('config.yes', 'Yes') : t('config.no', 'No') })}</p>
            <p>{t('config.writers-label', 'Writers: {value}', { value: r.writers })}{#if r.writers === 'OWNER'} — {t('config.owner-note', 'not supported yet; refuses every write when enabled')}{/if}</p>
            <p>{t('config.validate-label', 'Validate by: {value}', { value: r.validateBy ?? t('config.none', 'None') })}</p>
          </div>
        {:else if cell.column.id === 'references'}
          <div class="space-y-3 whitespace-normal">{#each fields as field}<div><p class="font-medium">{labels[field]}</p><RuleReference state={r[`${field}State`]} urn={r[field]} /></div>{/each}</div>
        {:else if cell.column.id === 'actions'}
          <div class="flex flex-col items-start gap-2 whitespace-normal">
            {#if r.locked}
              <p>{t('config.locked', 'Locked by {name}', { name: r.sourceTemplate?.name ?? t('config.template', 'template') })}{#if r.sourceTemplate?.deleted} — {t('config.template-deleted', 'template deleted')}{/if}</p>
              {#if !readOnly}<button type="button" disabled={busy} onclick={() => rowAction(r, 'unlock')} class="min-h-11 rounded border px-3">{t('config.unlock', 'Unlock')}</button>{/if}
            {:else if !readOnly}
              <button type="button" disabled={busy} onclick={() => edit(r)} class="min-h-11 rounded border px-3">{t('config.edit', 'Edit')}</button>
              <button type="button" disabled={busy} onclick={() => rowAction(r, 'delete')} class="min-h-11 rounded border px-3">{t('config.delete', 'Delete')}</button>
            {/if}
          </div>
        {/if}
      {/snippet}
    </DataTable>
    {#if editing !== undefined && !readOnly}
      {#key editorVersion}<RuleEditor fallbackFocus={heading} rule={editing} {memories} {memoriesFailed} oncancel={() => edit(undefined)} onsave={save} onreload={reloadEditor} />{/key}
    {/if}
  </section>
{/if}
