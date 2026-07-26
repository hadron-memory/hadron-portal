import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';

import DashboardGrid from './DashboardGrid.svelte';
import type { WidgetPlacement } from './widgets/types';

// #636: the grid resolves each placement through the widget registry, passes
// the widget its own data slice from the widgetData map, and skips unregistered
// types defensively. #788: each slot also carries its rowSpan.

const widgetData = { 'memory-stats': { memoryCount: 2 } };

describe('DashboardGrid.svelte (#636)', () => {
  it('renders a registered widget with its data slice and the declared spans', () => {
    const placements: WidgetPlacement[] = [
      { id: 'w1', type: 'memory-stats', span: 4, rowSpan: 2 },
    ];
    const { body } = render(DashboardGrid, { props: { placements, widgetData } });
    // The Memory Stats widget content shows up (registry lookup + dynamic render).
    expect(body).toContain('Memory Stats');
    expect(body).toContain('>2<');
    // Spans are carried as custom properties; breakpoint-aware <style> rules
    // (not inline grid-column/grid-row) apply them, so assert the vars.
    expect(body).toContain('--span: 4');
    expect(body).toContain('--row-span: 2');
  });

  it('skips an unregistered placement type without throwing', () => {
    const placements = [
      { id: 'w1', type: 'memory-stats', span: 4, rowSpan: 1 },
      { id: 'w2', type: 'does-not-exist', span: 4, rowSpan: 1 },
    ] as unknown as WidgetPlacement[];
    const { body } = render(DashboardGrid, { props: { placements, widgetData } });
    expect(body).toContain('Memory Stats');
    // Only the one registered widget rendered.
    expect(body.match(/Memory Stats/g)?.length).toBe(1);
  });
});
