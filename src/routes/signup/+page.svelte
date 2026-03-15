<script lang="ts">
  import { page } from '$app/state';
  import { env } from '$env/dynamic/public';

  const controllerUrl = env.PUBLIC_CONTROLLER_URL ?? 'http://localhost:4000';

  // If coming from marketplace with a graph param, redirect back there after auth
  const graphId = $derived(page.url.searchParams.get('graph'));
  const postAuthRedirect = $derived(
    graphId ? `/browse?addGraph=${graphId}` : '/app/dashboard'
  );
  const githubUrl = $derived(
    `${controllerUrl}/auth/github?redirect=${encodeURIComponent(postAuthRedirect)}`
  );

  let email = $state('');
  let submitted = $state(false);
  let error = $state('');
  let loading = $state(false);

  async function handleEmail(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    loading = true;
    try {
      const res = await fetch(`${controllerUrl}/auth/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        const data = await res.json();
        error = data.error ?? 'Something went wrong';
      } else {
        submitted = true;
      }
    } catch {
      error = 'Could not connect to server';
    } finally {
      loading = false;
    }
  }
</script>

<svelte:head>
  <title>Create Account — Hadron</title>
</svelte:head>

<div class="flex min-h-[60vh] items-center justify-center px-4">
  <div class="w-full max-w-sm">
    <h1 class="mb-2 text-center text-2xl font-bold text-zinc-900 dark:text-white">Create Account</h1>
    <p class="mb-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
      Get started with Hadron
    </p>

    {#if submitted}
      <div class="rounded-lg border border-green-800 bg-green-950 px-4 py-3 text-sm text-green-300">
        Check your email for a sign-in link. You can close this page.
      </div>
    {:else}
      <!-- GitHub -->
      <a
        href={githubUrl}
        class="flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 transition hover:border-zinc-400 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-500 dark:hover:text-white"
      >
        <svg class="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12Z"/>
        </svg>
        Continue with GitHub
      </a>

      <div class="my-6 flex items-center gap-3">
        <div class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></div>
        <span class="text-xs text-zinc-500">or</span>
        <div class="h-px flex-1 bg-zinc-200 dark:bg-zinc-800"></div>
      </div>

      <!-- Email -->
      <form onsubmit={handleEmail}>
        <label for="email" class="mb-1.5 block text-sm font-medium text-zinc-700 dark:text-zinc-300">Email</label>
        <input
          id="email"
          type="email"
          required
          bind:value={email}
          placeholder="you@example.com"
          class="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 placeholder-zinc-400 focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white dark:placeholder-zinc-500"
        />
        {#if error}
          <p class="mt-2 text-sm text-red-500">{error}</p>
        {/if}
        <button
          type="submit"
          disabled={loading}
          class="mt-3 w-full rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Sending...' : 'Continue with Email'}
        </button>
      </form>
    {/if}

    <p class="mt-6 text-center text-sm text-zinc-500 dark:text-zinc-400">
      Already have an account? <a href="/signin{graphId ? `?graph=${graphId}` : ''}" class="text-indigo-600 hover:text-indigo-500 dark:text-indigo-400">Sign in</a>
    </p>
  </div>
</div>
