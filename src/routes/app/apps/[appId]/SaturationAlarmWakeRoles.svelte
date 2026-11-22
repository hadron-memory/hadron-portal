<!--
  portal#2464 (hadron-server#4777, hrn:node:hadronmemory.com:specs:cor:agt:060:16): the roles this App's
  saturation alarms wake, on the Settings tab.

  The user wants to say which roles get a wake when the platform can't give work to a role. They add and take
  away role names and save the whole list (the server's mutation replaces it). Role names are plain words, not
  entities: a role no worker holds is valid, so there is no picker and nothing is checked against the roster.
  Whoever may read the roster reads the list; whoever manages the App changes it. The server stays the
  authority on both and on what a name may look like, so its sentence is what a refusal shows.
-->
<script lang="ts">
  import LiveRegion from '$lib/components/LiveRegion.svelte';
  import { enhance } from '$app/forms';
  import type { SubmitFunction } from '@sveltejs/kit';
  import { t } from '$lib/i18n/t';

  type Read = { kind: 'ok'; roles: string[] } | { kind: 'hidden' } | { kind: 'failed' };
  let { read, canManage }: {
    /** The loader's read: the list, `hidden` (the roster's refusal) or `failed`. */
    read: Read | null;
    /** The viewer manages the App and acts as themselves. */
    canManage: boolean;
  } = $props();

  const saved = $derived(read?.kind === 'ok' ? read.roles : []);
  let draft = $state<string[] | null>(null);
  let typed = $state('');
  let saving = $state(false);
  let error = $state<string | null>(null);
  let ok = $state(false);
  const roles = $derived(draft ?? saved);
  const dirty = $derived(draft !== null && draft.join('\n') !== saved.join('\n'));

  // The server trims, lower-cases and de-duplicates; the draft does the same so what is listed is what is stored.
  function add() {
    const name = typed.trim().toLowerCase();
    if (!name) return;
    if (!roles.includes(name)) draft = [...roles, name].sort();
    typed = '';
    ok = false;
    error = null;
  }
  function remove(name: string) {
    draft = roles.filter((r) => r !== name);
    ok = false;
    error = null;
  }

  const failed = t('app.wake-roles.error.failed', 'Not saved. Try again.');
  const submit: SubmitFunction = () => {
    saving = true;
    error = null;
    ok = false;
    return async ({ result, update }) => {
      saving = false;
      if (result.type === 'success') {
        await update({ reset: false });
        draft = null;
        ok = true;
        return;
      }
      if (result.type === 'failure') {
        // A save is the whole list, so a repeat is harmless: an unconfirmed one keeps the draft to send again.
        error = String((result.data as { wakeRolesError?: string } | undefined)?.wakeRolesError ?? failed);
        return;
      }
      error = t('app.wake-roles.unconfirmed', 'Couldn’t confirm the save; checking…');
    };
  };

  const inputClass = 'min-w-0 flex-1 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 pointer-coarse:min-h-11 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white';
  const buttonClass = 'rounded-md border border-zinc-300 px-3 py-1 text-xs text-zinc-600 pointer-coarse:min-h-11 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800';
</script>

{#if read && read.kind !== 'hidden'}
  <section class="max-w-lg" aria-labelledby="wake-roles-title">
    <h2 id="wake-roles-title" class="mb-1 font-semibold text-zinc-900 dark:text-white">{t('app.wake-roles.title', 'Saturation alarm wake roles')}</h2>
    <p class="mb-3 text-sm text-zinc-500 dark:text-zinc-400">
      {t('app.wake-roles.help', 'Workers in these roles are offered a wake when a saturation alarm is raised. A change applies to alarms raised afterwards.')}
    </p>

    {#if read.kind === 'failed'}
      <p role="alert" class="text-sm text-red-600 dark:text-red-400">{t('app.wake-roles.read-failed', 'The wake roles couldn’t be loaded.')}</p>
    {:else}
      {#if roles.length === 0}
        <p class="mb-3 text-sm text-zinc-600 dark:text-zinc-300">{t('app.wake-roles.empty', 'No roles. Nobody is woken. Saturation alarms are still recorded and readable.')}</p>
      {:else}
        <ul class="mb-3 flex flex-wrap gap-2" aria-label={t('app.wake-roles.title', 'Saturation alarm wake roles')}>
          {#each roles as name (name)}
            <li class="flex items-center gap-1 rounded-full border border-zinc-300 bg-zinc-50 py-0.5 pl-3 pr-1 text-sm text-zinc-800 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100">
              <span class="break-all">{name}</span>
              {#if canManage}
                <button type="button" onclick={() => remove(name)} disabled={saving} aria-label={t('app.wake-roles.remove', 'Remove {role}', { role: name })} class="rounded-full px-2 text-zinc-500 pointer-coarse:min-h-11 pointer-coarse:min-w-11 hover:text-zinc-900 disabled:opacity-50 dark:text-zinc-400 dark:hover:text-white">×</button>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      {#if canManage}
        <div class="mb-3 flex items-center gap-2">
          <label for="wake-role-input" class="sr-only">{t('app.wake-roles.input', 'Role')}</label>
          <input
            id="wake-role-input"
            type="text"
            bind:value={typed}
            disabled={saving}
            autocomplete="off"
            onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
            class={inputClass}
          />
          <button type="button" onclick={add} disabled={saving || typed.trim() === ''} class={buttonClass}>{t('app.wake-roles.add', 'Add')}</button>
        </div>
        <form method="POST" action="?/setSaturationAlarmWakeRoles" use:enhance={submit} class="flex flex-wrap items-center gap-2">
          {#each roles as name (name)}<input type="hidden" name="roles" value={name} />{/each}
          <button type="submit" class={buttonClass} disabled={!dirty || saving}>{t('app.wake-roles.save', 'Save')}</button>
          <LiveRegion class="idle:absolute">
            {#if ok}<span class="text-xs text-green-700 dark:text-green-400">{t('app.wake-roles.saved', 'Saved.')}</span>{/if}
          </LiveRegion>
        </form>
      {:else}
        <p class="text-xs text-zinc-500 dark:text-zinc-400">{t('app.wake-roles.read-only', 'Only whoever manages this App can change this.')}</p>
      {/if}
      {#if error}
        <p role="alert" class="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
      {/if}
    {/if}
  </section>
{/if}
