<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import RuleReference from './RuleReference.svelte';
  import RuleEditor from './RuleEditor.svelte';
  import { configCall, type ConfigFailure } from '$lib/memory-config/client';
  import type { Rule, Rulebook } from '$lib/memory-config/types';
  let { initial, memoryRef, readOnly, memories, memoriesFailed = false }: { initial: Rulebook | null; memoryRef: string; readOnly: boolean; memories: { id: string; name: string; urn: string }[]; memoriesFailed?: boolean } = $props();
  let snapshot = untrack(() => initial);
  let book = $state(untrack(() => initial)), editing = $state<Rule | null | undefined>(undefined);
  let editorVersion = $state(0);
  let heading = $state<HTMLHeadingElement>();
  let notice = $state(''), failure = $state<ConfigFailure | null>(null), busy = $state(false);
  // Plain counters are ownership tokens, never deep-proxied response state.
  let alive = true, viewEpoch = 0, intentSequence = 0;
  let busyOwner: object | null = null;
  $effect(() => {
    if (initial !== snapshot) {
      viewEpoch++;
      snapshot = initial; book = initial;
      busyOwner = null; busy = false;
    }
  });
  onDestroy(() => { alive = false; });
  type Owner = { current: () => boolean };
  function beginIntent(editor?: number): Owner {
    const view = viewEpoch, basedOn = initial, intent = ++intentSequence;
    // Every reload caller claims an intent, so later-issued reads (even null/errors) win.
    return { current: () => alive && view === viewEpoch && basedOn === initial && intent === intentSequence && (editor === undefined || editor === editorVersion) };
  }
  function edit(next: Rule | null | undefined) { editorVersion++; editing = next; }
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
  const table = createSvelteTable<Rule>({ get data() { return book?.rules ?? []; }, columns, getRowId: r => r.id ?? r.role, initialState: { sorting: [{ id: 'role', desc: false }] } });
  async function reload(owner: Owner): Promise<ReadResult> {
    if (!owner.current()) return { kind: 'stale' };
    const current = owner.current;
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
    const owner = beginIntent(editorVersion);
    failure = null; notice = '';
    try {
      await configCall({ kind: 'rules', op: editing ? 'update' : 'create', memoryRef, ref: editing?.id, revision: editing?.revision, input });
    } catch (e) { return owner.current() ? e as ConfigFailure : null; }
    if (!owner.current()) return null;
    notice = t('config.saved', 'Saved.');
    const result = await reload(owner);
    // Even an accepted read can lose ownership before this continuation resumes.
    if (result.kind === 'stale' || !result.current()) return null;
    if (result.kind === 'error') failure = { error: t('config.reload-failed', 'Saved, but the rules could not be reloaded. Reload before another change.') };
    edit(undefined);
    return null;
  }
  async function rowAction(rule: Rule, op: 'delete' | 'unlock') {
    if (readOnly || busy) return;
    const prompt = op === 'delete' ? t('config.delete-confirm', 'Delete the rule “{role}”?', { role: rule.role }) : t('config.unlock-confirm', 'Unlock “{role}” so it can be edited or deleted? On an org memory only an org admin can unlock it; the server may refuse this action.', { role: rule.role });
    if (!window.confirm(prompt)) return;
    const owner = beginIntent(), token = {};
    busyOwner = token; busy = true; failure = null; notice = '';
    try {
      await configCall({ kind: 'rules', op, memoryRef, ref: rule.id, revision: rule.revision });
      if (!owner.current()) return;
      notice = op === 'delete' ? t('config.deleted', 'Deleted.') : t('config.unlocked', 'Unlocked.');
      const result = await reload(owner);
      if (result.kind === 'error' && result.current()) failure = { error: t('config.changed-reload-failed', 'The change succeeded, but the rules could not be reloaded. Reload before another change.') };
    } catch (e) { if (owner.current()) failure = e as ConfigFailure; }
    finally { if (busyOwner === token) { busyOwner = null; busy = false; } }
  }
  async function reloadFailure() {
    const result = await reload(beginIntent());
    if (result.kind === 'applied' && result.current()) failure = null;
    // A current error preserves the existing truthful failure; a stale result does nothing.
  }
  async function reloadEditor() {
    const owner = beginIntent(editorVersion), id = editing?.id;
    const result = await reload(owner);
    if (result.kind === 'stale' || !result.current()) return;
    if (result.kind === 'applied') edit(book?.rules.find(r => r.id === id));
    else failure = { error: t('config.reload-kept', 'Could not reload. Your input is kept.') };
  }
</script>
{#if book !== null}
  <section class="space-y-4" aria-label={t('config.node-roles', 'Node roles')}>
    <h1 bind:this={heading} tabindex="-1" class="text-2xl font-semibold text-zinc-900 dark:text-white">{t('config.node-roles', 'Node roles')}</h1>
    {#if readOnly}<p>{t('config.impersonation', 'This page is read-only while impersonating.')}</p>
    {:else}<button type="button" onclick={() => edit(null)} class="min-h-11 rounded bg-indigo-600 px-4 text-white">{t('config.create-rule', 'Create rule')}</button>{/if}
    {#if notice}<p role="status" class="text-green-700 dark:text-green-300">{notice}</p>{/if}
    {#if failure}<p role="alert" class="text-red-700 dark:text-red-300">{failure.error}</p><button type="button" onclick={reloadFailure} class="min-h-11 rounded border px-3">{t('config.reload', 'Reload')}</button>{/if}
    <DataTable {table} listKey="memory-node-role-rules" searchPlaceholder={t('config.search-rules', 'Search rules…')} searchAriaLabel={t('config.search-rules', 'Search rules…')}>
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
