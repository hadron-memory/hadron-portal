<script lang="ts">
  // #636: the dashboard layout framework. Lays widgets out on a 12-column grid
  // on desktop; each widget declares how many columns to span. On smaller
  // screens every widget is full-width (see the note on clamping below).
  import { WIDGET_REGISTRY } from './widgets/registry';
  import type { WidgetDataMap, WidgetPlacement } from './widgets/types';

  // `widgetData` is the per-type combined data (from the server's
  // dashboardWidgetData); each widget reads its own slice.
  let { placements, widgetData }: { placements: WidgetPlacement[]; widgetData: WidgetDataMap } =
    $props();

  // Only render placements whose type is registered (defensive against stale
  // server-provided selections).
  const resolved = $derived(
    placements.flatMap((p) => {
      const def = WIDGET_REGISTRY[p.type];
      return def ? [{ placement: p, def }] : [];
    }),
  );
</script>

<!-- Always a 12-col grid. The span is applied ONLY at `lg` (see <style>): CSS
     Grid does NOT clamp `grid-column: span N` to the explicit track count — a
     span-4 item in a 1-col grid grows the grid with implicit columns and breaks
     the layout. So below `lg` every slot is full-width (`1 / -1`); at `lg` it
     spans its declared number of the 12 columns. Key by index because multiple
     widgets of the same type may be placed. -->
<div class="grid grid-cols-12 gap-4">
  {#each resolved as { placement, def }, i (i)}
    {@const Widget = def.component}
    <div class="slot" style="--span: {placement.span}">
      <Widget {...(widgetData[placement.type] ?? {})} />
    </div>
  {/each}
</div>

<style>
  /* Mobile + tablet: full width (spans all explicit columns). */
  .slot {
    grid-column: 1 / -1;
  }
  /* Desktop (Tailwind `lg` = 1024px): span the declared number of columns. */
  @media (min-width: 1024px) {
    .slot {
      grid-column: span var(--span, 12) / span var(--span, 12);
    }
  }
</style>
