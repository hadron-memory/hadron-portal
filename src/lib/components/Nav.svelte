<script lang="ts">
  import { page } from '$app/stores';
  import { afterNavigate } from '$app/navigation';
  import CommandBar from './CommandBar.svelte';
  import ThemeMenu from './ThemeMenu.svelte';
  import type { ThemePreference } from '$lib/theme';

  interface Props {
    user?: { githubUsername: string | null; email: string | null; name: string | null; avatarUrl: string | null } | null;
    dark?: boolean;
    theme?: ThemePreference;
    onSetTheme?: (preference: ThemePreference) => void;
  }

  let { user, dark = true, theme = 'dark', onSetTheme }: Props = $props();

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

  // Primary marketing links. Rendered inline on sm+ and inside the mobile
  // menu below sm, so both stay in sync from one source.
  const navLinks = [
    { href: '/', label: 'Home' },
    { href: 'https://docs.hadronmemory.com', label: 'Docs', external: true },
    { href: '/contact', label: 'Contact' },
    { href: '/about', label: 'About' },
  ];

  // Below sm the inline links collapse into this toggled panel.
  let mobileMenuOpen = $state(false);

  // Close the mobile panel after any in-app navigation — covers running a
  // CommandBar command (which navigates internally, with no link click to
  // hook). External/new-tab links don't navigate, so those close via onclick.
  afterNavigate(() => (mobileMenuOpen = false));
</script>

<nav class="border-b {dark ? 'border-zinc-800 bg-zinc-950' : 'border-zinc-200 bg-white'}">
  <div class="flex items-center justify-between gap-4 px-4 py-3">
    <!-- Logo -->
    <a href="/" class="shrink-0">
      <img
        src={dark ? '/img/hadron-logo-01-round-dark-128.png' : '/img/hadron-logo-01-round-128.png'}
        alt="Hadron"
        class="h-8 w-auto"
      />
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
        {#each navLinks as link}
          <a
            href={link.href}
            target={link.external ? '_blank' : undefined}
            rel={link.external ? 'noopener' : undefined}
            class="inline-flex items-center gap-1 rounded-md px-3 py-1.5 transition {dark ? 'text-zinc-400 hover:text-white hover:bg-zinc-800' : 'text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100'}"
          >
            {link.label}
            {#if link.external}
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="opacity-50"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
            {/if}
          </a>
        {/each}
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

      <ThemeMenu preference={theme} {dark} onselect={(p) => onSetTheme?.(p)} />

      <!-- Mobile menu toggle: the inline links hide below sm, so surface them here. -->
      <button
        type="button"
        onclick={() => (mobileMenuOpen = !mobileMenuOpen)}
        class="rounded-md p-1.5 transition sm:hidden {dark ? 'text-zinc-400 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'}"
        aria-label="Menu"
        aria-expanded={mobileMenuOpen}
        aria-controls="mobile-menu"
      >
        {#if mobileMenuOpen}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
          </svg>
        {/if}
      </button>
    </div>
  </div>

  <!-- Mobile menu panel: the sm+ inline links, revealed on toggle below sm. -->
  {#if mobileMenuOpen}
    <div id="mobile-menu" class="border-t px-2 py-2 sm:hidden {dark ? 'border-zinc-800' : 'border-zinc-200'}">
      {#if showCommandBar}
        <div class="px-1 pb-2">
          <CommandBar {dark} {activeOrgId} {orgs} />
        </div>
      {/if}
      {#each navLinks as link}
        <a
          href={link.href}
          target={link.external ? '_blank' : undefined}
          rel={link.external ? 'noopener' : undefined}
          onclick={() => (mobileMenuOpen = false)}
          class="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm transition {dark ? 'text-zinc-300 hover:text-white hover:bg-zinc-800' : 'text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100'}"
        >
          {link.label}
          {#if link.external}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="opacity-50"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          {/if}
        </a>
      {/each}
    </div>
  {/if}
</nav>
