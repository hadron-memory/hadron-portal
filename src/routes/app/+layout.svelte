<script lang="ts">
  import type { LayoutData } from './$types';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/t';
  import { apiKeysStrings } from '$lib/i18n/api-keys-strings';
  import OrgSwitcher from '$lib/components/OrgSwitcher.svelte';
  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  // Spec 014: top-level nav is keyed to the active organization. The
  // legacy bare /app/agents, /app/apps, /app/memories paths are still
  // accepted (they 302 to the org-scoped equivalents per FR-008), but the
  // nav itself uses the org-scoped URLs so the right entry highlights
  // immediately and there's no extra redirect on click.
  const consumerNav = $derived(data.activeOrgId
    ? [
        { href: `/app/orgs/${data.activeOrgId}`,          label: t('app.nav.dashboard', 'Dashboard'), match: 'exact' as const },
        { href: `/app/orgs/${data.activeOrgId}/memories`, label: t('app.nav.memories', 'Memories'),   match: 'prefix' as const },
      ]
    : [],
  );

  const fullNav = $derived(data.activeOrgId
    ? [
        { href: `/app/orgs/${data.activeOrgId}`,          label: t('app.nav.dashboard', 'Dashboard'), match: 'exact' as const },
        { href: `/app/orgs/${data.activeOrgId}/memories`, label: t('app.nav.memories', 'Memories'),   match: 'prefix' as const },
        { href: `/app/orgs/${data.activeOrgId}/agents`,   label: t('app.nav.agents', 'Agents'),       match: 'prefix' as const },
        { href: `/app/orgs/${data.activeOrgId}/apps`,     label: t('app.nav.apps', 'Apps'),           match: 'prefix' as const },
      ]
    : [],
  );

  const usageNav = [
    { href: '/app/usage/sessions', label: t('app.nav.usage.sessions', 'Sessions') },
    { href: '/app/usage/memory',   label: t('app.nav.usage.memory', 'Memory') },
  ];

  const navItems = $derived(data.isConsumerMode ? consumerNav : fullNav);

  // Spec 014: ORGANIZATIONS section removed (FR-003). The active org now
  // surfaces under the "Signed in as" block instead. The org switcher
  // (US2) is added in a follow-up component mount.

  function isActive(href: string, match: 'exact' | 'prefix', pathname: string): boolean {
    if (match === 'exact') {
      return pathname === href || pathname === href + '/';
    }
    // Use '/'-boundary prefix match so `/app/orgs/1` doesn't claim
    // `/app/orgs/10` as a sub-path. Per gemini-code-assist review on #210.
    return pathname === href || pathname.startsWith(href + '/');
  }

  let menuOpen = $state(true);
</script>

<div class="flex gap-8 px-6 py-8">
  <!-- Sidebar — sticky, sized to the available height; the nav scrolls
       internally (`flex-1 min-h-0 overflow-y-auto`) while the account block
       stays pinned at the bottom (`shrink-0`) on long pages (#231/#245).

       Height is `calc(100dvh - 8rem)`, NOT `- 4rem`. The sidebar sits BELOW
       the top <Nav> header bar (~4rem) plus this row's 2rem top padding, so
       at scroll 0 — before `position: sticky` engages — its top edge is ~6rem
       down the viewport. With only 4rem subtracted, the bottom of the sidebar
       (the account widget) landed ~2rem BELOW the viewport and was clipped
       until the user scrolled far enough for sticky to pull it up to `top-8`
       — exactly the "cut off until you scroll" symptom in #264. Subtracting
       8rem clears the Nav + top padding + a bottom gap so the widget is fully
       visible at scroll 0, in the stuck state, and at every scroll between.
       `dvh` tracks the visible viewport (mobile UI bars); the `vh` line is a
       fallback for browsers without `dvh` support. The offset is a CSS var so
       it's stated once (cf. --memory-browser-h in MemoryBrowser.svelte);
       min==max height collapses to a plain `height`. -->
  {#if menuOpen}
    <aside
      class="sticky top-8 self-start flex w-48 shrink-0 flex-col"
      style="--sidebar-offset: 8rem; height: calc(100vh - var(--sidebar-offset)); height: calc(100dvh - var(--sidebar-offset));"
    >
      <div class="mb-4 flex items-center justify-end shrink-0">
        <button onclick={() => menuOpen = false} class="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" title={t('app.layout.collapse-menu', 'Collapse menu')}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      </div>
      <nav class="flex flex-1 min-h-0 flex-col gap-1 overflow-y-auto">
      {#each navItems as item}
        <a
          href={item.href}
          class="rounded-md px-3 py-2 text-sm transition
            {isActive(item.href, item.match, $page.url.pathname)
              ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
              : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white'}"
        >
          {item.label}
        </a>
      {/each}
      {#if !data.isConsumerMode}
        <hr class="my-2 border-zinc-200 dark:border-zinc-800" />
        <span class="px-3 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-600">{t('app.nav.usage.section', 'Usage')}</span>
        {#each usageNav as item}
          <a
            href={item.href}
            class="rounded-md px-3 py-2 text-sm transition
              {$page.url.pathname.startsWith(item.href)
                ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
                : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white'}"
          >
            {item.label}
          </a>
        {/each}
      {/if}
      <hr class="my-2 border-zinc-200 dark:border-zinc-800" />
      <a
        href="/app/account/api-keys"
        class="rounded-md px-3 py-2 text-sm transition
          {$page.url.pathname.startsWith('/app/account/api-keys')
            ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white'
            : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white'}"
      >
        {apiKeysStrings.navLabel()}
      </a>
      <a
        href="https://docs.hadronmemory.com"
        target="_blank"
        rel="noopener"
        class="rounded-md px-3 py-2 text-sm transition text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white flex items-center gap-1.5"
      >
        {t('app.nav.docs', 'Docs')}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="opacity-50"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      </a>
    </nav>
      <!-- User avatar + name + active-org pinned to bottom. #264: the org
           name (and switcher, when present) sits directly below the user's
           name as a third line in the same block — no "Organization" label.
           Avatar and name both link to /app/account; the org line is a
           sibling so it can host the OrgSwitcher button (a button can't be
           nested inside the account <a>).
           The "Signed in as" label sits on its own row ABOVE the avatar/name
           row, so the avatar aligns with the name intrinsically (`items-center`)
           — no magic margin that would misalign if the localized label wraps. -->
      <div class="shrink-0 pt-4">
        <hr class="mb-3 border-zinc-200 dark:border-zinc-800" />
        <div class="rounded-md px-3 py-2
          {$page.url.pathname.startsWith('/app/account')
            ? 'text-zinc-900 dark:text-white'
            : 'text-zinc-500 dark:text-zinc-400'}">
          <p class="mb-1 text-[10px] text-zinc-400">{t('app.layout.signed-in-as', 'Signed in as')}</p>
          <div class="flex items-center gap-3">
            <a href="/app/account" class="shrink-0 transition hover:opacity-80" aria-label={t('app.layout.account', 'Account')}>
              {#if data.user.avatarUrl}
                <img src={data.user.avatarUrl} alt="" class="h-8 w-8 rounded-full" />
              {:else}
                <div class="h-8 w-8 rounded-full bg-zinc-200 dark:bg-zinc-700"></div>
              {/if}
            </a>
            <div class="min-w-0 flex-1">
              <a href="/app/account" class="block truncate text-sm transition hover:text-zinc-900 dark:hover:text-white
                {$page.url.pathname.startsWith('/app/account') ? 'font-medium' : ''}">
                {data.user.name ?? data.user.githubUsername ?? data.user.email}
              </a>
              <!-- Spec 014 FR-004 + US2 / #264: active org directly under the
                   name. Switcher renders only for multi-membership, non-consumer
                   users (FR-010 keeps it off for single-personal-org accounts);
                   each option opens that org in a new tab (R-3). A single-org
                   user gets a static name line — no dropdown to nowhere. -->
              {#if !data.isConsumerMode && data.activeOrg && data.orgs.length > 1}
                <OrgSwitcher activeOrg={data.activeOrg} orgs={data.orgs} />
              {:else if !data.isConsumerMode && data.activeOrg}
                <p class="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400" data-testid="active-org-name">
                  {data.activeOrg.name}
                </p>
              {/if}
            </div>
          </div>
        </div>
      </div>
  </aside>
  {:else}
    <button
      onclick={() => menuOpen = true}
      class="self-start rounded-md border border-zinc-200 p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
      title={t('app.layout.expand-menu', 'Expand menu')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  {/if}

  <!-- Content -->
  <div class="min-w-0 flex-1">
    {@render children()}
  </div>
</div>
