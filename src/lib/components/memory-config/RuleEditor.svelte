<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { consumeEscapeAtDialog, dialogEscapeFallback } from '$lib/a11y/dialog-escape';
  import SelectNode from '$lib/components/SelectNode.svelte';
  import RuleReference from './RuleReference.svelte';
  import { t } from '$lib/i18n/t';
  import type { Rule } from '$lib/memory-config/types';
  import type { ConfigFailure } from '$lib/memory-config/client';
  let { rule = null, seedRole = null, templateDraft = false, memories, memoriesFailed = false, oncancel, onsave, onreload, fallbackFocus }: {
    rule?: Rule | null; /** A create that starts from a role the caller fixed (the skipped-defaults list). */ seedRole?: string | null; templateDraft?: boolean; memories: { id: string; name: string; urn: string }[]; memoriesFailed?: boolean;
    oncancel: () => void; onsave: (input: Record<string, unknown>) => Promise<ConfigFailure | null>; onreload?: () => Promise<ConfigFailure | null | undefined>; fallbackFocus?: HTMLElement;
  } = $props();
  const uid = $props.id();
  const seed = untrack(() => rule);
  const roleSeed = untrack(() => seedRole);
  let role = $state(seed?.role ?? roleSeed ?? ''), enabled = $state(seed?.enabled ?? true), strictSubRoles = $state(seed?.strictSubRoles ?? false);
  let writers = $state(seed?.writers ?? 'ALL'), validateBy = $state(seed?.validateBy ?? '');
  const fields = ['authorTask', 'validationTask', 'descriptionNode'] as const;
  type Field = typeof fields[number];
  const labels = { authorTask: t('config.author', 'Author task'), validationTask: t('config.validator', 'Validation task'), descriptionNode: t('config.description-node', 'Description node') };
  // `refs` is the sparse override map: a key is present only once the user has
  // picked or cleared that field, and absence means "keep the seed / omit from
  // the payload", which is different from an explicit null (Clear). It is a
  // `$state.raw` value that is REPLACED, never mutated in place. With a deeply
  // reactive object, the template's `Object.hasOwn(refs, field)` on a key that
  // is not there yet subscribes to nothing in this Svelte version, so adding the
  // key later does not re-render: Save sent the new value while the row still
  // showed the old one. Evidence: portal#1804, and the finding
  // hrn:node:hadronmemory.com:hadron-portal:findings:sparse-rule-reference-overrides-not-observed
  let refs = $state.raw<Partial<Record<Field, string | null>>>({});
  function setReference(field: Field, value: string | null) {
    refs = { ...refs, [field]: value };
  }
  let choosing = $state<Field | null>(null), pickerOpen = $state(false);
  let pending = $state(false), failure = $state<ConfigFailure | null>(null);
  // A pending save still owns Escape: declining it lets Chromium close the native dialog.
  // Only a nested picker suppresses this layer; pending close callbacks remain a no-op.
  const escapeOptions = { close: () => { if (!pending) oncancel(); }, suppressed: () => pickerOpen };
  let dialog: HTMLDialogElement;
  onMount(() => {
    const invoker = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
    const fallback = fallbackFocus;
    dialog.showModal();
    return () => {
      const restore = document.activeElement === document.body || dialog.contains(document.activeElement);
      dialog.close();
      void tick().then(() => {
        // Recheck after teardown; never focus a new screen or steal a newer control.
        if (!restore || document.activeElement !== document.body || !fallback?.isConnected) return;
        const target = invoker?.isConnected && !invoker.matches(':disabled') ? invoker : fallback;
        target.focus();
      });
    };
  });
  async function save(event: SubmitEvent) {
    event.preventDefault(); if (pending) return;
    pending = true; failure = null;
    const input: Record<string, unknown> = { role, enabled, strictSubRoles, writers, validateBy: validateBy || null };
    for (const field of fields) if (Object.hasOwn(refs, field)) input[`${field}Ref`] = refs[field];
    try { failure = await onsave(input); }
    finally { pending = false; }
  }
</script>
<dialog bind:this={dialog} use:dialogEscapeFallback={escapeOptions} onkeydown={(e) => { if (e.key === 'Escape' && !e.defaultPrevented && !e.isComposing && !pickerOpen) { e.preventDefault(); e.stopPropagation(); if (!pending) oncancel(); } else consumeEscapeAtDialog(e, escapeOptions); }} oncancel={(e) => e.preventDefault()} aria-label={seed ? t('config.edit-rule', 'Edit rule') : t('config.create-rule', 'Create rule')} class="fixed inset-0 m-auto max-sm:m-0 max-h-[100dvh] w-full max-w-2xl overflow-y-auto rounded-xl border border-zinc-300 bg-white p-5 text-zinc-900 backdrop:bg-black/50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white max-sm:h-dvh max-sm:rounded-none">
  <form onsubmit={save} class="space-y-4">
    <fieldset disabled={pending} class="space-y-4">
    <h2 class="text-xl font-semibold">{seed ? t('config.edit-rule', 'Edit rule') : t('config.create-rule', 'Create rule')}</h2>
    <label class="block">{t('config.role', 'Role / sub-role')}<input required maxlength="64" readonly={!!seed || !!roleSeed} bind:value={role} class="mt-1 w-full rounded border border-zinc-300 p-2 dark:border-zinc-700 dark:bg-zinc-950" /></label>
    {#if failure?.field === 'role'}<p role="alert" class="text-red-700 dark:text-red-300">{failure.error}</p>{/if}
    <label class="flex items-center gap-2"><input type="checkbox" bind:checked={enabled} />{t('config.enabled', 'Enabled')}</label>
    <label class="flex items-center gap-2"><input type="checkbox" bind:checked={strictSubRoles} />{t('config.strict', 'Require declared sub-roles')}</label>
    <div><label for={`${uid}-writers`} class="block">{t('config.writers', 'Writers')}</label><select id={`${uid}-writers`} bind:value={writers} class="mt-1 w-full rounded border p-2 dark:border-zinc-700 dark:bg-zinc-950"><option value="ALL">{t('config.writers.all', 'Anyone with memory write access')}</option><option value="ADMIN">{t('config.writers.admin', 'Organization admins / owners, or the owning user')}</option><option value="OWNER">{t('config.writers.owner', 'OWNER — not supported yet')}</option></select></div>
    {#each fields as field}
      <div class="space-y-1">
        <p class="font-medium">{labels[field]}</p>
        {#if Object.hasOwn(refs, field)}
          <RuleReference state={refs[field] ? 'OK' : 'NONE'} urn={refs[field] ?? null} />
        {:else if seed}<RuleReference state={seed[`${field}State`]} urn={seed[field]} />
        {:else}<RuleReference state="NONE" urn={null} />{/if}
        <div class="flex flex-wrap gap-2">
          <button type="button" onclick={() => { choosing = field; pickerOpen = true; }} aria-haspopup="dialog" aria-expanded={pickerOpen && choosing === field} class="min-h-11 rounded border px-3">{t('config.change', 'Change…')}</button>
          <button type="button" onclick={() => setReference(field, null)} class="min-h-11 rounded border px-3">{t('config.clear', 'Clear')}</button>
        </div>
        {#if failure?.field === field || failure?.field === `${field}Ref`}<p role="alert" class="text-red-700 dark:text-red-300">{failure.error}</p>{/if}
      </div>
    {/each}
    <div><label for={`${uid}-validator`} class="block">{t('config.validate-by', 'Validate by')}</label><select id={`${uid}-validator`} bind:value={validateBy} class="mt-1 w-full rounded border p-2 dark:border-zinc-700 dark:bg-zinc-950"><option value="">{t('config.none', 'None')}</option><option value="AGENT">{t('config.agent', 'Agent')}</option><option value="PLATFORM">{t('config.platform', 'Platform')}</option></select></div>
    {#if enabled && (writers === 'OWNER' || strictSubRoles)}
      <p role="note" class="rounded border border-amber-400 bg-amber-50 p-3 text-amber-900 dark:bg-amber-950 dark:text-amber-200">{templateDraft ? t('config.template-write-warning', 'When applied as an enabled rule, OWNER refuses every write touching the role; strict sub-roles refuse undeclared sub-roles. Saving this template draft does not change a memory.') : writers === 'OWNER' ? t('config.owner-warning', 'Saving this enabled OWNER rule will refuse every write touching this role, including writes that work now.') : t('config.strict-warning', 'Saving strict sub-roles will refuse writes to undeclared sub-roles that work now.')}</p>
    {/if}
    {#if failure && failure.field !== 'role'}<p role="alert" class="text-red-700 dark:text-red-300">{failure.error}</p>{/if}
    {#if failure?.code === 'CONFLICT' && onreload}<button type="button" disabled={pending} onclick={async () => { if (pending) return; pending = true; try { const result = await onreload?.(); if (result !== undefined) failure = result; } finally { pending = false; } }} class="min-h-11 rounded border px-3">{t('config.reload-rule', 'Reload the rule (discards your changes)')}</button>{/if}
    <div class="flex flex-wrap gap-3">
      <button type="submit" aria-disabled={pending} class="min-h-11 rounded bg-indigo-600 px-4 text-white">{pending ? t('config.saving', 'Saving…') : t('config.save', 'Save')}</button>
      <button type="button" disabled={pending} onclick={oncancel} class="min-h-11 rounded border px-4">{t('config.cancel', 'Cancel')}</button>
    </div>
    </fieldset>
  </form>
  {#if pickerOpen}<SelectNode {memories} {memoriesFailed} bind:open={pickerOpen} onselect={(node) => { if (choosing) setReference(choosing, node.urn); pickerOpen = false; }} />{/if}
</dialog>
