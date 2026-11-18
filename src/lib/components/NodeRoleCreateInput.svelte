<!--
  #1670 — the role field on the node-create page.

  Reuses #921's field contract: an open string, sent trimmed only, empty sends
  none, nothing lower-cased. A caller who cannot read the
  memory's rules gets the plain suggestions. A manager of the memory (the only
  caller who can read its rules) gets the memory's declared roles instead, every
  rule row, disabled ones marked rather than hidden; the plain list is not
  offered beside them (issue item 2: everyone else gets the existing ones). A
  suggestion only fills the field; nothing here ever rejects a value.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { ROLE_SUGGESTIONS } from '$lib/node-role';
  import { caseMismatchHint, roleSuggestionsFromRules, type RoleRuleRow } from '$lib/node-role-rules';
  import Urn from '$lib/components/Urn.svelte';

  let {
    value = $bindable(''),
    rules = null,
    inputClass = '',
  }: { value?: string; rules?: readonly RoleRuleRow[] | null; inputClass?: string } = $props();

  const declared = $derived(rules && rules.length > 0 ? roleSuggestionsFromRules(rules) : []);
  const caseHint = $derived(caseMismatchHint(value, declared));
</script>

<div data-testid="create-role">
  <label for="createRole" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">
    {t('node.role.label', 'Role')}
  </label>
  <input
    id="createRole"
    name="role"
    type="text"
    list={declared.length === 0 ? 'createRoleSuggestions' : undefined}
    autocomplete="off"
    spellcheck="false"
    bind:value
    aria-describedby={['createRoleHelp', caseHint ? 'createRoleCase' : ''].filter(Boolean).join(' ')}
    class="{inputClass} font-mono"
  />
  {#if declared.length === 0}
    <datalist id="createRoleSuggestions">
      {#each ROLE_SUGGESTIONS as suggestion (suggestion)}
        <option value={suggestion}></option>
      {/each}
    </datalist>
  {/if}
  <p id="createRoleHelp" class="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
    {t('node.role.create-help', 'What this node is for, e.g. spec, review or spec.feature. Not the node type or object type. Leave it empty for none.')}
  </p>
  {#if caseHint}
    <p id="createRoleCase" data-testid="create-role-case-hint" class="mt-1 text-xs text-amber-700 dark:text-amber-400">
      {t('node.role.case-hint', 'Roles are case-sensitive. This memory declares “{role}”.', { role: caseHint })}
    </p>
  {/if}
  {#if declared.length > 0}
    <ul data-testid="create-role-declared" aria-label={t('node.role.declared', 'Roles this memory declares')} class="mt-2 space-y-1.5">
      {#each declared as s (s.role)}
        <li class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <button
            type="button"
            onclick={() => (value = s.role)}
            class="rounded-md border border-zinc-300 px-2 py-0.5 font-mono text-zinc-800 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
          >{s.role}</button>
          {#if s.disabled}
            <span data-testid="role-disabled" class="text-zinc-500 dark:text-zinc-400">{t('node.role.rule-disabled', 'Rule disabled')}</span>
          {/if}
          {#if s.refusesAllWrites}
            <span data-testid="role-refuses-all" class="text-red-700 dark:text-red-300">{t('node.role.refuses-all', 'Refuses every write, managers included')}</span>
          {/if}
          {#if s.descriptionUrn}
            <Urn value={s.descriptionUrn} compact linked />
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>
