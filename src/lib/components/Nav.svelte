<script lang="ts">
  import { env } from '$env/dynamic/public';

  interface Props {
    user?: { login: string; name: string | null; avatarUrl: string | null } | null;
  }

  let { user }: Props = $props();

  const controllerUrl = env.PUBLIC_CONTROLLER_URL ?? 'http://localhost:4000';

  function signInUrl(redirect = '/app/dashboard') {
    return `${controllerUrl}/auth/github?redirect=${encodeURIComponent(redirect)}`;
  }

  let menuOpen = $state(false);
</script>

<nav class="border-b border-zinc-800 bg-zinc-950">
  <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
    <!-- Logo -->
    <a href="/" class="flex items-center gap-2 font-semibold text-white">
      <svg class="h-6 w-6 text-indigo-400" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="3" />
        <circle cx="4" cy="6" r="2" />
        <circle cx="20" cy="6" r="2" />
        <circle cx="4" cy="18" r="2" />
        <circle cx="20" cy="18" r="2" />
        <line x1="12" y1="12" x2="4" y2="6" stroke="currentColor" stroke-width="1.5" />
        <line x1="12" y1="12" x2="20" y2="6" stroke="currentColor" stroke-width="1.5" />
        <line x1="12" y1="12" x2="4" y2="18" stroke="currentColor" stroke-width="1.5" />
        <line x1="12" y1="12" x2="20" y2="18" stroke="currentColor" stroke-width="1.5" />
      </svg>
      Hadron
    </a>

    <!-- Centre links -->
    <div class="hidden items-center gap-6 text-sm text-zinc-400 sm:flex">
      <a href="/browse" class="transition hover:text-white">Browse graphs</a>
      {#if user}
        <a href="/app/dashboard" class="transition hover:text-white">Dashboard</a>
      {/if}
    </div>

    <!-- Auth -->
    <div class="flex items-center gap-3">
      {#if user}
        <div class="relative">
          <button
            onclick={() => (menuOpen = !menuOpen)}
            class="flex items-center gap-2 rounded-full text-sm text-zinc-300 transition hover:text-white"
          >
            {#if user.avatarUrl}
              <img src={user.avatarUrl} alt={user.login} class="h-7 w-7 rounded-full" />
            {/if}
            <span class="hidden sm:inline">{user.name ?? user.login}</span>
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>

          {#if menuOpen}
            <div
              class="absolute right-0 mt-2 w-44 rounded-lg border border-zinc-800 bg-zinc-900 py-1 shadow-xl"
              role="menu"
            >
              <a href="/app/dashboard" class="block px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white" role="menuitem" onclick={() => (menuOpen = false)}>Dashboard</a>
              <a href="/app/orgs" class="block px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white" role="menuitem" onclick={() => (menuOpen = false)}>Organizations</a>
              <a href="/app/clients" class="block px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white" role="menuitem" onclick={() => (menuOpen = false)}>Clients</a>
              <hr class="my-1 border-zinc-800" />
              <a href="/auth/signout" class="block px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-white" role="menuitem">Sign out</a>
            </div>
          {/if}
        </div>
      {:else}
        <a
          href={signInUrl()}
          class="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          Sign in with GitHub
        </a>
      {/if}
    </div>
  </div>
</nav>
