// #636: dashboard widgets framework. A dashboard is a responsive column-span
// grid; each widget occupies a slot spanning one or more of the grid's columns.
//
// The user's widget SELECTION and each widget's DATA are now served by
// hadron-server (#772 / server PR #773): `dashboardWidgets` returns the placed
// widgets (type + span, ordered by position) and `dashboardWidgetData` returns
// the combined per-widget-type payloads in one request. The portal maps the
// server enum to `WidgetType`, builds `WidgetPlacement`s from the selection, and
// fans `dashboardWidgetData` out to each widget by type via `WidgetDataMap`.
import type { Component } from 'svelte';

/** Registered widget kinds (portal-side ids). Add a member when you add one. */
export type WidgetType = 'memory-stats' | 'agent-stats' | 'usage-activity';

/** hadron-server `DashboardWidgetType` enum ⇄ portal `WidgetType`. */
export const WIDGET_TYPE_FROM_SERVER: Record<string, WidgetType> = {
  MEMORY_STATS: 'memory-stats',
  AGENT_STATS: 'agent-stats',
  USAGE_ACTIVITY: 'usage-activity',
};
export const WIDGET_TYPE_TO_SERVER: Record<WidgetType, string> = {
  'memory-stats': 'MEMORY_STATS',
  'agent-stats': 'AGENT_STATS',
  'usage-activity': 'USAGE_ACTIVITY',
};

/**
 * The data handed to each widget. Since server #797 the combined
 * `dashboardWidgetData` payload is per-PLACEMENT (each entry built from that
 * placement's `config`), so the map is keyed by placement row id — with widget
 * TYPE keys as the fallback for seeded default layouts, whose placements have
 * no id. Values come from the server as JSON; each widget reads its own keys.
 */
export type WidgetDataMap = Record<string, Record<string, unknown>>;

/** The data slice for one placement: its own row's payload, else the type seed. */
export function widgetDataFor(
  map: WidgetDataMap,
  p: Pick<WidgetPlacement, 'id' | 'type'>,
): Record<string, unknown> | undefined {
  return (p.id != null ? map[p.id] : undefined) ?? map[p.type];
}

/** How a widget is registered: its component plus grid + chrome defaults. */
export interface WidgetDefinition {
  type: WidgetType;
  component: Component<Record<string, unknown>>;
  /** Default number of grid columns to span (1–12) when placed. */
  defaultSpan: number;
  /** Default number of grid rows to span (1–4) when placed. */
  defaultRowSpan: number;
  /** i18n key + fallback for the widget's card title. */
  titleKey: string;
  titleDefault: string;
  /** True when the editor offers a per-instance settings panel for this type. */
  hasSettings?: boolean;
}

/** One widget placed on the dashboard grid. */
export interface WidgetPlacement {
  /** Server placement-row id (#788) — stable across saves. Null until first saved. */
  id: string | null;
  type: WidgetType;
  /** Columns to span on the 12-col desktop grid (clamped on smaller screens). */
  span: number;
  /** Rows to span on the fixed-height row grid (1–4, #788). */
  rowSpan: number;
  /** Widget-instance settings (#788); shape is widget-defined. */
  config?: Record<string, unknown> | null;
}

/** Settled widget read: failures never masquerade as zero counts. */
export interface WidgetDataResult {
  data: WidgetDataMap;
  loadFailed: boolean;
}
