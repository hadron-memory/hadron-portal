<script lang="ts">
  import { env } from '$env/dynamic/public';

  interface Props {
    user?: { githubUsername: string; name: string | null; avatarUrl: string | null } | null;
    dark?: boolean;
    onToggleTheme?: () => void;
  }

  let { user, dark = true, onToggleTheme }: Props = $props();

  const controllerUrl = env.PUBLIC_CONTROLLER_URL ?? 'http://localhost:4000';

  function signInUrl(redirect = '/app/dashboard') {
    return `${controllerUrl}/auth/github?redirect=${encodeURIComponent(redirect)}`;
  }

  let menuOpen = $state(false);
  const menuLinkClass = $derived(
    dark
      ? 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
      : 'text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900'
  );
</script>

<nav class="border-b {dark ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'}">
  <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
    <!-- Logo -->
    <a href="/">
      <img src={dark ? '/img/hadron-logo-v2-dark.png' : '/img/hadron-logo-v2.png'} alt="Hadron" class="h-9 w-auto" />
    </a>

    <!-- Centre links -->
    <div class="hidden items-center gap-6 text-sm sm:flex {dark ? 'text-zinc-400' : 'text-zinc-500'}">
      <a href="/browse" class="transition {dark ? 'hover:text-white' : 'hover:text-zinc-900'}">Browse graphs</a>
      {#if user}
        <a href="/app/dashboard" class="transition {dark ? 'hover:text-white' : 'hover:text-zinc-900'}">Dashboard</a>
      {/if}
    </div>

    <!-- Auth + theme toggle -->
    <div class="flex items-center gap-3">
      <!-- Theme toggle -->
      <button
        type="button"
        onclick={() => onToggleTheme?.()}
        class="rounded-md p-1.5 transition {dark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'}"
        title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {#if dark}
          <!-- Sun -->
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        {:else}
          <!-- Moon -->
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {/if}
      </button>

      {#if user}
        <div class="relative">
          <button
            type="button"
            onclick={() => (menuOpen = !menuOpen)}
            class="flex items-center gap-2 rounded-full text-sm transition {dark ? 'text-zinc-300 hover:text-white' : 'text-zinc-600 hover:text-zinc-900'}"
          >
            {#if user.avatarUrl}
              <img src={user.avatarUrl} alt={user.githubUsername} class="h-7 w-7 rounded-full" />
            {/if}
            <span class="hidden sm:inline">{user.name ?? user.githubUsername}</span>
            <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>

          {#if menuOpen}
            <div
              class="absolute right-0 mt-2 w-44 rounded-lg border py-1 shadow-xl {dark ? 'border-zinc-800 bg-zinc-900' : 'border-zinc-200 bg-white'}"
              role="menu"
            >
              <a href="/app/dashboard" class="block px-4 py-2 text-sm {menuLinkClass}" role="menuitem" onclick={() => (menuOpen = false)}>Dashboard</a>
              <a href="/app/orgs" class="block px-4 py-2 text-sm {menuLinkClass}" role="menuitem" onclick={() => (menuOpen = false)}>Organizations</a>
              <a href="/app/clients" class="block px-4 py-2 text-sm {menuLinkClass}" role="menuitem" onclick={() => (menuOpen = false)}>Clients</a>
              <hr class="my-1 {dark ? 'border-zinc-800' : 'border-zinc-200'}" />
              <a href="/auth/signout" class="block px-4 py-2 text-sm {dark ? 'text-zinc-400 hover:bg-zinc-800 hover:text-white' : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900'}" role="menuitem">Sign out</a>
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
