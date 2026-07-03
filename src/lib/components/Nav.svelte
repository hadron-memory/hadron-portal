<script lang="ts">
  import { page } from '$app/stores';
  import CommandBar from './CommandBar.svelte';

  interface Props {
    user?: { githubUsername: string | null; email: string | null; name: string | null; avatarUrl: string | null } | null;
    dark?: boolean;
    onToggleTheme?: () => void;
  }

  let { user, dark = true, onToggleTheme }: Props = $props();

  // #320: the command bar only makes sense for a signed-in user inside the app
  // shell — every action targets an /app/* route. Hide it on the public
  // marketing pages (even when signed in) and whenever signed out. Match the
  // '/app/' prefix (with trailing slash) so sibling routes like /apps or
  // /approve don't match — every real app page lives under /app/.
  const showCommandBar = $derived(!!user && $page.url.pathname.startsWith('/app/'));

  // #340: the "Dashboard" button only serves to get INTO the app shell. On /app
  // routes the sidebar already carries a Dashboard link, so it's redundant
  // there. `showCommandBar` is already true exactly when the user is signed in
  // AND on an /app/ route, so `user && !showCommandBar` means "signed in and not
  // in the app shell" — no separate derived needed.

  // #339: the command bar needs the active org PK (for /app/orgs/<pk>/… routes)
  // and the user's member orgs (for the "switch" picker). Both ride $page.data
  // from the /app/ layout; Nav lives in the root layout, so read them off the
  // page store. The layout key is `navOrgs`, NOT `orgs` — child routes (e.g.
  // /app/orgs) return their own page-local `orgs`, and SvelteKit's merged
  // $page.data would let the child value shadow the layout's membership list
  // (PR #452 Codex P2).
  const pageData = $derived(
    $page.data as unknown as { activeOrgId?: string | null; navOrgs?: { id: string; name: string }[] },
  );
  const activeOrgId = $derived(pageData.activeOrgId ?? null);
  const orgs = $derived(pageData.navOrgs ?? []);
</script>

<nav class="border-b {dark ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'}">
  <div class="flex items-center justify-between gap-4 px-4 py-3">
    <!-- Logo -->
    <a href="/" class="shrink-0">
      <img src={dark ? '/img/hadron-logo-v2-dark.png' : '/img/hadron-logo-v2.png'} alt="Hadron" class="h-9 w-auto" />
    </a>

    <!-- #320: command/search bar — signed-in users, inside the app shell only.
         Centered, takes the slack between the logo and the right-side controls.
         #337: widen progressively on larger viewports — there's plenty of slack
         on wide screens, and flex-1 still lets it shrink on smaller ones. -->
    {#if showCommandBar}
      <div class="relative hidden min-w-0 flex-1 justify-center sm:flex">
        <div class="w-full max-w-md lg:max-w-xl xl:max-w-2xl 2xl:max-w-3xl"><CommandBar {dark} {activeOrgId} {orgs} /></div>
      </div>
    {/if}

    <!-- Right side: nav links + auth + theme -->
    <div class="flex items-center gap-2">
      <div class="hidden items-center gap-1 text-sm sm:flex">
        <a href="/" class="rounded-md px-3 py-1.5 transition {dark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}">Home</a>
        <a href="https://docs.hadronmemory.com" target="_blank" rel="noopener" class="inline-flex items-center gap-1 rounded-md px-3 py-1.5 transition {dark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}">
          Docs
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="opacity-50"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        </a>
        <a href="/contact" class="rounded-md px-3 py-1.5 transition {dark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}">Contact</a>
        <a href="/about" class="rounded-md px-3 py-1.5 transition {dark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}">About</a>
      </div>

      {#if user && !showCommandBar}
        <a
          href="/app/dashboard"
          class="ml-2 rounded-md px-4 py-1.5 text-sm font-medium transition"
          style="background: #ffb703; color: #023047;"
        >
          Dashboard
        </a>
      {:else if !user}
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
