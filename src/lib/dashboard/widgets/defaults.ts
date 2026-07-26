import type { WidgetPlacement } from './types';

// #636: the default dashboard layout — used when the user hasn't customized
// their dashboard (no persisted selection). Shared by the dashboard loader
// (what to render) and the customize page (what to pre-populate the picker with,
// so "what you see is what you edit").
export const DEFAULT_PLACEMENTS: WidgetPlacement[] = [
  { id: null, type: 'memory-stats', span: 4, rowSpan: 1 },
  { id: null, type: 'agent-stats', span: 4, rowSpan: 1 },
];
