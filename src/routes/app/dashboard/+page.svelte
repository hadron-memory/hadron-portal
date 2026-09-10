<script lang="ts">
  // #629: the stats page for every user — the widget grid IS the content (the
  // memories preview was dropped; "My memories" in the nav covers it).
  // Org-scoped stats and activity charts are a deliberate follow-up.
  // #636/#788: the cogwheel flips the widget grid into the in-place editor
  // (drag/reorder/resize) right here.
  import DashboardGrid from '$lib/dashboard/DashboardGrid.svelte';
  import DashboardEditor from '$lib/dashboard/DashboardEditor.svelte';
  import { t } from '$lib/i18n/t';
  import type { WidgetPreset } from './editor-options/+server';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  let editing = $state(false);
  const loadFailed = $derived(data.loadFailed === true);

  // #666/#806: the editor's option lists — the scope picker's memories and the
  // caller's saved widget presets — fetched lazily the first time the editor
  // opens, so the plain dashboard view never pays for them. The editor degrades
  // gracefully (a stored ref stays selectable via its "(current)" fallback)
  // when this fails or hasn't landed yet.
  let memoryOptions = $state<Array<{ id: string; name: string }>>([]);
  let presets = $state<WidgetPreset[]>([]);
  let editorOptionsLoaded = false;
  async function openEditor() {
    editing = true;
    if (editorOptionsLoaded) return;
    try {
      const res = await fetch('/app/dashboard/editor-options');
      if (res.ok) {
        const body = (await res.json()) as {
          options?: Array<{ id: string; name: string }>;
          presets?: WidgetPreset[];
          loadFailed?: boolean;
          presetsFailed?: boolean;
        };
        memoryOptions = body.options ?? [];
        // MERGE with the current list rather than replacing it: a preset saved
        // while this GET was in flight would otherwise vanish under the fetch's
        // older snapshot (Codex on #671). Local rows win on id collision.
        const fetched = (body.presets ?? []).filter((p) => !presets.some((q) => q.id === p.id));
        presets = [...presets, ...fetched].sort((a, b) => a.name.localeCompare(b.name));
        // Only cache a fully successful load; a partial failure retries on the
        // next editor open (each list degrades independently server-side).
        editorOptionsLoaded = body.loadFailed !== true && body.presetsFailed !== true;
      }
    } catch {
      // Leave the lists as they are — retried on the next editor open.
    }
  }

  // Preset palette CRUD (#806) — page-owned so the list survives editor
  // remounts; the editor calls these and renders the updated prop.
  async function createPreset(
    type: string,
    name: string,
    config: Record<string, unknown>,
  ): Promise<{ ok: boolean; error?: string; preset?: WidgetPreset }> {
    try {
      const res = await fetch('/app/dashboard/widget-presets', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, name, config }),
      });
      const body = (await res.json()) as { preset?: WidgetPreset; error?: string };
      if (!res.ok || !body.preset) {
        return { ok: false, error: body.error ?? t('dashboard.edit.preset-save-failed', 'Failed to save the preset.') };
      }
      presets = [...presets, body.preset].sort((a, b) => a.name.localeCompare(b.name));
      return { ok: true, preset: body.preset };
    } catch {
      return { ok: false, error: t('dashboard.edit.preset-save-failed', 'Failed to save the preset.') };
    }
  }
  async function deletePreset(id: string): Promise<boolean> {
    try {
      const res = await fetch('/app/dashboard/widget-presets', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ presetRef: id }),
      });
      if (!res.ok) return false;
      presets = presets.filter((p) => p.id !== id);
      return true;
    } catch {
      return false;
    }
  }

  // #636: layout + per-widget data come from the server (dashboardWidgets +
  // dashboardWidgetData), with a default layout when the user hasn't customized.
  const placements = $derived(data.placements ?? []);
  const widgetData = $derived(data.widgetData ?? {});
  // The /app layout merges `user` into page data.
  const displayName = $derived(
    (data as { user?: { name?: string | null; handle?: string | null } }).user?.name ??
      ((data as { user?: { handle?: string | null } }).user?.handle
        ? `@${(data as { user?: { handle?: string | null } }).user!.handle}`
        : null),
  );
</script>

<svelte:head><title>{t('dashboard.title', 'Dashboard — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-3xl space-y-6 py-6">
  <div class="flex items-center justify-between gap-4">
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">
      {#if displayName}
        {t('dashboard.heading-named', 'Welcome back, {name}', { name: displayName })}
      {:else}
        {t('dashboard.heading', 'Dashboard')}
      {/if}
    </h1>
    {#if !editing && !loadFailed}
      <button
        type="button"
        onclick={openEditor}
        title={t('dashboard.customize.link-title', 'Customize dashboard')}
        aria-label={t('dashboard.customize.link-aria', 'Customize dashboard')}
        class="shrink-0 rounded-lg p-2 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    {/if}
  </div>

  {#if loadFailed}
    <div role="alert" class="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200">
      {t('dashboard.load-failed', "Couldn't load your stats just now — this is a temporary error. Try refreshing the page.")}
    </div>
  {:else if editing}
    <!-- In-place editor (#636/#788): same grid, wrapped in edit chrome. Keyed
         so re-entering edit mode always starts from the loaded placements. -->
    <DashboardEditor
      {placements}
      {widgetData}
      {memoryOptions}
      {presets}
      onCreatePreset={createPreset}
      onDeletePreset={deletePreset}
      error={form?.error ?? null}
      onDone={() => (editing = false)}
    />
  {:else}
    <!-- Widget grid (#636). Only rendered when the load succeeded (the alert
         branch above handles failure), so widgets don't need a loadFailed prop. -->
    <DashboardGrid {placements} {widgetData} />
  {/if}
</div>
