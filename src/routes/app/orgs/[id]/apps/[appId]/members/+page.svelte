<script lang="ts">
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const app = $derived(data.app);
  const org = $derived(data.org);
  const members = $derived(data.members);
  const allUsers = $derived(data.allUsers);

  // Roles offered by the linked Agent's installation policy. The server
  // validates against this same list (InvalidRoleError if the role isn't
  // present), so the dropdown is the canonical source of truth.
  const memberRoles = $derived<string[]>(app.agent?.installationPolicy?.memberRoles ?? []);
  const maxMembers = $derived<string>(app.agent?.installationPolicy?.maxMembers ?? 'unlimited');
  const memberLimit = $derived<number | null>(
    maxMembers === 'unlimited' ? null : Number.parseInt(maxMembers, 10),
  );
  const atLimit = $derived(memberLimit !== null && members.length >= memberLimit);

  const memberIds = $derived(new Set(members.map((m) => m.userId)));
  const nonMembers = $derived(allUsers.filter((u) => !memberIds.has(u.id)));

  function submitOnChange(e: Event) {
    (e.currentTarget as HTMLSelectElement).form?.requestSubmit();
  }

  function userLabel(u: { name: string | null; githubUsername: string | null; email?: string | null }): string {
    return u.name ?? u.githubUsername ?? u.email ?? 'Unknown';
  }
</script>

<svelte:head><title>Members · {app.name} · Hadron</title></svelte:head>

<div class="space-y-8">
  <div>
    <Breadcrumb items={[
      { label: 'Organizations', href: '/app/orgs' },
      { label: org.name, href: `/app/orgs/${org.id}` },
      { label: 'Apps', href: `/app/orgs/${org.id}/apps` },
      { label: app.name, href: `/app/orgs/${org.id}/apps/${app.id}` },
      { label: 'Members' },
    ]} />
    <h1 class="mt-2 text-2xl font-bold text-zinc-900 dark:text-white">
      Members
      <span class="ml-2 text-sm font-normal text-zinc-500">({members.length}{memberLimit !== null ? ` / ${memberLimit}` : ''})</span>
    </h1>
    {#if app.agent}
      <p class="mt-1 text-sm text-zinc-500">
        Roles below are defined by the linked Agent
        <a href="/app/agents/{app.agent.id}" class="text-indigo-500 hover:underline dark:text-indigo-400">{app.agent.name}</a>.
      </p>
    {:else}
      <p class="mt-1 text-sm text-amber-600 dark:text-amber-400">
        This App has no Agent linked yet. Members can only be added once an Agent is linked.
      </p>
    {/if}
  </div>

  {#if form?.error}
    <div class="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{form.error}</div>
  {/if}

  <!-- Member list -->
  {#if members.length > 0}
    <section class="divide-y divide-zinc-200 rounded-xl border border-zinc-200 overflow-hidden dark:divide-zinc-800 dark:border-zinc-800">
      {#each members as m (m.userId)}
        <div class="flex items-center gap-4 bg-white px-5 py-4 dark:bg-zinc-900">
          {#if m.user.avatarUrl}
            <img src={m.user.avatarUrl} alt={userLabel(m.user)} class="h-8 w-8 rounded-full" />
          {/if}
          <div class="flex-1 min-w-0">
            <p class="font-medium text-zinc-900 truncate dark:text-white">{userLabel(m.user)}</p>
            {#if m.user.githubUsername}
              <p class="text-xs text-zinc-500">@{m.user.githubUsername}</p>
            {:else if m.user.email}
              <p class="text-xs text-zinc-500">{m.user.email}</p>
            {/if}
          </div>

          {#if memberRoles.length > 0}
            <form method="POST" action="?/ensure" use:enhance class="flex items-center gap-2">
              <input type="hidden" name="userId" value={m.userId} />
              <select name="role" onchange={submitOnChange}
                class="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-800 dark:text-white">
                {#each memberRoles as role}
                  <option value={role} selected={m.role === role}>{role}</option>
                {/each}
              </select>
            </form>
          {:else}
            <span class="text-xs text-zinc-500">{m.role}</span>
          {/if}

          <form method="POST" action="?/remove" use:enhance>
            <input type="hidden" name="userId" value={m.userId} />
            <button type="submit" class="text-xs text-red-500 hover:text-red-400 dark:text-red-400 dark:hover:text-red-300">Remove</button>
          </form>
        </div>
      {/each}
    </section>
  {:else}
    <p class="text-sm text-zinc-500">No members yet.</p>
  {/if}

  <!-- Add existing user -->
  {#if app.agent && nonMembers.length > 0 && memberRoles.length > 0}
    <section>
      <h2 class="mb-3 font-semibold text-zinc-900 dark:text-white">Add member</h2>
      {#if atLimit}
        <p class="mb-3 text-sm text-amber-600 dark:text-amber-400">
          This App is at the member limit set by the Agent ({memberLimit}). Remove a member or ask the Agent author to raise the cap.
        </p>
      {:else}
        <form method="POST" action="?/ensure" use:enhance class="flex flex-wrap items-end gap-3">
          <div class="flex-1 min-w-[200px]">
            <label for="userId" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">User</label>
            <select id="userId" name="userId"
              class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              {#each nonMembers as u (u.id)}
                <option value={u.id}>{userLabel(u)}{u.githubUsername ? ` (@${u.githubUsername})` : ''}</option>
              {/each}
            </select>
          </div>
          <div>
            <label for="role" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Role</label>
            <select id="role" name="role"
              class="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white">
              {#each memberRoles as role}
                <option value={role}>{role}</option>
              {/each}
            </select>
          </div>
          <button type="submit" class="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600">
            Add member
          </button>
        </form>
      {/if}
    </section>
  {/if}
</div>
