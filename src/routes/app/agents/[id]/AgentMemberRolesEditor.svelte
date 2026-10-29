<script lang="ts">
  import { untrack } from 'svelte';
  import { superForm, type Infer, type SuperValidated } from 'sveltekit-superforms';
  import { zod4Client } from 'sveltekit-superforms/adapters';
  import { t } from '$lib/i18n/t';
  import { updateAgentMemberRolesSchema } from './schema';

  type RolesForm = Infer<typeof updateAgentMemberRolesSchema, 'zod4'>;
  type RolesSuperform = SuperValidated<RolesForm, App.Superforms.Message, RolesForm>;

  /**
   * portal#1405 (R211, hrn:node:hadronmemory.com:specs:cor:dmo:050:04): "Choose which roles people can have in
   * Apps using this Agent". Whoever the server lets edit the Agent edits the
   * list; everyone else keeps the read-only line. The server decides on save
   * (`updateAgent`, requireAgentAccess(ADMIN)); `canManage` only decides what
   * the page offers.
   */
  let { canManage, roles, initial }: {
    canManage: boolean;
    /** The roles the Agent offers now, as last read. */
    roles: string[];
    initial: RolesSuperform;
  } = $props();

  const {
    form: rolesForm,
    errors,
    message: rolesMessage,
    submitting,
    enhance,
    isTainted,
  } = superForm<RolesForm, App.Superforms.Message, RolesForm>(untrack(() => initial), {
    validators: zod4Client(updateAgentMemberRolesSchema),
    validationMethod: 'submit-only',
    clearOnSubmit: 'none',
    // Keep the returned form: it carries the saved list, untainted.
    resetForm: false,
  });

  let newRole = $state('');

  const draft = $derived<string[]>($rolesForm.roles);
  const changed = $derived(draft.length !== roles.length || draft.some((r, i) => r !== roles[i]));
  const empty = $derived(draft.length === 0);

  // An array field's error sits under `_errors` (the action's setError and the
  // schema agree); a plain list is tolerated for a form seeded by older code.
  const fieldError = $derived.by(() => {
    const e = $errors.roles as unknown;
    const first = Array.isArray(e) ? e[0] : (e as { _errors?: string[] } | undefined)?._errors?.[0];
    return typeof first === 'string' ? first : null;
  });
  const failure = $derived($rolesMessage?.type === 'error' ? $rolesMessage.text : null);
  const saved = $derived($rolesMessage?.type === 'success' ? $rolesMessage.text : null);

  // Another form on the page saved and the Agent was re-read: follow it, but
  // never overwrite an unsaved edit.
  $effect(() => {
    const current = roles;
    untrack(() => {
      if (!isTainted()) rolesForm.update((f) => ({ ...f, roles: [...current] }), { taint: false });
    });
  });

  function clearBanner() {
    if ($rolesMessage) rolesMessage.set(undefined);
  }

  function addRole() {
    const role = newRole.trim();
    if (!role) return;
    newRole = '';
    if (draft.includes(role)) return;
    clearBanner();
    rolesForm.update((f) => ({ ...f, roles: [...f.roles, role] }));
  }

  function removeRole(role: string) {
    clearBanner();
    rolesForm.update((f) => ({ ...f, roles: f.roles.filter((r) => r !== role) }));
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    addRole();
  }
</script>

{#if canManage}
  <form method="POST" action="?/updateMemberRoles" use:enhance novalidate class="space-y-3">
    <input type="hidden" name="_kind" value="updateMemberRoles" />
    {#each draft as role (role)}
      <input type="hidden" name="roles" value={role} />
    {/each}
    <span id="member-roles-label" class="text-sm text-zinc-500">{t('agent.member-roles.label', 'Member roles')}</span>
    <ul class="flex flex-wrap gap-2" aria-labelledby="member-roles-label">
      {#each draft as role (role)}
        <li class="inline-flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-50 py-0.5 pl-3 pr-1 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
          {role}
          <button type="button" aria-label={t('agent.member-roles.remove', 'Remove {role}', { role })} onclick={() => removeRole(role)}
            class="rounded-full px-1.5 text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900 dark:hover:bg-zinc-700 dark:hover:text-white">×</button>
        </li>
      {/each}
    </ul>
    <div class="flex items-center gap-2">
      <input type="text" bind:value={newRole} onkeydown={onKeydown}
        aria-label={t('agent.member-roles.new', 'New role')}
        aria-invalid={fieldError ? 'true' : undefined}
        aria-describedby={fieldError ? 'member-roles-error' : undefined}
        placeholder={t('agent.member-roles.new', 'New role')}
        class="w-40 rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-900 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white {fieldError ? 'border-red-500' : ''}" />
      <button type="button" onclick={addRole} disabled={!newRole.trim()}
        class="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800">
        {t('agent.member-roles.add', 'Add')}
      </button>
    </div>
    {#if fieldError}
      <p id="member-roles-error" role="alert" class="text-sm text-red-600 dark:text-red-400">{fieldError}</p>
    {:else if failure}
      <p role="alert" class="text-sm text-red-600 dark:text-red-400">{failure}</p>
    {:else if empty}
      <p role="status" class="text-sm text-amber-600 dark:text-amber-400">{t('agent.member-roles.at-least-one', 'An Agent needs at least one role.')}</p>
    {:else if saved && !changed}
      <p role="status" class="text-sm text-emerald-600 dark:text-emerald-400">{saved}</p>
    {/if}
    <button type="submit" disabled={$submitting || !changed || empty}
      class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50">
      {$submitting ? t('agent.member-roles.saving', 'Saving…') : t('agent.member-roles.save', 'Save')}
    </button>
  </form>
{:else}
  <span class="text-sm text-zinc-500">{t('agent.member-roles.label', 'Member roles')}</span>
  <p class="mt-1 text-sm text-zinc-900 dark:text-white">{roles.join(', ') || '—'}</p>
{/if}
