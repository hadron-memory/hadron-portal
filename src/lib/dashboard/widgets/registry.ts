// #636: the widget registry — the single place that maps a WidgetType to its
// component and grid/chrome defaults. Register a new widget by adding its type
// to `WidgetType` (types.ts) and an entry here.
import type { Component } from 'svelte';
import MemoryStatsWidget from './MemoryStatsWidget.svelte';
import AgentStatsWidget from './AgentStatsWidget.svelte';
import UsageActivityWidget from './UsageActivityWidget.svelte';
import type { WidgetDefinition, WidgetType } from './types';

export const WIDGET_REGISTRY: Record<WidgetType, WidgetDefinition> = {
  'memory-stats': {
    type: 'memory-stats',
    // Each widget declares its own typed props; the grid passes that widget's
    // data slice as a prop bag, so the registry holds the permissive shape.
    component: MemoryStatsWidget as unknown as Component<Record<string, unknown>>,
    defaultSpan: 4,
    defaultRowSpan: 1,
    titleKey: 'dashboard.widget.memory-stats.title',
    titleDefault: 'Memory Stats',
  },
  'agent-stats': {
    type: 'agent-stats',
    component: AgentStatsWidget as unknown as Component<Record<string, unknown>>,
    defaultSpan: 4,
    defaultRowSpan: 1,
    titleKey: 'dashboard.widget.agent-stats.title',
    titleDefault: 'Agent Stats',
  },
  'usage-activity': {
    type: 'usage-activity',
    component: UsageActivityWidget as unknown as Component<Record<string, unknown>>,
    // A chart wants room: half-width, two rows.
    defaultSpan: 6,
    defaultRowSpan: 2,
    titleKey: 'dashboard.widget.usage-activity.title',
    titleDefault: 'Usage Activity',
    hasSettings: true,
  },
};
