/**
 * #636 / #788: the in-place dashboard editor — SSR smoke tests (this repo has
 * no DOM test env; see hrn:node:hadronmemory.com:hadron-portal:conventions:svelte-component-test-gap). Interaction
 * (drag, reorder, save round-trip) is verified in-browser; here we assert the
 * server-rendered chrome: per-widget controls with accessible names, the
 * add-widget tile offering only not-yet-placed types, span/rowSpan carried as
 * CSS vars, and the hidden form payload (uid-stripped placements in order).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';

// The editor imports SvelteKit virtuals; vitest runs without the SvelteKit
// plugin, so mock them (hrn:node:hadronmemory.com:hadron-portal:conventions:vitest-mocks-sveltekit-virtuals).
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy: () => {} }) }));
vi.mock('$app/navigation', () => ({ beforeNavigate: () => {} }));

import DashboardEditor from './DashboardEditor.svelte';
import type { WidgetPlacement } from './widgets/types';

const widgetData = {
  'memory-stats': { memoryCount: 2 },
  'agent-stats': { agentCount: 5 },
};

function renderEditor(placements: WidgetPlacement[]) {
  return render(DashboardEditor, {
    props: { placements, widgetData, onDone: () => {} },
  }).body;
}

describe('DashboardEditor.svelte (#636 / #788)', () => {
  it('renders each placement with edit chrome: accessible reorder/remove controls and span vars', () => {
    const body = renderEditor([
      { id: 'row-a', type: 'memory-stats', span: 4, rowSpan: 2 },
      { id: 'row-b', type: 'agent-stats', span: 6, rowSpan: 1 },
    ]);
    // Live widget preview renders inside the chrome (inert while editing).
    expect(body).toContain('Memory Stats');
    expect(body).toContain('inert');
    // Spans ride the CSS custom properties (breakpoint-scoped <style> applies them).
    expect(body).toContain('--span: 4; --row-span: 2');
    expect(body).toContain('--span: 6; --row-span: 1');
    // Accessible names on the per-widget controls.
    expect(body).toContain('Move Memory Stats earlier');
    expect(body).toContain('Move Agent Stats later');
    expect(body).toContain('Remove Memory Stats');
    expect(body).toContain('Width of Memory Stats');
    expect(body).toContain('Height of Memory Stats');
  });

  it('offers not-yet-placed types, and configurable types even when placed', () => {
    const body = renderEditor([{ id: 'row-a', type: 'memory-stats', span: 4, rowSpan: 1 }]);
    expect(body).toContain('Add a widget');
    expect(body).toContain('+ Agent Stats');
    // Stat tiles are one-per-type…
    expect(body).not.toContain('+ Memory Stats');
    // …but configurable widgets can be placed again with another config.
    expect(body).toContain('+ Usage Activity');
  });

  it('keeps offering a placed configurable widget (duplicates carry their own config)', () => {
    const body = renderEditor([
      { id: 'a', type: 'memory-stats', span: 4, rowSpan: 1 },
      { id: 'b', type: 'agent-stats', span: 4, rowSpan: 1 },
      { id: 'c', type: 'usage-activity', span: 6, rowSpan: 2 },
    ]);
    expect(body).toContain('Add a widget');
    expect(body).toContain('+ Usage Activity');
    expect(body).not.toContain('+ Memory Stats');
    expect(body).not.toContain('+ Agent Stats');
  });

  it('posts the uid-stripped placements as the hidden widgets payload, in order', () => {
    const body = renderEditor([
      { id: 'row-a', type: 'agent-stats', span: 6, rowSpan: 2, config: { theme: 'x' } },
      { id: null, type: 'memory-stats', span: 12, rowSpan: 1 },
    ]);
    const value = body.match(/name="widgets" value="([^"]*)"/)?.[1];
    expect(value).toBeDefined();
    // The payload is HTML-escaped in the attribute; unescape before parsing.
    const parsed = JSON.parse(value!.replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
    expect(parsed).toEqual([
      { id: 'row-a', type: 'agent-stats', span: 6, rowSpan: 2, config: { theme: 'x' } },
      { id: null, type: 'memory-stats', span: 12, rowSpan: 1, config: null },
    ]);
  });

  it('offers a settings toggle only for configurable widgets, with the scope picker options', () => {
    const body = render(DashboardEditor, {
      props: {
        placements: [
          { id: 'a', type: 'memory-stats', span: 4, rowSpan: 1 },
          { id: 'b', type: 'usage-activity', span: 6, rowSpan: 2 },
        ] as WidgetPlacement[],
        widgetData,
        memoryOptions: [{ id: 'm1', name: 'Nexus Notes' }],
        onDone: () => {},
      },
    }).body;
    // Exactly one settings toggle (the usage widget's), with an accessible name.
    expect(body).toContain('Settings for Usage Activity');
    expect(body).not.toContain('Settings for Memory Stats');
    // Panel is collapsed until toggled (interaction is browser-verified).
    expect(body).not.toContain('My activity');
  });

  it('skips an unregistered placement type without throwing', () => {
    const body = renderEditor([
      { id: 'a', type: 'memory-stats', span: 4, rowSpan: 1 },
      { id: 'b', type: 'does-not-exist', span: 4, rowSpan: 1 } as unknown as WidgetPlacement,
    ]);
    expect(body).toContain('Memory Stats');
    expect(body.match(/Remove /g)?.length).toBe(1);
  });
});
