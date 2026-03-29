<script lang="ts">
  import { enhance } from '$app/forms';
  import { env } from '$env/dynamic/public';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const inv = $derived(data.invitation as {
    organization?: { name: string; urn: string };
    sender?: { name?: string; githubUsername?: string };
    memberRole: string;
    name?: string;
    expiresAt?: string;
    activationCount: number;
    maxActivations?: number;
  } | null);

  const serverUrl = env.PUBLIC_SERVER_URL ?? 'http://localhost:4000';
  const expired = $derived(inv?.expiresAt ? new Date(inv.expiresAt) < new Date() : false);
  const maxedOut = $derived(inv?.maxActivations ? inv.activationCount >= inv.maxActivations : false);
</script>

<svelte:head><title>Invitation · Hadron</title></svelte:head>

<div class="mx-auto max-w-lg px-4 py-16">
  <div class="rounded-2xl border border-zinc-200 bg-white p-8 dark:border-zinc-800 dark:bg-zinc-900">
    {#if !inv}
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invitation not found</h1>
        <p class="mt-2 text-sm text-zinc-500">This invitation link may be invalid or expired.</p>
        <a href="/" class="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go home</a>
      </div>
    {:else if expired}
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invitation expired</h1>
        <p class="mt-2 text-sm text-zinc-500">This invitation expired on {new Date(inv.expiresAt ?? '').toLocaleDateString()}. Please contact the sender for a new one.</p>
        <a href="/" class="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go home</a>
      </div>
    {:else if maxedOut}
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">Invitation already used</h1>
        <p class="mt-2 text-sm text-zinc-500">This invitation has reached its maximum number of uses. Please contact the sender for a new one.</p>
        <a href="/" class="mt-6 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">Go home</a>
      </div>
    {:else}
      <div class="text-center">
        <h1 class="text-xl font-bold text-zinc-900 dark:text-white">You're invited!</h1>
        {#if inv.sender}
          <p class="mt-2 text-sm text-zinc-500">
            {inv.sender.name ?? inv.sender.githubUsername ?? 'Someone'} invited you
            {#if inv.organization}to join <strong class="text-zinc-900 dark:text-white">{inv.organization.name}</strong>{/if}
            as a <strong class="text-zinc-900 dark:text-white">{inv.memberRole.toLowerCase()}</strong>.
          </p>
        {:else if inv.organization}
          <p class="mt-2 text-sm text-zinc-500">
            You've been invited to join <strong class="text-zinc-900 dark:text-white">{inv.organization.name}</strong>
            as a <strong class="text-zinc-900 dark:text-white">{inv.memberRole.toLowerCase()}</strong>.
          </p>
        {/if}

        {#if form?.error}
          <div class="mt-4 rounded-lg border border-red-800 bg-red-950 px-4 py-3 text-sm text-red-300">{form.error}</div>
        {/if}

        {#if data.isSignedIn}
          <form method="POST" action="?/accept" use:enhance class="mt-6">
            <button type="submit" class="rounded-lg bg-green-700 px-6 py-2.5 text-sm font-semibold text-white hover:bg-green-600">
              Accept invitation
            </button>
          </form>
        {:else}
          <div class="mt-6 space-y-4">
            <p class="text-sm text-zinc-500">Sign in or create an account to accept this invitation.</p>

            <form method="POST" action="?/sendEmail" use:enhance class="space-y-3">
              <div>
                <label for="email" class="mb-1 block text-xs text-zinc-500 dark:text-zinc-400">Email address</label>
                <input id="email" name="email" type="email" required placeholder="you@example.com"
                  value={inv.name ? '' : ''}
                  class="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder-zinc-500 focus:border-indigo-500 focus:outline-none" />
              </div>
              <button type="submit" class="w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500">
                Continue with email
              </button>
              {#if form?.emailSent}
                <p class="text-sm text-green-400">Check your inbox — we sent you a sign-in link.</p>
              {/if}
            </form>

            <div class="flex items-center gap-3">
              <hr class="flex-1 border-zinc-700" />
              <span class="text-xs text-zinc-500">or</span>
              <hr class="flex-1 border-zinc-700" />
            </div>

            <a href="{serverUrl}/auth/github?redirect=/invite/{data.slug}" class="block w-full rounded-lg bg-zinc-800 px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-zinc-700">
              Sign in with GitHub
            </a>
          </div>
        {/if}
      </div>
    {/if}
  </div>
</div>
