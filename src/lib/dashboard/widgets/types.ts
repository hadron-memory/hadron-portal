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
export type WidgetType = 'memory-stats' | 'agent-stats';

/** hadron-server `DashboardWidgetType` enum ⇄ portal `WidgetType`. */
export const WIDGET_TYPE_FROM_SERVER: Record<string, WidgetType> = {
  MEMORY_STATS: 'memory-stats',
  AGENT_STATS: 'agent-stats',
};
export const WIDGET_TYPE_TO_SERVER: Record<WidgetType, string> = {
  'memory-stats': 'MEMORY_STATS',
  'agent-stats': 'AGENT_STATS',
};

/**
 * The data handed to a widget: its own slice of the combined
 * `dashboardWidgetData` payload (e.g. memory-stats => { memoryCount }). Values
 * come from the server as JSON, so each widget reads its own known keys.
 */
export type WidgetDataMap = Partial<Record<WidgetType, Record<string, unknown>>>;

/** How a widget is registered: its component plus grid + chrome defaults. */
export interface WidgetDefinition {
  type: WidgetType;
  component: Component<Record<string, unknown>>;
  /** Default number of grid columns to span (1–12) when placed. */
  defaultSpan: number;
  /** i18n key + fallback for the widget's card title. */
  titleKey: string;
  titleDefault: string;
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
