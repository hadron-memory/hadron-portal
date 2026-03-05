<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const org = $derived(data.org);

  const memberIds = $derived(new Set((org.members ?? []).map((m: { user: { id: string } }) => m.user.id)));
  const nonMembers = $derived((data.allUsers ?? []).filter((u: { id: string }) => !memberIds.has(u.id)));

  function submitOnChange(e: Event) {
    (e.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }
</script>

<svelte:head><title>Members · {org.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div>
    <a href="/app/orgs/{org.id}" class="text-sm text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white">← {org.name}</a>
    <h1 class="mt-1 text-2xl font-bold text-zinc-900 dark:text-white">Members</h1>
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  <!-- Member list -->
  <section class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
    {#each (org.members ?? []) as m (m.id)}
      <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
        {#if m.user.avatarUrl}
          <img src={m.user.avatarUrl} alt={m.user.login} class="h-8 w-8 rounded-full" />
        {/if}
        <div class="flex-1 min-w-0">
          <p class="font-medium text-zinc-900 truncate dark:text-white">{m.user.name ?? m.user.login}</p>
          <p class="text-xs text-zinc-500">@{m.user.login}</p>
        </div>
        <!-- Role update -->
        <form method="POST" action="?/update" use:enhance class="flex items-center gap-2">
          <input type="hidden" name="userId" value={m.user.id} />
          <select name="role" onchange={submitOnChange} class="rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-xs text-zinc-300">
            {#each ['READER', 'CONTRIBUTOR', 'ADMIN'] as role}
              <option value={role} selected={m.role === role}>{role}</option>
            {/each}
          </select>
        </form>
        <!-- Remove -->
        <form method="POST" action="?/remove" use:enhance>
          <input type="hidden" name="userId" value={m.user.id} />
          <button type="submit" class="text-xs text-red-400 hover:text-red-300">Remove</button>
        </form>
      </div>
    {/each}
  </section>

  <!-- Invite -->
  {#if nonMembers.length > 0}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Invite a user</h2>
      <form method="POST" action="?/add" use:enhance class="flex items-end gap-3">
        <div class="flex-1">
          <label for="userId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">User</label>
          <select id="userId" name="userId" class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            {#each nonMembers as u (u.id)}
              <option value={u.id}>{u.name ?? u.login} (@{u.login})</option>
            {/each}
          </select>
        </div>
        <div>
          <label for="role" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
          <select id="role" name="role" class="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white">
            <option value="READER">Reader</option>
            <option value="CONTRIBUTOR">Contributor</option>
            <option value="ADMIN">Admin</option>
          </select>
        </div>
        <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Invite</button>
      </form>
    </section>
  {/if}
</div>
