<script lang="ts">
  // #636: the dashboard layout framework. Lays widgets out on a responsive
  // column-span grid: 12 columns on desktop, 2 on tablet, 1 on mobile. A widget
  // declares how many columns to span; CSS clamps the span to the available
  // columns, so a span-4 widget goes full-width on mobile automatically.
  import { WIDGET_REGISTRY } from './widgets/registry';
  import type { WidgetDataMap, WidgetPlacement } from './widgets/types';

  // `widgetData` is the per-type combined data (from the server's
  // dashboardWidgetData). `loadFailed` is shared across widgets so each can show
  // its own error state when the dashboard fetch failed.
  let {
    placements,
    widgetData,
    loadFailed = false,
  }: { placements: WidgetPlacement[]; widgetData: WidgetDataMap; loadFailed?: boolean } = $props();

  // Only render placements whose type is registered (defensive against stale
  // server-provided selections once persistence lands).
  const resolved = $derived(
    placements.flatMap((p) => {
      const def = WIDGET_REGISTRY[p.type];
      return def ? [{ placement: p, def }] : [];
    }),
  );
</script>

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-12">
  {#each resolved as { placement, def } (placement.type)}
    {@const Widget = def.component}
    <div style="grid-column: span {placement.span} / span {placement.span}">
      <Widget {...(widgetData[placement.type] ?? {})} {loadFailed} />
    </div>
  {/each}
</div>
