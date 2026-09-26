<!--
  #921 — the node role input in the metadata form.

  An open string: the suggestions list common roles but never restricts, and
  nothing is lowercased. The hidden seed carries the role the form opened with,
  so the action can tell an edit from an untouched field (`roleUpdate`): an
  untouched form omits the role, and emptying it is an explicit clear.
-->
<script lang="ts">
  import { t } from '$lib/i18n/t';
  import { ROLE_SUGGESTIONS } from '$lib/node-role';

  let {
    value = $bindable(''),
    seed,
    inputClass = '',
  }: { value?: string; seed: string; inputClass?: string } = $props();
</script>

<div>
  <label for="editRole" class="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
    {t('node.role.label', 'Role')}
  </label>
  <input type="hidden" name="roleSeed" value={seed} />
  <input
    id="editRole"
    name="role"
    type="text"
    list="nodeRoleSuggestions"
    autocomplete="off"
    spellcheck="false"
    bind:value
    aria-describedby="editRoleHelp"
    class="{inputClass} font-mono"
  />
  <datalist id="nodeRoleSuggestions">
    {#each ROLE_SUGGESTIONS as suggestion (suggestion)}
      <option value={suggestion}></option>
    {/each}
  </datalist>
  <p id="editRoleHelp" class="mt-1 text-xs text-zinc-500">
    {t(
      'node.role.help',
      'What this node is for, e.g. spec, review or spec.feature. Not the node type or object type. Leave it as it is to keep it; empty it to clear.',
    )}
  </p>
</div>
