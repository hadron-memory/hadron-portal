import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';

import DashboardGrid from './DashboardGrid.svelte';
import type { WidgetPlacement } from './widgets/types';

// #636: the grid resolves each placement through the widget registry, passes
// the widget its own data slice from the widgetData map, and skips unregistered
// types defensively.

const widgetData = { 'memory-stats': { memoryCount: 2 } };

describe('DashboardGrid.svelte (#636)', () => {
  it('renders a registered widget with its data slice and the correct column span', () => {
    const placements: WidgetPlacement[] = [{ type: 'memory-stats', span: 4 }];
    const { body } = render(DashboardGrid, { props: { placements, widgetData } });
    // The Memory Stats widget content shows up (registry lookup + dynamic render).
    expect(body).toContain('Memory Stats');
    expect(body).toContain('>2<');
    // The placement wrapper carries the inline span.
    expect(body).toContain('grid-column: span 4 / span 4');
  });

  it('skips an unregistered placement type without throwing', () => {
    const placements = [
      { type: 'memory-stats', span: 4 },
      { type: 'does-not-exist', span: 4 },
    ] as unknown as WidgetPlacement[];
    const { body } = render(DashboardGrid, { props: { placements, widgetData } });
    expect(body).toContain('Memory Stats');
    // Only the one registered widget rendered.
    expect(body.match(/Memory Stats/g)?.length).toBe(1);
  });
});
