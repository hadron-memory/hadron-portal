<script lang="ts">
  import { untrack } from 'svelte';
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
  $effect(() => { if (initial !== snapshot) { snapshot = initial; book = initial; } });
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
  async function reload() {
    const result = await configCall<{ value: Rulebook | null }>({ kind: 'rules', op: 'read', memoryRef });
    book = result.value;
  }
  async function save(input: Record<string, unknown>): Promise<ConfigFailure | null> {
    if (readOnly) return { error: t('config.impersonation', 'This page is read-only while impersonating.') };
    failure = null; notice = '';
    try {
      await configCall({ kind: 'rules', op: editing ? 'update' : 'create', memoryRef, ref: editing?.id, revision: editing?.revision, input });
    } catch (e) { return e as ConfigFailure; }
    notice = t('config.saved', 'Saved.');
    try { await reload(); } catch { failure = { error: t('config.reload-failed', 'Saved, but the rules could not be reloaded. Reload before another change.') }; }
    editing = undefined;
    return null;
  }
  async function rowAction(rule: Rule, op: 'delete' | 'unlock') {
    if (readOnly || busy) return;
    const prompt = op === 'delete' ? t('config.delete-confirm', 'Delete the rule “{role}”?', { role: rule.role }) : t('config.unlock-confirm', 'Unlock “{role}” so it can be edited or deleted? On an org memory only an org admin can unlock it; the server may refuse this action.', { role: rule.role });
    if (!window.confirm(prompt)) return;
    busy = true; failure = null; notice = '';
    try {
      await configCall({ kind: 'rules', op, memoryRef, ref: rule.id, revision: rule.revision });
      notice = op === 'delete' ? t('config.deleted', 'Deleted.') : t('config.unlocked', 'Unlocked.');
      try { await reload(); } catch { failure = { error: t('config.changed-reload-failed', 'The change succeeded, but the rules could not be reloaded. Reload before another change.') }; }
    } catch (e) { failure = e as ConfigFailure; }
    finally { busy = false; }
  }
</script>
{#if book !== null}
  <section class="space-y-4" aria-label={t('config.node-roles', 'Node roles')}>
    <h1 bind:this={heading} tabindex="-1" class="text-2xl font-semibold text-zinc-900 dark:text-white">{t('config.node-roles', 'Node roles')}</h1>
    {#if readOnly}<p>{t('config.impersonation', 'This page is read-only while impersonating.')}</p>
    {:else}<button type="button" onclick={() => editing = null} class="min-h-11 rounded bg-indigo-600 px-4 text-white">{t('config.create-rule', 'Create rule')}</button>{/if}
    {#if notice}<p role="status" class="text-green-700 dark:text-green-300">{notice}</p>{/if}
    {#if failure}<p role="alert" class="text-red-700 dark:text-red-300">{failure.error}</p><button type="button" onclick={async () => { try { await reload(); failure = null; } catch { /* Keep existing truthful failure. */ } }} class="min-h-11 rounded border px-3">{t('config.reload', 'Reload')}</button>{/if}
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
              <button type="button" disabled={busy} onclick={() => editing = r} class="min-h-11 rounded border px-3">{t('config.edit', 'Edit')}</button>
              <button type="button" disabled={busy} onclick={() => rowAction(r, 'delete')} class="min-h-11 rounded border px-3">{t('config.delete', 'Delete')}</button>
            {/if}
          </div>
        {/if}
      {/snippet}
    </DataTable>
    {#if editing !== undefined && !readOnly}
      {#key editorVersion}<RuleEditor fallbackFocus={heading} rule={editing} {memories} {memoriesFailed} oncancel={() => editing = undefined} onsave={save} onreload={async () => {
        const id = editing?.id;
        try { await reload(); editing = book?.rules.find(r => r.id === id); editorVersion++; }
        catch { failure = { error: t('config.reload-kept', 'Could not reload. Your input is kept.') }; }
      }} />{/key}
    {/if}
  </section>
{/if}
