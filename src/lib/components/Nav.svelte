<script lang="ts">
  interface Props {
    user?: { githubUsername: string | null; email: string | null; name: string | null; avatarUrl: string | null } | null;
    dark?: boolean;
    onToggleTheme?: () => void;
  }

  let { user, dark = true, onToggleTheme }: Props = $props();
</script>

<nav class="border-b {dark ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'}">
  <div class="flex items-center justify-between px-4 py-3">
    <!-- Logo -->
    <a href="/">
      <img src={dark ? '/img/hadron-logo-v2-dark.png' : '/img/hadron-logo-v2.png'} alt="Hadron" class="h-9 w-auto" />
    </a>

    <!-- Right side: nav links + auth + theme -->
    <div class="flex items-center gap-2">
      <div class="hidden items-center gap-1 text-sm sm:flex">
        <a href="/" class="rounded-md px-3 py-1.5 transition {dark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}">Home</a>
        <a href="/contact" class="rounded-md px-3 py-1.5 transition {dark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}">Contact</a>
        <a href="/about" class="rounded-md px-3 py-1.5 transition {dark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}">About</a>
      </div>

      {#if user}
        <a
          href="/app/dashboard"
          class="ml-2 rounded-md px-4 py-1.5 text-sm font-medium transition"
          style="background: #ffb703; color: #023047;"
        >
          Dashboard
        </a>
      {:else}
        <a
          href="/signin"
          class="ml-2 rounded-md px-4 py-1.5 text-sm font-medium transition"
          style="background: #ffb703; color: #023047;"
        >
          Sign in
        </a>
      {/if}

      <button
        type="button"
        onclick={() => onToggleTheme?.()}
        class="rounded-md p-1.5 transition {dark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'}"
        title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {#if dark}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        {/if}
      </button>
    </div>
  </div>
</nav>
