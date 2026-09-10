<script lang="ts">
  // #636 / server #788: the in-place dashboard editor. Rendered by
  // /app/dashboard when the user hits Customize: the same 12-col grid the
  // dashboard shows, with each widget wrapped in edit chrome — drag a card to
  // reorder (the layout reflows live), width/height presets, remove — plus an
  // add-widget tile. Owns a working copy of the placements; Save posts the
  // ordered list as JSON to ?/saveLayout (position = array order, server row
  // ids kept so the server updates rows in place and ids survive the save),
  // Cancel discards. Drag is pointer-only sugar; the up/down buttons are the
  // keyboard- and screen-reader-accessible reorder path.
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { enhance } from '$app/forms';
  import { beforeNavigate } from '$app/navigation';
  import { t } from '$lib/i18n/t';
  import { WIDGET_REGISTRY } from './widgets/registry';
  import { DEFAULT_PLACEMENTS } from './widgets/defaults';
  import { widgetDataFor } from './widgets/types';
  import type { WidgetDataMap, WidgetPlacement, WidgetType } from './widgets/types';

  interface PresetRow {
    id: string;
    type: WidgetType;
    name: string;
    config: Record<string, unknown>;
  }

  let {
    placements,
    widgetData,
    memoryOptions = [],
    presets = [],
    onCreatePreset,
    onDeletePreset,
    error = null,
    onDone,
  }: {
    placements: WidgetPlacement[];
    widgetData: WidgetDataMap;
    /** Slim rows for the usage-activity scope picker. */
    memoryOptions?: Array<{ id: string; name: string }>;
    /** The caller's saved widget configurations (#806), page-owned. */
    presets?: PresetRow[];
    onCreatePreset?: (
      type: WidgetType,
      name: string,
      config: Record<string, unknown>,
    ) => Promise<{ ok: boolean; error?: string; preset?: PresetRow }>;
    onDeletePreset?: (id: string) => Promise<boolean>;
    error?: string | null;
    onDone: () => void;
  } = $props();

  const titleOf = (type: WidgetType): string => {
    const def = WIDGET_REGISTRY[type];
    return def ? t(def.titleKey, def.titleDefault) : type;
  };

  // Width/height presets on the 12-col × fixed-row grid. The server accepts any
  // span 1–12 / rowSpan 1–4; the editor offers the combinations that lay out
  // cleanly.
  const SPAN_OPTIONS = [
    { value: 4, label: t('dashboard.edit.span.third', '⅓ wide') },
    { value: 6, label: t('dashboard.edit.span.half', '½ wide') },
    { value: 8, label: t('dashboard.edit.span.two-thirds', '⅔ wide') },
    { value: 12, label: t('dashboard.edit.span.full', 'Full width') },
  ];
  const ROW_SPAN_OPTIONS = [
    { value: 1, label: t('dashboard.edit.row-span.one', '1× tall') },
    { value: 2, label: t('dashboard.edit.row-span.two', '2× tall') },
    { value: 3, label: t('dashboard.edit.row-span.three', '3× tall') },
  ];

  // Working copy. Each entry carries a client `uid` — the server row id when
  // the placement is saved, a local one otherwise — so the drag/FLIP keys stay
  // stable for unsaved placements too. Unregistered types are dropped up front
  // (the loader already skips them; `animate:` needs the slot to be the each
  // block's only child, so there's no room for a per-item guard).
  type EditorItem = WidgetPlacement & { uid: string };
  let newSeq = 0;
  const withUid = (p: WidgetPlacement): EditorItem => ({ uid: p.id ?? `new-${newSeq++}`, ...p });
  // Seeded from the loaded placements once; the editor then owns this state
  // (same capture-initial-value pattern as the old picker), so untrack the seed.
  let items = $state(
    untrack(() => placements.filter((p) => WIDGET_REGISTRY[p.type]).map(withUid)),
  );

  // What gets posted: the placements in display order, uid stripped. Also the
  // dirty check — the working copy vs. what the editor opened with.
  const serialize = (list: WidgetPlacement[]) =>
    JSON.stringify(
      list.map((p) => ({
        id: p.id,
        type: p.type,
        span: p.span,
        rowSpan: p.rowSpan,
        config: p.config ?? null,
      })),
    );
  // Compare against the seeded working copy (not raw `placements`) so a stored
  // unknown type — filtered out above — doesn't make the editor born-dirty.
  const initialJson = untrack(() => serialize(items));
  const payload = $derived(serialize(items));
  const dirty = $derived(payload !== initialJson);

  // Stat tiles are one-per-type (duplicates would show identical content), but
  // CONFIGURABLE widgets stay offered even when placed — per-instance config +
  // per-instance data (#788/#797) are exactly what makes a second, differently
  // scoped copy useful.
  const available = $derived(
    Object.values(WIDGET_REGISTRY).filter(
      (def) => def.hasSettings || !items.some((i) => i.type === def.type),
    ),
  );

  function addWidget(type: WidgetType) {
    const def = WIDGET_REGISTRY[type];
    items = [
      ...items,
      withUid({
        id: null,
        type,
        span: def?.defaultSpan ?? 4,
        rowSpan: def?.defaultRowSpan ?? 1,
        // A configurable widget gets its defaults stamped at add time — most
        // importantly the browser time zone, so the server buckets days on the
        // user's calendar even when they never open the settings row
        // (Codex P1 on #666).
        config: def?.hasSettings
          ? { windowDays: 7, timeZone: browserTimeZone() }
          : undefined,
      }),
    ];
  }
  function removeAt(i: number) {
    items = items.filter((_, idx) => idx !== i);
  }
  function move(i: number, delta: -1 | 1) {
    const j = i + delta;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    items = next;
  }
  function setSpan(i: number, span: number) {
    items = items.map((it, idx) => (idx === i ? { ...it, span } : it));
  }
  function setRowSpan(i: number, rowSpan: number) {
    items = items.map((it, idx) => (idx === i ? { ...it, rowSpan } : it));
  }
  function resetToDefaults() {
    items = DEFAULT_PLACEMENTS.map(withUid);
  }

  const browserTimeZone = (): string => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return 'UTC';
    }
  };

  // ── Per-widget settings (usage-activity, the first configurable type) ─────
  // The uid whose settings row is expanded, plus that panel's transient UI
  // state (scope-mode choice, save-as-preset draft) — reset on toggle.
  let openSettings = $state<string | null>(null);
  let scopeMode = $state<'me' | 'memories'>('me');
  let presetSaveOpen = $state(false);
  let presetNameDraft = $state('');
  let presetError = $state<string | null>(null);
  const WINDOW_OPTIONS = [7, 14, 30, 90];
  /** Server-side cap on memoryRefs (#805) — mirror it in the picker. */
  const MAX_SCOPE_REFS = 20;

  function toggleSettings(item: EditorItem) {
    openSettings = openSettings === item.uid ? null : item.uid;
    presetSaveOpen = false;
    presetNameDraft = '';
    presetError = null;
    scopeMode = usageSettings(item).memoryRefs.length > 0 ? 'memories' : 'me';
  }

  /** The #805 memory-scope list of a config, normalizing a legacy single
   *  `memoryRef` (pre-#805) to a one-element list like the server does. The
   *  ONE normalization every consumer shares — settings display, scope-mode
   *  derivation, and patching (Codex on #671). */
  function readRefs(c: Record<string, unknown>): string[] {
    let refs: string[] = [];
    if (Array.isArray(c.memoryRefs)) {
      refs = c.memoryRefs.filter((r): r is string => typeof r === 'string' && r.length > 0);
    } else if (typeof c.memoryRef === 'string' && c.memoryRef) {
      refs = [c.memoryRef];
    }
    return refs.slice(0, MAX_SCOPE_REFS);
  }
  /** The usage-activity settings currently stored on a placement's config. */
  function usageSettings(item: EditorItem): {
    windowDays: number;
    memoryRefs: string[];
    chartStyle: 'auto' | 'bars' | 'lines';
    presetId: string | null;
  } {
    const c = (item.config ?? {}) as Record<string, unknown>;
    const raw = c.windowDays;
    return {
      windowDays: typeof raw === 'number' && WINDOW_OPTIONS.includes(raw) ? raw : 7,
      memoryRefs: readRefs(c),
      chartStyle: c.chartStyle === 'bars' || c.chartStyle === 'lines' ? c.chartStyle : 'auto',
      presetId: typeof c.presetId === 'string' ? c.presetId : null,
    };
  }
  /** Patch the placement's config from the settings controls, PRESERVING every
   *  key the editor doesn't own (a preset may carry fields like `bucket` these
   *  controls never touch — Copilot on #671). The browser's time zone rides
   *  along so the server buckets days on the user's calendar. An empty
   *  selection OMITS `memoryRefs` — the server treats an empty list as an
   *  empty scope, not "my activity" (#805); the legacy `memoryRef` key is
   *  retired on write. Any manual edit detaches the preset provenance
   *  (copy-on-apply: presets are seeds, not live links). */
  function patchUsageSettings(
    i: number,
    patch: Partial<{ windowDays: number; memoryRefs: string[]; chartStyle: 'auto' | 'bars' | 'lines' }>,
  ) {
    items = items.map((it, idx) => {
      if (idx !== i) return it;
      const current = (it.config ?? {}) as Record<string, unknown>;
      const next = { ...usageSettings(it), ...patch };
      const {
        presetId: _detach,
        memoryRef: _legacy,
        memoryRefs: _refs,
        chartStyle: _style,
        ...kept
      } = current;
      const config: Record<string, unknown> = {
        ...kept,
        windowDays: next.windowDays,
        timeZone: browserTimeZone(),
      };
      if (next.memoryRefs.length > 0) config.memoryRefs = next.memoryRefs.slice(0, MAX_SCOPE_REFS);
      // 'auto' is the default — keep configs lean by omitting it.
      if (next.chartStyle !== 'auto') config.chartStyle = next.chartStyle;
      return { ...it, config };
    });
  }
  function toggleScopeRef(i: number, item: EditorItem, id: string) {
    const refs = usageSettings(item).memoryRefs;
    patchUsageSettings(i, {
      memoryRefs: refs.includes(id) ? refs.filter((r) => r !== id) : [...refs, id],
    });
  }
  /** Stored refs not present in the fetched options (lost access, >1000, or the
   *  list failed to load) — shown so they stay visible and de-selectable. */
  function unknownRefs(item: EditorItem): string[] {
    return usageSettings(item).memoryRefs.filter((r) => !memoryOptions.some((m) => m.id === r));
  }

  // ── Presets (#806): copy-on-apply — applying copies the preset's config into
  // the placement (with `presetId` as provenance so the dropdown shows the
  // source); any later edit detaches. Deleting never touches placements.
  function presetsFor(type: WidgetType): PresetRow[] {
    return presets.filter((p) => p.type === type);
  }
  function applyPreset(i: number, item: EditorItem, presetId: string) {
    if (!presetId) {
      // "Custom" is an explicit DETACH: the settings stay, only the provenance
      // goes — otherwise the dropdown snaps back and there is no way to leave
      // a preset without editing some other setting (Copilot on #671).
      items = items.map((it, idx) => {
        if (idx !== i) return it;
        const { presetId: _drop, ...rest } = (it.config ?? {}) as Record<string, unknown>;
        return { ...it, config: rest };
      });
      return;
    }
    const preset = presetsFor(item.type).find((p) => p.id === presetId);
    if (!preset) return;
    items = items.map((it, idx) =>
      idx === i ? { ...it, config: { ...preset.config, presetId: preset.id } } : it,
    );
    // Same legacy normalization as everywhere else — a preset saved from a
    // pre-#805 config carries `memoryRef`, which is still a memory scope
    // (Codex on #671).
    scopeMode = readRefs(preset.config).length > 0 ? 'memories' : 'me';
  }
  async function savePreset(item: EditorItem) {
    const name = presetNameDraft.trim();
    if (!name || !onCreatePreset) return;
    // The preset stores the settings, never the provenance marker.
    const { presetId: _drop, ...config } = (item.config ?? {}) as Record<string, unknown>;
    const result = await onCreatePreset(item.type, name, config);
    if (!result.ok || !result.preset) {
      presetError = result.error ?? null;
      return;
    }
    // Stamp provenance so the dropdown now shows the new preset as selected.
    const savedId = result.preset.id;
    items = items.map((it) =>
      it.uid === item.uid ? { ...it, config: { ...config, presetId: savedId } } : it,
    );
    presetSaveOpen = false;
    presetNameDraft = '';
    presetError = null;
  }
  async function removePreset(item: EditorItem, presetId: string) {
    if (!onDeletePreset || !(await onDeletePreset(presetId))) return;
    // Configs seeded from it keep their settings; only the provenance goes.
    items = items.map((it) => {
      const c = (it.config ?? {}) as Record<string, unknown>;
      if (c.presetId !== presetId) return it;
      const { presetId: _drop, ...rest } = c;
      return { ...it, config: rest };
    });
  }
  function cancel() {
    if (dirty && !confirm(t('dashboard.edit.discard-confirm', 'Discard your unsaved dashboard changes?'))) {
      return;
    }
    onDone();
  }

  // Drag to reorder: the card under the pointer swaps with the dragged one as
  // you go (live reflow, animated by FLIP), so the drop needs no separate
  // indicator — the layout already shows the result.
  let dragUid = $state<string | null>(null);
  function onDragStart(e: DragEvent, uid: string) {
    dragUid = uid;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', uid);
      // Drag the whole card, not just the handle the listener sits on.
      const slot = (e.currentTarget as HTMLElement).closest('[data-slot]');
      if (slot instanceof HTMLElement) {
        const r = slot.getBoundingClientRect();
        e.dataTransfer.setDragImage(slot, e.clientX - r.left, e.clientY - r.top);
      }
    }
  }
  function onDragOver(e: DragEvent, overUid: string) {
    if (!dragUid) return;
    e.preventDefault(); // mark the slot as a valid drop target
    if (dragUid === overUid) return;
    const from = items.findIndex((it) => it.uid === dragUid);
    const to = items.findIndex((it) => it.uid === overUid);
    if (from < 0 || to < 0 || from === to) return;
    const next = [...items];
    next.splice(to, 0, ...next.splice(from, 1));
    items = next;
  }

  // Editing in place means normal navigation would silently drop the working
  // copy — confirm first. Saving exits via onDone (no navigation), so this
  // only guards genuine leave-the-page moves. Document-leave navigations
  // (reload, tab close, external link) get cancel() alone: that raises the
  // browser's native unload prompt, and a confirm() on top would double-prompt
  // (Codex on #660).
  beforeNavigate((nav) => {
    if (!dirty) return;
    if (nav.type === 'leave') {
      nav.cancel();
      return;
    }
    if (!confirm(t('dashboard.edit.discard-confirm', 'Discard your unsaved dashboard changes?'))) {
      nav.cancel();
    }
  });
</script>

{#if error}
  <div role="alert" class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
    {error}
  </div>
{/if}

<div
  class="editor-grid grid grid-cols-12 gap-4"
  role="list"
  aria-label={t('dashboard.edit.grid-label', 'Dashboard widgets (editing)')}
  ondragover={(e) => { if (dragUid) e.preventDefault(); }}
  ondrop={(e) => e.preventDefault()}
>
  {#each items as item, i (item.uid)}
    {@const Widget = WIDGET_REGISTRY[item.type].component}
    <div
      data-slot
      role="listitem"
      animate:flip={{ duration: 200 }}
        class="slot flex flex-col overflow-hidden rounded-xl border bg-white dark:bg-zinc-900 {dragUid === item.uid
          ? 'border-indigo-400 opacity-60 dark:border-indigo-600'
          : 'border-zinc-200 dark:border-zinc-800'}"
        style="--span: {item.span}; --row-span: {item.rowSpan}"
        ondragover={(e) => onDragOver(e, item.uid)}
        ondrop={(e) => e.preventDefault()}
      >
        <div class="flex flex-wrap items-center gap-1 border-b border-zinc-100 bg-zinc-50 px-2 py-1.5 dark:border-zinc-800 dark:bg-zinc-950/50">
          <span
            class="cursor-grab select-none rounded px-1 text-zinc-400 hover:text-zinc-600 active:cursor-grabbing dark:hover:text-zinc-300"
            draggable="true"
            title={t('dashboard.edit.drag', 'Drag to reorder')}
            aria-hidden="true"
            ondragstart={(e) => onDragStart(e, item.uid)}
            ondragend={() => (dragUid = null)}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="8" cy="5" r="1.7"/><circle cx="16" cy="5" r="1.7"/><circle cx="8" cy="12" r="1.7"/><circle cx="16" cy="12" r="1.7"/><circle cx="8" cy="19" r="1.7"/><circle cx="16" cy="19" r="1.7"/></svg>
          </span>

          <label class="sr-only" for="span-{item.uid}">
            {t('dashboard.edit.width-label', 'Width of {name}', { name: titleOf(item.type) })}
          </label>
          <select
            id="span-{item.uid}"
            value={item.span}
            onchange={(e) => setSpan(i, Number((e.currentTarget as HTMLSelectElement).value))}
            class="rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {#each SPAN_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
            {#if !SPAN_OPTIONS.some((o) => o.value === item.span)}
              <option value={item.span}>{item.span}/12</option>
            {/if}
          </select>

          <label class="sr-only" for="row-span-{item.uid}">
            {t('dashboard.edit.height-label', 'Height of {name}', { name: titleOf(item.type) })}
          </label>
          <select
            id="row-span-{item.uid}"
            value={item.rowSpan}
            onchange={(e) => setRowSpan(i, Number((e.currentTarget as HTMLSelectElement).value))}
            class="rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {#each ROW_SPAN_OPTIONS as opt (opt.value)}
              <option value={opt.value}>{opt.label}</option>
            {/each}
            {#if !ROW_SPAN_OPTIONS.some((o) => o.value === item.rowSpan)}
              <option value={item.rowSpan}>{item.rowSpan}×</option>
            {/if}
          </select>

          <span class="flex-1"></span>

          {#if WIDGET_REGISTRY[item.type].hasSettings}
            <button
              type="button"
              onclick={() => toggleSettings(item)}
              title={t('dashboard.edit.settings', 'Widget settings')}
              aria-label={t('dashboard.edit.settings-aria', 'Settings for {name}', { name: titleOf(item.type) })}
              aria-expanded={openSettings === item.uid}
              class="rounded-md p-1 {openSettings === item.uid
                ? 'bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200'
                : 'text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200'}"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 21v-7m0-4V3m8 18v-9m0-4V3m8 18v-5m0-4V3M1 14h6m2-6h6m2 8h6"/></svg>
            </button>
          {/if}

          <button
            type="button" onclick={() => move(i, -1)} disabled={i === 0}
            title={t('dashboard.edit.move-earlier', 'Move earlier')}
            aria-label={t('dashboard.edit.move-earlier-aria', 'Move {name} earlier', { name: titleOf(item.type) })}
            class="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5m7-7l-7 7 7 7"/></svg>
          </button>
          <button
            type="button" onclick={() => move(i, 1)} disabled={i === items.length - 1}
            title={t('dashboard.edit.move-later', 'Move later')}
            aria-label={t('dashboard.edit.move-later-aria', 'Move {name} later', { name: titleOf(item.type) })}
            class="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-7-7l7 7-7 7"/></svg>
          </button>
          <button
            type="button" onclick={() => removeAt(i)}
            title={t('dashboard.edit.remove', 'Remove')}
            aria-label={t('dashboard.edit.remove-aria', 'Remove {name}', { name: titleOf(item.type) })}
            class="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {#if WIDGET_REGISTRY[item.type].hasSettings && openSettings === item.uid}
          {@const s = usageSettings(item)}
          {@const typePresets = presetsFor(item.type)}
          <div class="flex flex-col gap-1.5 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-300">
            <!-- Row 1: preset palette (#806, copy-on-apply). -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <label class="flex items-center gap-1.5" for="preset-{item.uid}">
                {t('dashboard.edit.settings-preset', 'Preset')}
                <select
                  id="preset-{item.uid}"
                  value={s.presetId && typePresets.some((p) => p.id === s.presetId) ? s.presetId : ''}
                  onchange={(e) => applyPreset(i, item, (e.currentTarget as HTMLSelectElement).value)}
                  class="max-w-44 rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">{t('dashboard.edit.settings-preset-custom', 'Custom')}</option>
                  {#each typePresets as p (p.id)}
                    <option value={p.id}>{p.name}</option>
                  {/each}
                </select>
              </label>
              {#if s.presetId && typePresets.some((p) => p.id === s.presetId)}
                <button
                  type="button"
                  onclick={() => removePreset(item, s.presetId!)}
                  title={t('dashboard.edit.settings-preset-delete', 'Delete preset')}
                  aria-label={t('dashboard.edit.settings-preset-delete-aria', 'Delete preset {name}', { name: typePresets.find((p) => p.id === s.presetId)?.name ?? '' })}
                  class="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
                </button>
              {/if}
              {#if onCreatePreset}
                {#if presetSaveOpen}
                  <label class="sr-only" for="preset-name-{item.uid}">
                    {t('dashboard.edit.settings-preset-name', 'Preset name')}
                  </label>
                  <input
                    id="preset-name-{item.uid}"
                    type="text"
                    maxlength="60"
                    bind:value={presetNameDraft}
                    placeholder={t('dashboard.edit.settings-preset-name-ph', 'Preset name…')}
                    onkeydown={(e) => e.key === 'Enter' && (e.preventDefault(), savePreset(item))}
                    class="w-36 rounded-md border border-zinc-300 bg-white px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <button
                    type="button"
                    onclick={() => savePreset(item)}
                    disabled={presetNameDraft.trim().length === 0}
                    class="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
                  >
                    {t('dashboard.edit.settings-preset-save', 'Save')}
                  </button>
                {:else}
                  <button
                    type="button"
                    onclick={() => { presetSaveOpen = true; presetError = null; }}
                    class="rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-zinc-600 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:border-indigo-700"
                  >
                    {t('dashboard.edit.settings-preset-save-as', 'Save as preset…')}
                  </button>
                {/if}
              {/if}
              {#if presetError}
                <span role="alert" class="text-red-600 dark:text-red-400">{presetError}</span>
              {/if}
            </div>

            <!-- Row 2: window + scope mode. -->
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <label class="flex items-center gap-1.5" for="win-{item.uid}">
                {t('dashboard.edit.settings-window', 'Window')}
                <select
                  id="win-{item.uid}"
                  value={s.windowDays}
                  onchange={(e) => patchUsageSettings(i, { windowDays: Number((e.currentTarget as HTMLSelectElement).value) })}
                  class="rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {#each WINDOW_OPTIONS as d (d)}
                    <option value={d}>{t('dashboard.edit.settings-window-days', '{n} days', { n: d })}</option>
                  {/each}
                </select>
              </label>
              <label class="flex items-center gap-1.5" for="style-{item.uid}">
                {t('dashboard.edit.settings-style', 'Style')}
                <select
                  id="style-{item.uid}"
                  value={s.chartStyle}
                  onchange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value;
                    patchUsageSettings(i, { chartStyle: v === 'bars' || v === 'lines' ? v : 'auto' });
                  }}
                  class="rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="auto">{t('dashboard.edit.settings-style-auto', 'Auto')}</option>
                  <option value="bars">{t('dashboard.edit.settings-style-bars', 'Bars')}</option>
                  <option value="lines">{t('dashboard.edit.settings-style-lines', 'Lines')}</option>
                </select>
              </label>
              <label class="flex items-center gap-1.5" for="scope-{item.uid}">
                {t('dashboard.edit.settings-scope', 'Scope')}
                <select
                  id="scope-{item.uid}"
                  value={scopeMode}
                  onchange={(e) => {
                    scopeMode = (e.currentTarget as HTMLSelectElement).value as 'me' | 'memories';
                    if (scopeMode === 'me') patchUsageSettings(i, { memoryRefs: [] });
                  }}
                  class="rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="me">{t('dashboard.edit.settings-scope-me', 'My activity')}</option>
                  <option value="memories">{t('dashboard.edit.settings-scope-memories', 'Selected memories')}</option>
                </select>
              </label>
              <span class="text-zinc-400 dark:text-zinc-500">
                {t('dashboard.edit.settings-applies', 'Applies after save')}
              </span>
            </div>

            <!-- Row 3: multi-memory picker (#805 — union scope, max 20). -->
            {#if scopeMode === 'memories'}
              <fieldset class="max-h-28 overflow-y-auto rounded-md border border-zinc-200 bg-white p-1.5 dark:border-zinc-700 dark:bg-zinc-900">
                <legend class="sr-only">{t('dashboard.edit.settings-scope-legend', 'Memories to include')}</legend>
                {#if memoryOptions.length === 0 && unknownRefs(item).length === 0}
                  <p class="px-1 text-zinc-400 dark:text-zinc-500">
                    {t('dashboard.edit.settings-scope-empty', 'No memories available.')}
                  </p>
                {/if}
                <div class="grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                  {#each unknownRefs(item) as ref (ref)}
                    <label class="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <input
                        type="checkbox"
                        checked
                        onchange={() => toggleScopeRef(i, item, ref)}
                        class="rounded border-zinc-300 dark:border-zinc-600"
                      />
                      <span class="truncate italic">{t('dashboard.edit.settings-scope-current', '(current memory)')}</span>
                    </label>
                  {/each}
                  {#each memoryOptions as m (m.id)}
                    {@const checked = s.memoryRefs.includes(m.id)}
                    <label class="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-800">
                      <input
                        type="checkbox"
                        {checked}
                        disabled={!checked && s.memoryRefs.length >= MAX_SCOPE_REFS}
                        onchange={() => toggleScopeRef(i, item, m.id)}
                        class="rounded border-zinc-300 dark:border-zinc-600"
                      />
                      <span class="truncate">{m.name}</span>
                    </label>
                  {/each}
                </div>
              </fieldset>
              {#if s.memoryRefs.length === 0}
                <p class="text-zinc-400 dark:text-zinc-500">
                  {t('dashboard.edit.settings-scope-none', 'Nothing selected yet — the chart will show your own activity until a memory is picked.')}
                </p>
              {/if}
            {/if}
          </div>
        {/if}

        <!-- Live preview of the real widget; `inert` so its links/buttons can't
             be activated (or reached by AT) while editing. -->
        <div inert class="min-h-0 flex-1">
          <Widget {...(widgetDataFor(widgetData, item) ?? {})} widgetConfig={item.config ?? null} />
        </div>
    </div>
  {/each}

  {#if available.length > 0}
    <div class="slot" style="--span: 4; --row-span: 1" role="listitem">
      <div class="flex h-full min-h-28 flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-zinc-300 p-4 dark:border-zinc-700">
        <span class="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          {t('dashboard.edit.add-heading', 'Add a widget')}
        </span>
        <div class="flex flex-wrap justify-center gap-1.5">
          {#each available as def (def.type)}
            <button
              type="button" onclick={() => addWidget(def.type)}
              class="rounded-lg border border-zinc-300 bg-white px-2.5 py-1 text-xs text-zinc-700 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-indigo-700"
            >
              + {titleOf(def.type)}
            </button>
          {/each}
        </div>
      </div>
    </div>
  {/if}
</div>

<form
  method="POST"
  action="?/saveLayout"
  use:enhance={() =>
    async ({ result, update }) => {
      await update();
      if (result.type === 'success') onDone();
    }}
  class="flex items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800"
>
  <input type="hidden" name="widgets" value={payload} />
  <button
    type="button" onclick={resetToDefaults}
    class="mr-auto rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
  >
    {t('dashboard.edit.reset', 'Reset to defaults')}
  </button>
  <button
    type="button" onclick={cancel}
    class="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
  >
    {t('dashboard.edit.cancel', 'Cancel')}
  </button>
  <button
    type="submit"
    class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500"
  >
    {t('dashboard.edit.save', 'Save layout')}
  </button>
</form>

<style>
  /* Same responsive span rules as DashboardGrid (scoped styles don't share):
     full-width stack below `lg`; the declared column/row spans at `lg`, on
     fixed-minimum rows so rowSpan means something. CSS Grid does NOT clamp
     `span N` to the track count — never apply the span below `lg`. */
  .slot {
    grid-column: 1 / -1;
  }
  @media (min-width: 1024px) {
    .editor-grid {
      grid-auto-rows: minmax(8rem, auto);
    }
    .slot {
      grid-column: span var(--span, 12) / span var(--span, 12);
      grid-row: span var(--row-span, 1) / span var(--row-span, 1);
    }
  }
</style>
