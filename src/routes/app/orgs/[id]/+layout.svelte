<script lang="ts">
  // #336: org-detail is a tab layout. The layout renders the breadcrumb +
  // header + tab bar; each tab is a sub-route rendered via {@render children()}.
  //
  // The tabs cover the org's OWN sections — Profile (overview), Team,
  // Integrations, Channels, Usage. Memories / Agents / Apps are top-level destinations
  // (sidebar nav in app/+layout.svelte), NOT org sub-pages: they live under
  // this route for org-scoped data loading but are absent from `tabs`, so they
  // render via {@render children()} WITHOUT the breadcrumb/tab-bar chrome.
  import { page } from '$app/stores';
  import Urn from '$lib/components/Urn.svelte';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';
  import { scrollHint } from '$lib/scroll-hint';
  import type { LayoutData } from './$types';

  let { data, children }: { data: LayoutData; children: import('svelte').Snippet } = $props();

  const basePath = $derived(`/app/orgs/${data.org.id}`);

  // Consumer-mode users only get the dashboard (Profile); their other sections
  // (Memories) live in the sidebar nav and the admin sub-routes redirect them
  // away anyway. Full-mode org sections: Profile, Team, Integrations, Usage.
  const tabs = $derived(
    data.isConsumerMode
      ? [
          { id: 'profile', label: t('org-detail.tab.profile', 'Profile'), href: basePath },
        ]
      : [
          { id: 'profile', label: t('org-detail.tab.profile', 'Profile'), href: basePath },
          { id: 'team', label: t('org-detail.tab.team', 'Team'), href: `${basePath}/members` },
          { id: 'integrations', label: t('org-detail.tab.integrations', 'Integrations'), href: `${basePath}/integrations` },
          // #942: the org's Channels and its own register rows.
          { id: 'channels', label: t('org-detail.tab.channels', 'Channels'), href: `${basePath}/channels` },
          { id: 'node-role-templates', label: t('config.templates', 'Node-role templates'), href: `${basePath}/node-role-templates` },
          { id: 'usage', label: t('org-detail.tab.usage', 'Usage'), href: `${basePath}/sessions` },
        ],
  );

  // The tab chrome is shown only on the tab routes themselves. Deeper pages
  // (e.g. /memories/new, /apps/[appId], /create-chatbot, /exchange/...) bring
  // their own full-page chrome — match on exact pathname so they opt out.
  const path = $derived($page.url.pathname);
  const activeTab = $derived(tabs.find((tb) => path === tb.href));
  const showChrome = $derived(!!activeTab);
  // #364: the "Organization: <name>" caption + URN belong to the Profile tab
  // only. On every other tab the sub-route renders its own section heading
  // (Memories / Agents / Apps / …) as the page caption.
  // #729: which is also why the org symbol sits INSIDE that block rather than
  // beside the breadcrumb — a building glyph next to "Members" or "Usage" would
  // be marking the wrong noun.
  const isProfile = $derived(activeTab?.id === 'profile');
</script>

<div class="space-y-4">
  {#if showChrome}
    <div class="mb-4">
      <!-- On sub-tabs the org H1 is gone, so link the org crumb back to Profile. -->
      <Breadcrumb items={[
        { label: 'Organizations', href: '/app/orgs' },
        isProfile ? { label: data.org.name } : { label: data.org.name, href: basePath },
      ]} />
      {#if isProfile}
        <h1 class="mt-1 flex items-center gap-2 text-2xl font-bold text-zinc-900 dark:text-white">
          <!-- #729: an org reads as a company, not as another record — mark it
               in the header the way a runnable node is marked (#322) and a chat
               node since #722. Same family as those glyphs: 24-box, stroke 2,
               round joins, indigo. `h-6 w-6` rather than the node page's `h-5`
               because this caption is `text-2xl` (24px) where that one is
               `text-xl` (20px) — the mark tracks the type size it sits beside.
               `aria-hidden` because the caption right of it already says
               "Organization:"; this is a second rendering of a word that is
               present, not information only available as a picture. -->
          <svg data-testid="org-symbol" class="h-6 w-6 shrink-0 text-indigo-500 dark:text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"></path>
            <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"></path>
            <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"></path>
            <path d="M10 6h4"></path>
            <path d="M10 10h4"></path>
            <path d="M10 14h4"></path>
            <path d="M10 18h4"></path>
          </svg>
          <!-- An org name is user-chosen free text, so a long unbroken one is
               reachable. `min-w-0 break-words` is ONE remedy in two classes,
               and neither half works alone — measured at 375px with a 51-char
               unbroken name, horizontal overflow past the viewport:

                 before this icon ............. 345px   (already broken)
                 with the icon, neither class .. 377px  (+32 = glyph + gap)
                 + break-words only ............ 377px  (no change)
                 + min-w-0 only ................ 377px  (no change)
                 + both ......................... 18px  (the tab strip alone)

               `min-w-0` lets the flex item shrink below its longest word;
               `break-words` gives that word somewhere to go. With only the
               first the word still cannot break, and with only the second the
               item never shrinks far enough to need to. The 18px floor is a
               pre-existing tab-strip overflow, not this header.
               (hrn:node:hadronmemory.com:hadron-portal:review:content-sized-control-needs-min-w-0) -->
          <span class="min-w-0 break-words"><span class="font-normal text-zinc-400">{t('org-detail.prefix.organization', 'Organization:')}</span> {data.org.name}</span>
        </h1>
        <Urn value={data.org.urn} type="org" />
      {/if}
    </div>

    {#if tabs.length > 1}
      <!-- #858 — scrolls rather than overflowing. The scroller is this inner
           <div>, not the <nav>: the nav is the `justify-between` rail carrying
           the underline, so `min-w-0` here is what lets the tab row shrink
           below its content and scroll (the `/app/assets` shape).
           Measured at 390px: four tabs are 328px in a 327px column — this sits
           exactly at the edge, like the two #859 found at 308/308. Adding one
           tab put 76px of the page off the right of a phone screen; with this
           fix the same five tabs scroll by 92px and document overflow is 0. -->
      <nav aria-label={t('org-detail.nav.aria-label', 'Organization sections')} class="mb-4 flex items-end justify-between border-b border-zinc-200 dark:border-zinc-800">
        <!-- #1086: edge fade + active tab kept in view (src/lib/scroll-hint.ts). -->
        <div class="scroll-hint flex min-w-0 gap-0 overflow-x-auto" use:scrollHint={activeTab?.id}>
          {#each tabs as tab (tab.id)}
            <a
              href={tab.href} data-sveltekit-preload-data={tab.id === 'node-role-templates' ? 'off' : undefined}
              aria-current={activeTab?.id === tab.id ? 'page' : undefined}
              class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition
                {activeTab?.id === tab.id
                  ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                  : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
            >{tab.label}</a>
          {/each}
        </div>
      </nav>
    {/if}
  {/if}

  {@render children()}
</div>
