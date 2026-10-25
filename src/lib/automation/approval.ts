import { t } from '$lib/i18n/t';

/**
 * portal#1299 — the shapes the Automations list and the approval page render,
 * exactly as hadron-server#2441 sends them. Nothing here derives a state, a
 * summary or a permission; it names what to call what the server sent.
 */

export type ApprovalTriggerKind = 'SCHEDULE' | 'WEBHOOK' | 'MANUAL';
export type AdoptionState = 'UNADOPTED' | 'ADOPTED' | 'CHANGED';

export interface ApprovalRow {
  triggerKind: ApprovalTriggerKind;
  triggerRef: string;
  name: string;
  state: AdoptionState;
  headline: string;
}

export interface ApprovalPage {
  rows: ApprovalRow[];
  nextCursor: string | null;
  omitted: { triggerKind: ApprovalTriggerKind; reason: string }[];
}

export interface FlowSummary { name: string; urn: string; tools: string[]; writes: string[] }
export interface ApprovalSummary {
  name: string;
  schedule: string | null;
  reads: string[];
  writes: string[];
  tools: string[];
  limits: string[];
  cannotDo: string[];
  flows: FlowSummary[];
}
export interface Approval { state: AdoptionState; hash: string; depth: unknown; summary: ApprovalSummary }

/** The route segment for a trigger kind: lower case, one word. */
const ROUTE_KINDS: Record<string, ApprovalTriggerKind> = { schedule: 'SCHEDULE', webhook: 'WEBHOOK', manual: 'MANUAL' };
export function kindFromRoute(segment: string): ApprovalTriggerKind | null {
  return Object.hasOwn(ROUTE_KINDS, segment) ? ROUTE_KINDS[segment] : null;
}
export const routeKind = (kind: ApprovalTriggerKind): string => kind.toLowerCase();

export const approvalHref = (appId: string, kind: ApprovalTriggerKind, ref: string): string =>
  `/app/apps/${encodeURIComponent(appId)}/automations/${routeKind(kind)}/${encodeURIComponent(ref)}`;

/** The list's two states. The page that opens a trigger is the one place that says "changed". */
export function listStateLabel(state: AdoptionState): string {
  return state === 'ADOPTED' ? t('app.automations.state.approved', 'Approved') : t('app.automations.state.waiting', 'Waiting for approval');
}

export function pageStateLabel(state: AdoptionState): string {
  switch (state) {
    case 'ADOPTED': return t('app.automations.state.approved', 'Approved');
    case 'CHANGED': return t('app.automations.state.changed', 'Changed since it was approved');
    case 'UNADOPTED': return t('app.automations.state.waiting', 'Waiting for approval');
  }
}

/** A sentence the server could not state, or sent blank, reads "not stated" rather than as an empty field. */
export function orNotStated(text: string | null | undefined): string {
  return text && text.trim() ? text : t('app.automations.not-stated', 'not stated');
}
