<script lang="ts">
  import { enhance } from '$app/forms';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  const invite = $derived(data.invite);
  const expired = $derived(invite ? new Date(invite.expiresAt) < new Date() : false);
  const isPending = $derived(invite?.status === 'PENDING');
</script>

<svelte:head><title>Organization Invite · Hadron</title></svelte:head>

<div class="mx-auto max-w-lg px-4 py-16">
  {#if form?.error}
    <div class="mb-6 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
  {/if}

  {#if !invite}
    <div class="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invalid or expired invite</h1>
      <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">This invitation link is no longer valid. It may have expired or been cancelled.</p>
      <a href="/" class="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go home</a>
    </div>
  {:else if !isPending}
    <div class="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invite already {invite.status.toLowerCase()}</h1>
      <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">This invitation to <strong>{invite.organization.name}</strong> has already been {invite.status.toLowerCase()}.</p>
      <a href="/app/dashboard" class="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go to dashboard</a>
    </div>
  {:else if expired}
    <div class="rounded-2xl border border-zinc-200 bg-white p-8 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invite expired</h1>
      <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">This invitation to <strong>{invite.organization.name}</strong> has expired. Please ask the inviter to send a new one.</p>
      <a href="/" class="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go home</a>
    </div>
  {:else}
    <div class="rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">You've been invited!</h1>
        <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          <strong>@{invite.invitedBy.login}</strong> invited you to join
        </p>
        <p class="mt-1 text-lg font-semibold text-indigo-600 dark:text-indigo-400">{invite.organization.name}</p>
        <p class="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Sent to {invite.email} · Expires {new Date(invite.expiresAt).toLocaleDateString()}
        </p>
      </div>

      <div class="mt-8">
        {#if data.isAuthenticated}
          <form method="POST" action="?/accept" use:enhance class="flex flex-col gap-3">
            <button type="submit" class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-500">
              Accept invite
            </button>
          </form>
        {:else}
          <p class="mb-4 text-center text-sm text-zinc-500 dark:text-zinc-400">Sign in with GitHub to accept this invitation.</p>
          <a
            href={data.signInUrl}
            class="block w-full rounded-lg bg-zinc-800 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-zinc-700"
          >
            Sign in with GitHub
          </a>
        {/if}
      </div>
    </div>
  {/if}
</div>
