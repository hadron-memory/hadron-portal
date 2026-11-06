<script lang="ts">
  import { untrack } from 'svelte';
  import { beforeNavigate } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import DataTable from '$lib/components/table/DataTable.svelte';
  import { createSvelteTable } from '$lib/table/createSvelteTable.svelte';
  import type { PortalColumnDef } from '$lib/table/features';
  import Urn from '$lib/components/Urn.svelte';
  import SelectMemory from '$lib/components/SelectMemory.svelte';
  import RuleEditor from './RuleEditor.svelte';
  import RuleReference from './RuleReference.svelte';
  import { configCall, type ConfigFailure } from '$lib/memory-config/client';
  import type { Rule, Template, OwnerType, ApplyPreview } from '$lib/memory-config/types';
  let { initial, ownerType, ownerRef, readOnly, canManage, memories, memoriesFailed }: { initial: Template[]; ownerType: OwnerType; ownerRef: string; readOnly: boolean; canManage: boolean; memories: { id: string; name: string; urn: string }[]; memoriesFailed: boolean } = $props();
  let snapshot = untrack(() => initial);
  let templates = $state(untrack(() => initial)), editing = $state<Template | null | undefined>(undefined);
  let nameInput = $state<HTMLInputElement>();
  let heading = $state<HTMLHeadingElement>();
  const uid = $props.id();
  const formId = `${uid}-template-form`;
  const fields = ['authorTask', 'validationTask', 'descriptionNode'] as const;
  const labels = { authorTask: t('config.author', 'Author task'), validationTask: t('config.validator', 'Validation task'), descriptionNode: t('config.description-node', 'Description node') };
  let name = $state(''), description = $state(''), required = $state(false), rules = $state<Rule[]>([]), rulesChanged = $state(false);
  let ruleIndex = $state<number | null>(null), pending = $state(false), failure = $state<ConfigFailure | null>(null), notice = $state('');
  let chosen = $state<Template | null>(null), memory = $state<{ id: string; name: string; urn: string } | null>(null), memoryPicker = $state(false);
  let preview = $state<ApplyPreview | null>(null), previewStale = $state(false);
  $effect(() => { if (initial !== snapshot) { snapshot = initial; templates = initial; chosen = null; preview = null; } });
  beforeNavigate(({ cancel }) => {
    if ((editing !== undefined || ruleIndex !== null || pending) && !window.confirm(pending ? t('config.leave-pending', 'An operation is still running. Leave this page? Leaving does not cancel it.') : t('config.discard-draft', 'Leave this page and discard your unsaved changes?'))) cancel();
  });
  $effect(() => { if (editing !== undefined && nameInput?.isConnected) nameInput.focus(); });
  const writable = $derived(canManage && !readOnly);
  const columns: PortalColumnDef<Template>[] = [{ accessorKey: 'name', header: t('config.name', 'Name'), size: 220 }, { accessorKey: 'description', header: t('config.description', 'Description'), size: 260 }, { accessorKey: 'required', header: t('config.required', 'Required'), size: 100 }, { id: 'actions', header: t('config.actions', 'Actions'), size: 240 }];
  const table = createSvelteTable<Template>({ get data() { return templates; }, columns, getRowId: r => r.id });
  const ruleColumns: PortalColumnDef<Rule>[] = [{ accessorKey: 'role', header: t('config.role', 'Role / sub-role'), size: 160 }, { id: 'settings', header: t('config.settings', 'Settings'), size: 220 }, { id: 'references', header: t('config.references', 'References'), size: 300 }, { id: 'actions', header: t('config.actions', 'Actions'), size: 160 }];
  const ruleTable = createSvelteTable<Rule>({ get data() { return rules; }, columns: ruleColumns, getRowId: r => r.role, initialState: { sorting: [{ id: 'role', desc: false }] } });
  const previewColumns: PortalColumnDef<ApplyPreview['entries'][number]>[] = [{ accessorKey: 'role', header: t('config.role', 'Role / sub-role'), size: 120 }, { accessorKey: 'outcome', header: t('config.outcome', 'Outcome'), size: 140 }];
  const previewTable = createSvelteTable<ApplyPreview['entries'][number]>({ get data() { return preview?.entries ?? []; }, columns: previewColumns });
  function edit(template: Template | null) {
    editing = template; name = template?.name ?? ''; description = template?.description ?? ''; required = template?.required ?? false;
    rules = (template?.rules ?? []).map(rule => ({ ...rule })); rulesChanged = false; failure = null; notice = ''; chosen = null; preview = null;
  }
  async function reload() { templates = (await configCall<{ value: Template[] }>({ kind: 'templates', op: 'read', ownerType, ownerRef })).value; }
  function ruleInput(rule: Rule): Record<string, unknown> {
    const input: Record<string, unknown> = { role: rule.role, enabled: rule.enabled, strictSubRoles: rule.strictSubRoles, writers: rule.writers, validateBy: rule.validateBy };
    for (const field of ['authorTask', 'validationTask', 'descriptionNode'] as const) {
      if (rule[`${field}State`] === 'UNREADABLE' || rule[`${field}State`] === 'BROKEN') throw { error: t('config.reselect', 'Choose or clear the unavailable references for rule “{role}” before replacing its template rules.', { role: rule.role }) };
      input[`${field}Ref`] = rule[`${field}State`] === 'OK' ? rule[`${field}Id`] ?? rule[field] : null;
    }
    return input;
  }
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (!writable || pending) return;
    pending = true; failure = null; notice = '';
    try {
      const input = { name, description: description || null, required, ...(!editing || rulesChanged ? { rules: rules.map(ruleInput) } : {}) };
      await configCall({ kind: 'templates', op: editing ? 'update' : 'create', ownerType, ownerRef, ref: editing?.id, revision: editing?.revision, input });
      editing = undefined; notice = t('config.saved', 'Saved.');
      try { await reload(); } catch { failure = { error: t('config.template-reload-failed', 'Saved, but the templates could not be reloaded.') }; }
    } catch (e) { failure = e as ConfigFailure; }
    finally { pending = false; }
  }
  async function remove(template: Template) {
    if (!writable || pending || !window.confirm(t('config.template-delete-confirm', 'Delete template “{name}”? Rules already copied into memories remain.', { name: template.name }))) return;
    pending = true; failure = null;
    try {
      await configCall({ kind: 'templates', op: 'delete', ownerType, ownerRef, ref: template.id, revision: template.revision });
      templates = templates.filter(t => t.id !== template.id);
      notice = t('config.deleted', 'Deleted.');
      try { await reload(); }
      catch { failure = { error: t('config.deleted-reload-failed', 'Deleted, but the templates could not be reloaded. Reload before another change.') }; }
    }
    catch (e) { failure = e as ConfigFailure; }
    finally { pending = false; }
  }
  async function apply(dryRun: boolean) {
    if (!chosen || !memory || !writable || pending || (!dryRun && (!preview || previewStale))) return;
    pending = true; failure = null; notice = '';
    try {
      preview = (await configCall<{ value: ApplyPreview }>({ kind: 'apply', op: dryRun ? 'preview' : 'apply', ref: chosen.id, memoryRef: memory.id, ...(!dryRun ? { revision: preview!.templateRevision } : {}) })).value;
      previewStale = false;
    } catch (e) { failure = e as ConfigFailure; if (failure.code === 'CONFLICT') { previewStale = true; failure.error = t('config.template-changed', 'This template changed since the preview. Preview again before applying.'); } }
    finally { pending = false; }
  }
  function outcome(value: string) {
    if (value === 'APPLIED') return preview?.dryRun ? t('config.will-add', 'Will be added') : t('config.added', 'Added');
    if (value === 'REPLACED') return preview?.dryRun ? t('config.will-replace', 'Will be replaced') : t('config.replaced', 'Replaced');
    if (value === 'SKIPPED_LOCKED') return t('config.skipped-locked', 'Skipped: locked');
    if (value === 'SKIPPED_CONFLICT') return t('config.skipped-conflict', 'Skipped: conflict with an existing rule');
    return t('config.skipped-unknown', 'Skipped: outcome unavailable');
  }
</script>
<section class="space-y-4">
  <h1 bind:this={heading} tabindex="-1" class="text-2xl font-semibold">{t('config.templates', 'Node-role templates')}</h1>
  {#if readOnly}<p>{t('config.impersonation', 'This page is read-only while impersonating.')}</p>{/if}
  {#if notice}<p role="status" class="text-green-700 dark:text-green-300">{notice}</p>{/if}
  {#if failure && editing === undefined && !chosen}<p role="alert" class="text-red-700 dark:text-red-300">{failure.error}</p>{/if}
  {#if writable}<button type="button" disabled={pending || editing !== undefined} onclick={() => edit(null)} class="min-h-11 rounded bg-indigo-600 px-4 text-white">{t('config.create-template', 'Create template')}</button>{/if}
  {#if !templates.length}<p class="text-zinc-500 dark:text-zinc-400">{writable ? t('config.no-templates-yet', 'No templates yet. Create a template to get started.') : t('config.no-visible-templates', 'No templates are available to you for this owner.')}</p>{/if}
  <DataTable {table} listKey={`node-role-templates:${ownerType}`} searchPlaceholder={t('config.search-templates', 'Search templates…')} searchAriaLabel={t('config.search-templates', 'Search templates…')}>
    {#snippet cell(cell, row)}
      {#if cell.column.id === 'actions'}
        {#if writable}<div class="flex flex-wrap gap-2"><button type="button" disabled={pending || editing !== undefined} onclick={() => edit(row)} class="min-h-11 rounded border px-3">{t('config.edit', 'Edit')}</button><button type="button" disabled={pending || editing !== undefined} onclick={() => remove(row)} class="min-h-11 rounded border px-3">{t('config.delete', 'Delete')}</button><button type="button" disabled={pending || editing !== undefined} onclick={() => { chosen = row; memory = null; preview = null; editing = undefined; previewStale = false; failure = null; notice = ''; }} class="min-h-11 rounded border px-3">{t('config.apply-to-memory', 'Apply to a memory…')}</button></div>{/if}
      {:else if cell.column.id === 'required'}{row.required ? t('config.yes', 'Yes') : t('config.no', 'No')}
      {:else}{String(cell.getValue() ?? '')}{/if}
    {/snippet}
  </DataTable>
  {#if editing !== undefined && writable}
    <div aria-label={t('config.template-editor', 'Template editor')} class="min-w-0 space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <fieldset disabled={pending} class="min-w-0 space-y-4">
        <h2 class="text-xl font-semibold">{editing ? t('config.edit-template', 'Edit template') : t('config.create-template', 'Create template')}</h2>
        <form id={formId} onsubmit={save} class="space-y-4"><label class="block">{t('config.name', 'Name')}<input bind:this={nameInput} required maxlength="64" bind:value={name} class="w-full rounded border p-2 dark:border-zinc-700 dark:bg-zinc-950" /></label>
        <label class="block">{t('config.description', 'Description')}<textarea bind:value={description} class="w-full rounded border p-2 dark:border-zinc-700 dark:bg-zinc-950"></textarea></label>
        <label class="flex items-center gap-2"><input type="checkbox" bind:checked={required} />{t('config.required', 'Required')}</label></form>
        {#if required}<p class="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('config.required-warning', 'Applied rules arrive locked: ordinary edits and deletion are refused. On an org memory only an org admin can unlock them.')}</p>{/if}
        <button type="button" onclick={() => ruleIndex = rules.length} class="min-h-11 rounded border px-3">{t('config.add-rule', 'Add rule')}</button>
        <DataTable table={ruleTable} listKey="template-draft-rules" searchPlaceholder={t('config.search-rules', 'Search rules…')} searchAriaLabel={t('config.search-rules', 'Search rules…')}>
          {#snippet cell(cell, row)}
            {#if cell.column.id === 'role'}{row.role}
            {:else if cell.column.id === 'settings'}<p>{row.enabled ? t('config.enabled', 'Enabled') : t('config.disabled', 'Disabled')}</p><p>{t('config.writers-label', 'Writers: {value}', { value: row.writers })}{#if row.writers === 'OWNER'} — {t('config.owner-note', 'not supported yet; refuses every write when enabled')}{/if}</p><p>{t('config.strict-label', 'Strict sub-roles: {value}', { value: row.strictSubRoles ? t('config.yes', 'Yes') : t('config.no', 'No') })}</p><p>{t('config.validate-label', 'Validate by: {value}', { value: row.validateBy ?? t('config.none', 'None') })}</p>
            {:else if cell.column.id === 'references'}<div class="space-y-3 whitespace-normal">{#each fields as field}<div><p class="font-medium">{labels[field]}</p><RuleReference state={row[`${field}State`]} urn={row[field]} /></div>{/each}</div>
            {:else}<div class="flex flex-wrap gap-2"><button type="button" onclick={() => ruleIndex = rules.indexOf(row)} class="min-h-11 rounded border px-3">{t('config.edit', 'Edit')}</button><button type="button" onclick={() => { rules = rules.filter(r => r !== row); rulesChanged = true; }} class="min-h-11 rounded border px-3">{t('config.remove', 'Remove')}</button></div>{/if}
          {/snippet}
        </DataTable>
        {#if failure}<p role="alert" class="text-red-700 dark:text-red-300">{failure.error}</p>{/if}
        {#if failure?.code === 'CONFLICT'}<button type="button" onclick={async () => { try { await reload(); const current = templates.find(v => v.id === editing?.id); if (current) edit(current); } catch { /* Preserve draft. */ } }} class="min-h-11 rounded border px-3">{t('config.reload-template', 'Reload template (discards your changes)')}</button>{/if}
        <div class="flex gap-3"><button type="submit" form={formId} class="min-h-11 rounded bg-indigo-600 px-4 text-white">{t('config.save', 'Save')}</button><button type="button" onclick={() => editing = undefined} class="min-h-11 rounded border px-4">{t('config.cancel', 'Cancel')}</button></div>
      </fieldset>
    </div>
    {#if ruleIndex !== null}
      <RuleEditor fallbackFocus={heading} templateDraft rule={rules[ruleIndex] ?? null} {memories} {memoriesFailed} oncancel={() => ruleIndex = null} onsave={async (input) => {
        const index = ruleIndex!;
        if (rules.some((r, i) => i !== index && r.role === input.role)) return { error: t('config.duplicate-role', 'A rule already uses this role.'), field: 'role' };
        const previous = rules[index];
        const next = { ...previous, ...input } as Rule;
        for (const f of ['authorTask', 'validationTask', 'descriptionNode'] as const) {
          if (Object.hasOwn(input, `${f}Ref`)) { const ref = input[`${f}Ref`] as string | null; next[f] = ref; next[`${f}Id`] = ref; next[`${f}State`] = ref ? 'OK' : 'NONE'; }
          else if (!previous) { next[f] = null; next[`${f}Id`] = null; next[`${f}State`] = 'NONE'; }
        }
        rules[index] = next; rulesChanged = true; ruleIndex = null; return null;
      }} />
    {/if}
  {/if}
  {#if chosen && writable}
    <section class="space-y-4 rounded-xl border p-5 dark:border-zinc-700">
      <h2 class="text-xl font-semibold">{t('config.apply-name', 'Apply “{name}”', { name: chosen.name })}</h2>
      {#if failure}<p role="alert" class="text-red-700 dark:text-red-300">{failure.error}</p>{/if}
      {#if memory}<p>{memory.name}</p><Urn value={memory.urn} linked />{/if}
      <button type="button" disabled={pending} onclick={() => memoryPicker = true} class="min-h-11 rounded border px-3">{t('config.choose-memory', 'Choose memory…')}</button>
      {#if memoryPicker}<SelectMemory {memories} bind:open={memoryPicker} onselect={(m) => { memory = m; preview = null; previewStale = false; }} />{/if}
      {#if memoriesFailed}<p role="alert">{t('config.memories-failed', 'Memories could not be loaded. Reload the page to try again.')}</p>{/if}
      <button type="button" disabled={!memory || pending} onclick={() => apply(true)} class="min-h-11 rounded border px-3">{previewStale ? t('config.preview-again', 'Preview again') : t('config.preview', 'Preview')}</button>
      {#if preview}
        <h3 class="font-semibold">{previewStale ? t('config.preview-stale', 'Preview out of date — preview again before applying') : preview.dryRun ? t('config.preview-heading', 'Preview: nothing has been changed') : t('config.applied-heading', 'Template applied')}</h3>
        {#if preview.required}<p class="rounded bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{t('config.required-warning', 'Applied rules arrive locked: ordinary edits and deletion are refused. On an org memory only an org admin can unlock them.')}</p>{/if}
        <DataTable table={previewTable} listKey="node-role-template-preview" searchPlaceholder={t('config.search-preview', 'Search preview…')} searchAriaLabel={t('config.search-preview', 'Search preview…')}>
          {#snippet cell(cell, row)}<span class="block whitespace-normal break-words">{cell.column.id === 'outcome' ? outcome(row.outcome) : row.role}</span>{/snippet}
        </DataTable>
        {#if preview.dryRun}<button type="button" disabled={pending || previewStale} onclick={() => apply(false)} class="min-h-11 rounded bg-indigo-600 px-4 text-white">{preview.required ? t('config.apply-lock', 'Apply and lock rules') : t('config.apply', 'Apply')}</button>{/if}
        {#each preview.warnings as warning}<p>{warning.role}: {warning.field ?? ''} — {warning.code}</p>{/each}
      {/if}
    </section>
  {/if}
</section>
