<script lang="ts">
  // #636: the dashboard widget picker. Manages the active-widget list client-side
  // (add / remove / reorder / resize) and posts the ordered list to
  // setDashboardWidgets on Save. Reorder uses up/down buttons (accessible, no
  // drag-drop dependency).
  import { untrack } from 'svelte';
  import { enhance } from '$app/forms';
  import Breadcrumb from '$lib/components/Breadcrumb.svelte';
  import { t } from '$lib/i18n/t';
  import { WIDGET_REGISTRY } from '$lib/dashboard/widgets/registry';
  import type { WidgetPlacement, WidgetType } from '$lib/dashboard/widgets/types';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  // The full catalog of registered widgets (metadata for the picker).
  const catalog = Object.values(WIDGET_REGISTRY);
  const titleOf = (type: WidgetType): string => {
    const def = WIDGET_REGISTRY[type];
    return def ? t(def.titleKey, def.titleDefault) : type;
  };

  // Column-span presets on the 12-col grid.
  const SPAN_OPTIONS = [
    { value: 4, label: t('dashboard.customize.span.third', 'Small (⅓ width)') },
    { value: 6, label: t('dashboard.customize.span.half', 'Medium (½ width)') },
    { value: 12, label: t('dashboard.customize.span.full', 'Full width') },
  ];

  // Seed the picker from the loaded selection once; the picker then owns this
  // state (add/remove/reorder/resize), so we capture the initial value only.
  let active = $state<WidgetPlacement[]>(untrack(() => data.placements.map((p) => ({ ...p }))));
  const activeTypes = $derived(new Set(active.map((a) => a.type)));
  // Only offer widgets not already placed (data is per-type, so duplicates add nothing).
  const available = $derived(catalog.filter((c) => !activeTypes.has(c.type)));
  const submitError = $derived(form?.error ?? null);

  function addWidget(type: WidgetType) {
    active = [...active, { type, span: WIDGET_REGISTRY[type]?.defaultSpan ?? 4 }];
  }
  function removeAt(i: number) {
    active = active.filter((_, idx) => idx !== i);
  }
  function moveUp(i: number) {
    if (i <= 0) return;
    const next = [...active];
    [next[i - 1], next[i]] = [next[i], next[i - 1]];
    active = next;
  }
  function moveDown(i: number) {
    if (i >= active.length - 1) return;
    const next = [...active];
    [next[i + 1], next[i]] = [next[i], next[i + 1]];
    active = next;
  }
  function setSpan(i: number, span: number) {
    active = active.map((a, idx) => (idx === i ? { ...a, span } : a));
  }
</script>

<svelte:head><title>{t('dashboard.customize.title', 'Customize dashboard — Hadron')}</title></svelte:head>

<div class="mx-auto max-w-2xl space-y-6 py-6">
  <Breadcrumb items={[
    { href: '/app/dashboard', label: t('dashboard.customize.crumb-dashboard', 'Dashboard') },
    { label: t('dashboard.customize.crumb', 'Customize') },
  ]} />

  <div>
    <h1 class="text-2xl font-bold text-zinc-900 dark:text-white">
      {t('dashboard.customize.heading', 'Customize dashboard')}
    </h1>
    <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
      {t('dashboard.customize.subtitle', 'Choose which widgets appear, their order, and their width.')}
    </p>
  </div>

  {#if submitError}
    <div role="alert" class="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200">
      {submitError}
    </div>
  {/if}

  <!-- Active widgets -->
  <section class="space-y-2">
    <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
      {t('dashboard.customize.active-heading', 'Your widgets')}
    </h2>
    {#if active.length === 0}
      <p class="rounded-lg border border-dashed border-zinc-300 p-4 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        {t('dashboard.customize.empty', 'No widgets yet — add one below.')}
      </p>
    {:else}
      <ul class="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {#each active as widget, i (widget.type)}
          <li class="flex items-center gap-3 bg-white px-4 py-3 dark:bg-zinc-900">
            <span class="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-white">{titleOf(widget.type)}</span>

            <label class="sr-only" for="span-{widget.type}">{t('dashboard.customize.width-label', 'Width')}</label>
            <select
              id="span-{widget.type}"
              value={widget.span}
              onchange={(e) => setSpan(i, Number((e.currentTarget as HTMLSelectElement).value))}
              class="rounded-lg border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
            >
              {#each SPAN_OPTIONS as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>

            <div class="flex items-center gap-0.5">
              <button
                type="button" onclick={() => moveUp(i)} disabled={i === 0}
                title={t('dashboard.customize.move-up', 'Move up')}
                aria-label={t('dashboard.customize.move-up', 'Move up')}
                class="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 15l-6-6-6 6"/></svg>
              </button>
              <button
                type="button" onclick={() => moveDown(i)} disabled={i === active.length - 1}
                title={t('dashboard.customize.move-down', 'Move down')}
                aria-label={t('dashboard.customize.move-down', 'Move down')}
                class="rounded-md p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-30 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
              </button>
            </div>

            <button
              type="button" onclick={() => removeAt(i)}
              title={t('dashboard.customize.remove', 'Remove')}
              aria-label={t('dashboard.customize.remove', 'Remove {name}').replace('{name}', titleOf(widget.type))}
              class="rounded-md px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/50"
            >
              {t('dashboard.customize.remove', 'Remove')}
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- Available widgets to add -->
  {#if available.length > 0}
    <section class="space-y-2">
      <h2 class="text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {t('dashboard.customize.available-heading', 'Add a widget')}
      </h2>
      <div class="flex flex-wrap gap-2">
        {#each available as def (def.type)}
          <button
            type="button" onclick={() => addWidget(def.type)}
            class="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-700 hover:border-indigo-300 hover:text-indigo-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-indigo-700"
          >
            + {titleOf(def.type)}
          </button>
        {/each}
      </div>
    </section>
  {/if}

  <!-- Save / Cancel -->
  <form method="POST" use:enhance class="flex items-center justify-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
    <input type="hidden" name="widgets" value={JSON.stringify(active)} />
    <a href="/app/dashboard" class="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800">
      {t('dashboard.customize.cancel', 'Cancel')}
    </a>
    <button type="submit" class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500">
      {t('dashboard.customize.save', 'Save dashboard')}
    </button>
  </form>
</div>
