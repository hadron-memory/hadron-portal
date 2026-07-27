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

  let {
    placements,
    widgetData,
    memoryOptions = [],
    error = null,
    onDone,
  }: {
    placements: WidgetPlacement[];
    widgetData: WidgetDataMap;
    /** Slim rows for the usage-activity scope picker. */
    memoryOptions?: Array<{ id: string; name: string }>;
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

  // One widget per type: the per-type data payload means duplicates would show
  // identical content, so only offer the not-yet-placed types.
  const available = $derived(
    Object.values(WIDGET_REGISTRY).filter((def) => !items.some((i) => i.type === def.type)),
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
  // The uid whose settings row is expanded.
  let openSettings = $state<string | null>(null);
  const WINDOW_OPTIONS = [7, 14, 30, 90];
  /** The usage-activity settings currently stored on a placement's config. */
  function usageSettings(item: EditorItem): { windowDays: number; memoryRef: string } {
    const c = item.config ?? {};
    const raw = (c as Record<string, unknown>).windowDays;
    return {
      windowDays: typeof raw === 'number' && WINDOW_OPTIONS.includes(raw) ? raw : 7,
      memoryRef:
        typeof (c as Record<string, unknown>).memoryRef === 'string'
          ? ((c as Record<string, unknown>).memoryRef as string)
          : '',
    };
  }
  /** Rebuild the placement's config from the settings controls. The browser's
   *  time zone rides along so the server buckets days on the user's calendar. */
  function patchUsageSettings(i: number, patch: Partial<{ windowDays: number; memoryRef: string }>) {
    items = items.map((it, idx) => {
      if (idx !== i) return it;
      const next = { ...usageSettings(it), ...patch };
      const config: Record<string, unknown> = {
        windowDays: next.windowDays,
        timeZone: browserTimeZone(),
      };
      if (next.memoryRef) config.memoryRef = next.memoryRef;
      return { ...it, config };
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
            {t('dashboard.edit.width-label', 'Width of {name}').replace('{name}', titleOf(item.type))}
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
            {t('dashboard.edit.height-label', 'Height of {name}').replace('{name}', titleOf(item.type))}
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
              onclick={() => (openSettings = openSettings === item.uid ? null : item.uid)}
              title={t('dashboard.edit.settings', 'Widget settings')}
              aria-label={t('dashboard.edit.settings-aria', 'Settings for {name}').replace('{name}', titleOf(item.type))}
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
            aria-label={t('dashboard.edit.move-earlier-aria', 'Move {name} earlier').replace('{name}', titleOf(item.type))}
            class="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5m7-7l-7 7 7 7"/></svg>
          </button>
          <button
            type="button" onclick={() => move(i, 1)} disabled={i === items.length - 1}
            title={t('dashboard.edit.move-later', 'Move later')}
            aria-label={t('dashboard.edit.move-later-aria', 'Move {name} later').replace('{name}', titleOf(item.type))}
            class="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14m-7-7l7 7-7 7"/></svg>
          </button>
          <button
            type="button" onclick={() => removeAt(i)}
            title={t('dashboard.edit.remove', 'Remove')}
            aria-label={t('dashboard.edit.remove-aria', 'Remove {name}').replace('{name}', titleOf(item.type))}
            class="rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        {#if WIDGET_REGISTRY[item.type].hasSettings && openSettings === item.uid}
          {@const s = usageSettings(item)}
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-zinc-100 bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-zinc-950/50 dark:text-zinc-300">
            <label class="flex items-center gap-1.5" for="win-{item.uid}">
              {t('dashboard.edit.settings-window', 'Window')}
              <select
                id="win-{item.uid}"
                value={s.windowDays}
                onchange={(e) => patchUsageSettings(i, { windowDays: Number((e.currentTarget as HTMLSelectElement).value) })}
                class="rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                {#each WINDOW_OPTIONS as d (d)}
                  <option value={d}>{t('dashboard.edit.settings-window-days', '{n} days').replace('{n}', String(d))}</option>
                {/each}
              </select>
            </label>
            <label class="flex items-center gap-1.5" for="scope-{item.uid}">
              {t('dashboard.edit.settings-scope', 'Scope')}
              <select
                id="scope-{item.uid}"
                value={s.memoryRef}
                onchange={(e) => patchUsageSettings(i, { memoryRef: (e.currentTarget as HTMLSelectElement).value })}
                class="max-w-44 rounded-md border border-zinc-300 bg-white px-1 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="">{t('dashboard.edit.settings-scope-me', 'My activity')}</option>
                {#if s.memoryRef && !memoryOptions.some((m) => m.id === s.memoryRef)}
                  <option value={s.memoryRef}>{t('dashboard.edit.settings-scope-current', '(current memory)')}</option>
                {/if}
                {#each memoryOptions as m (m.id)}
                  <option value={m.id}>{m.name}</option>
                {/each}
              </select>
            </label>
            <span class="text-zinc-400 dark:text-zinc-500">
              {t('dashboard.edit.settings-applies', 'Applies after save')}
            </span>
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
