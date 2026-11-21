<script lang="ts">
  // portal#696 part 1 — the top-level Files section, parallel to Memories.
  //
  // Three slices of ONE query (hadron-server#895's cross-memory `assets()`):
  // my uploads, everything I can read, and the active org's. The slice rides the
  // URL (`?tab=`) rather than component state, so a tab is linkable, survives a
  // reload, and re-runs the loader — the filtering is server-side, so it has to.
  import { page } from '$app/stores';
  import { invalidate } from '$app/navigation';
  import AssetTable from '$lib/components/assets/AssetTable.svelte';
  import { t } from '$lib/i18n/t';
  import { ALL_ASSETS_DEP } from '$lib/assets/deps';
  import { ASSET_TABS, type AssetTab } from '$lib/assets/tabs';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const rows = $derived(data.assets);
  const activeTab = $derived(data.tab as AssetTab);

  const tabLabels: Record<AssetTab, string> = {
    mine: t('assets-page.tab.mine', 'My files'),
    available: t('assets-page.tab.available', 'Available files'),
    org: t('assets-page.tab.org', 'Organization files'),
  };
  const tabHints: Record<AssetTab, string> = {
    mine: t('assets-page.hint.mine', 'Files that were attached to memories'),
    available: t(
      'assets-page.hint.available',
      'Every file in every memory you can read — including files a colleague uploaded and files an agent run stored.',
    ),
    org: t('assets-page.hint.org', 'Files in this organization’s memories.'),
  };

  function href(tab: AssetTab): string {
    return `/app/assets?tab=${tab}`;
  }

  function refresh() {
    return invalidate(ALL_ASSETS_DEP);
  }

  // Uploads happen on a memory (a file has to land somewhere), so this section is
  // read + manage only. Point at the memory list rather than leaving a dead end.
  const uploadHint = $derived(
    $page.data.activeOrgId
      ? `/app/orgs/${$page.data.activeOrgId}/memories`
      : '/app/memories',
  );
</script>

<svelte:head><title>Files &middot; Hadron</title></svelte:head>

<div class="space-y-4">
  <div>
    <h1 class="text-lg font-semibold text-zinc-900 dark:text-white">{t('assets-page.title', 'Files')}</h1>
    <p class="mt-1 max-w-3xl text-sm text-zinc-500">{tabHints[activeTab]}</p>
  </div>

  <!-- Links, not buttons: each slice is a different server query, so the tab
       belongs in the URL. -->
  <div class="flex items-end justify-between border-b border-zinc-200 dark:border-zinc-800">
    <!-- #858 — `min-w-0` as well as `overflow-x-auto`, and the min-w-0 is the
         load-bearing half here. This nav is a flex ITEM of the
         `justify-between` row above, and a flex item's default
         `min-width: auto` refuses to shrink below its content — so
         `overflow-x-auto` alone would never engage and the row would push the
         count off-screen instead. Same defect #746 hit on the App page's
         AI-config select. -->
    <nav
      class="flex min-w-0 gap-0 overflow-x-auto"
      aria-label={t('assets-page.tabs.aria-label', 'File scope')}
    >
      {#each ASSET_TABS as tab (tab)}
        <a
          href={href(tab)}
          aria-current={activeTab === tab ? 'page' : undefined}
          class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium transition
            {activeTab === tab
              ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
              : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-200'}"
        >{tabLabels[tab]}</a>
      {/each}
    </nav>
    {#if !data.failed && !data.noOrg && rows.length > 0}
      <!-- shrink-0: the nav may now shrink, so without this the COUNT becomes
           the thing that gets squeezed instead. -->
      <span class="mb-2 shrink-0 text-xs text-zinc-500">
        {t('assets-page.count', '{total} file(s)', { total: data.total })}
      </span>
    {/if}
  </div>

  {#if data.failed}
    <div role="alert" class="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
      {t(
        'assets-page.failed',
        'Couldn’t load files — the asset query returned an error. This is not the same as having no files; try refreshing.',
      )}
    </div>
  {:else if data.noOrg}
    <!-- No active org. Deliberately NOT a query with orgId omitted: that returns
         everything the caller can reach, which would be mislabelled as this
         organization's. -->
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {t('assets-page.no-org.title', 'No active organization.')}
      </p>
      <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
        {t('assets-page.no-org.explainer', 'Pick an organization in the sidebar to see its files, or switch to')}
        <a href={href('available')} class="text-indigo-600 hover:underline dark:text-indigo-300">{tabLabels.available}</a>.
      </p>
    </div>
  {:else if rows.length === 0}
    <div class="rounded-xl border border-zinc-200 bg-white p-12 text-center dark:border-zinc-800 dark:bg-zinc-900">
      <p class="text-sm font-medium text-zinc-600 dark:text-zinc-300">
        {activeTab === 'mine'
          ? t('assets-page.empty.mine', 'You haven’t uploaded any files yet.')
          : t('assets-page.empty.other', 'No files here yet.')}
      </p>
      <p class="mx-auto mt-2 max-w-lg text-xs text-zinc-500 dark:text-zinc-400">
        {t('assets-page.empty.explainer', 'Files live in a memory — open one and use its')}
        <a href={uploadHint} class="text-indigo-600 hover:underline dark:text-indigo-300">{t('assets-page.empty.files-tab', 'Files tab')}</a>
        {t('assets-page.empty.explainer-tail', 'to upload.')}
      </p>
    </div>
  {:else}
    {#if data.truncated}
      <p class="text-sm text-amber-600 dark:text-amber-400">
        {t(
          'assets-page.truncated',
          'Showing the {shown} most recent of {total} files. Search and sorting apply to these {shown}.',
          { shown: rows.length, total: data.total },
        )}
      </p>
    {/if}

    <!-- Keyed on the tab so AssetTable REMOUNTS per slice. Two reasons, both
         load-bearing: `listKey` and `showMemory` are captured at mount (the
         latter through untrack), and reusing one saved-views key across several
         server-side slices is the trap in
         review:saved-view-arrangement-not-position — a view pinned on "My files"
         would silently re-apply to "Organization files". -->
    {#key activeTab}
      <AssetTable
        assets={rows}
        uploaderNames={data.uploaderNames}
        currentUserId={data.user?.id ?? null}
        showMemory
        listKey={`assets:${activeTab}`}
        ondeleted={refresh}
      />
    {/key}
  {/if}
</div>
