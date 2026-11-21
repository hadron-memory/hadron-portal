<script lang="ts">
  import NodeAdvice from '$lib/components/NodeAdvice.svelte';
  import type { LayoutData } from './$types';
  import { page } from '$app/stores';
  import { t } from '$lib/i18n/t';
  import OrgSwitcher from '$lib/components/OrgSwitcher.svelte';
  import ImpersonationBanner from '$lib/components/ImpersonationBanner.svelte';
  import { buildNavItems } from '$lib/nav';
  import { APP_SHELL_ROW, APP_SHELL_CONTENT, appShellNavClass } from '$lib/layout/app-shell';
  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  // Nodes/Graph share the persistent memory browser. Keep that sibling outlet
  // while preserving #339 teardown for every other route/depth transition.
  const outletKey = $derived(
    $page.route.id === '/app/memories/[id]/nodes' || $page.route.id === '/app/memories/[id]/graph'
      ? '/app/memories/[id]/browse' : $page.route.id,
  );

  // Spec 014: top-level nav is keyed to the active organization. Consumer
  // (individual) users get a trimmed list, and #628 points their "Memories" at
  // the org-less /app/memories surface instead of their personal org's grid.
  // See $lib/nav for the (unit-tested) routing decisions.
  const navItems = $derived(
    buildNavItems({ activeOrgId: data.activeOrgId, isConsumerMode: data.isConsumerMode }),
  );

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

  // #740: three states, not two. `null` means "nobody has chosen — follow the
  // viewport", and is the initial state; `true`/`false` are an explicit user
  // choice that holds at every width.
  //
  // The viewport half is decided by CSS breakpoints below, NOT by matchMedia in
  // an $effect. The portal server-renders under adapter-node, so a JS-decided
  // default is necessarily wrong in the SSR'd HTML and corrects itself on
  // hydration — a visible flash of a 192px sidebar on the phone this exists to
  // fix, and a hydration mismatch besides. CSS is evaluated before first paint
  // and needs no JS at all.
  let menuOpen: boolean | null = $state(null);
</script>

{#if data.impersonation}
  <ImpersonationBanner
    targetName={data.user?.name ?? data.user?.handle ?? data.user?.id ?? ''}
    expiresAt={data.impersonation.expiresAt}
  />
{/if}
<!-- #740: gutters and gap tighten below `sm`. At 375px the old fixed
     `px-6`/`gap-8` spent 80px of 375 on whitespace before the content column
     saw a single pixel. -->
<div class={APP_SHELL_ROW}>
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
  {#if menuOpen !== false}
    <aside
      class={appShellNavClass(menuOpen)}
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
      <!-- #327: active-org block moved up here (under the nav items). The org
           name is static; the OrgSwitcher renders a "Switch" button beside it,
           only when the user belongs to more than one org. -->
      {#if !data.isConsumerMode && data.activeOrg}
        <hr class="mt-2 mb-0 border-zinc-200 dark:border-zinc-800" />
        <div class="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase leading-none tracking-wider text-zinc-400 dark:text-zinc-500">
          {t('app.layout.organization-section', 'Organization')}
        </div>
        <div class="px-3 py-1.5">
          <a
            href={`/app/orgs/${data.activeOrg.id}`}
            class="block truncate text-sm font-medium text-zinc-700 transition hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white"
            data-testid="active-org-name"
          >{data.activeOrg.name}</a>
          {#if data.navOrgs.length > 1}
            <div class="mt-1.5">
              <OrgSwitcher activeOrg={data.activeOrg} orgs={data.navOrgs} />
            </div>
          {/if}
        </div>
      {/if}
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
      <!-- #327: bottom block is now just the avatar + user name, linking to the
           account page. The active-org line moved up under the nav items. -->
      <div class="shrink-0 pt-4">
        <hr class="mb-0 border-zinc-200 dark:border-zinc-800" />
        <div class="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase leading-none tracking-wider text-zinc-400 dark:text-zinc-500">
          {t('app.layout.user-account-section', 'User Account')}
        </div>
        <a href="/app/account" aria-label={t('app.layout.account', 'Account')}
          class="flex items-center gap-3 rounded-md px-3 py-2 transition hover:bg-zinc-100 dark:hover:bg-zinc-900
            {$page.url.pathname.startsWith('/app/account')
              ? 'text-zinc-900 dark:text-white'
              : 'text-zinc-500 dark:text-zinc-400'}">
          {#if data.user.avatarUrl}
            <img src={data.user.avatarUrl} alt="" class="h-8 w-8 shrink-0 rounded-full" />
          {:else}
            <div class="h-8 w-8 shrink-0 rounded-full bg-zinc-200 dark:bg-zinc-700"></div>
          {/if}
          <span class="min-w-0 flex-1 truncate text-sm {$page.url.pathname.startsWith('/app/account') ? 'font-medium' : ''}">
            @{data.user.handle}
          </span>
        </a>
      </div>
  </aside>
  {/if}
  <!-- The expand affordance is the complement of the aside above, and the two
       {#if}s are deliberately independent rather than one if/else: in the
       `null` state BOTH are in the DOM and the breakpoint picks which one is
       displayed. `hidden` is `display:none`, so the one that loses is out of
       the accessibility tree too, not merely invisible. -->
  {#if menuOpen !== true}
    <button
      onclick={() => menuOpen = true}
      class="self-start rounded-md border border-zinc-200 p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:border-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-300 {menuOpen ===
      null
        ? 'sm:hidden'
        : ''}"
      title={t('app.layout.expand-menu', 'Expand menu')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </button>
  {/if}

  <!-- Content -->
  <div class={APP_SHELL_CONTENT}>
    <NodeAdvice advice={data.nodeAdvice ?? []} />
    <!-- #339: key the outlet on the route id. Svelte 5 / Kit 2 don't tear down
         the previous page in this {@render children()} outlet when the child
         layout DEPTH changes (e.g. /app/orgs/[id]/members — a direct child —
         navigating to /app/account/*, which adds the account layout): the two
         pages stack. Keying on route.id forces teardown on each route change
         while still reusing the page across param-only navs (same route.id).
         #1277: Nodes/Graph are same-depth siblings with one persistent browser;
         their shared key keeps filters across that pair only. -->
    {#key outletKey}
      {@render children()}
    {/key}
  </div>
</div>
