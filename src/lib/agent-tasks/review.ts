import { t } from '$lib/i18n/t';
import { taskStateLabel, type TaskDisplayState } from './status';

/**
 * portal#1697 — what the task page's Review section shows of a pull request's
 * readiness (hadron-server#3448, hrn:node:hadronmemory.com:specs:cor:agt:130:01).
 *
 * Ready and "counts" are the server's answers, shown as given. Nothing here
 * works them out, and nothing here reads the task's `properties`, whose `pr.*`
 * and `review.*` keys are mirrors that decide nothing
 * (hrn:node:hadronmemory.com:specs:cor:agt:050:28).
 */
export type ReviewVerdict = 'APPROVE' | 'CHANGES_REQUESTED' | 'PASS' | 'FAIL' | 'CARRY' | 'REFUSED';

export interface ReviewSlot {
  slot: string;
  /** The slot's current seat; null when none has been assigned. */
  currentTaskId: string | null;
  /** The seat's status, or MISSING with no seat. */
  state: string;
  verdict: ReviewVerdict | null;
  /** The head of the seat's newest verdict, else the head it was assigned at. */
  head: string | null;
  counts: boolean;
}

export interface PullRequestReadiness {
  ready: boolean;
  head: string;
  slots: ReviewSlot[];
}

/** A seat task's own slot and head, from its `review.seat.assigned` event. */
export interface SeatFact {
  slot: string;
  head: string;
}

/** What a task's page reads: readiness on a build task, the seat fact on a seat task. */
export interface TaskReview {
  readiness: PullRequestReadiness | null;
  seat: SeatFact | null;
}

export const REVIEW_EVENT_TYPES = ['pr.frozen', 'review.seat.assigned'];

const FULL_SHA = /^[0-9a-f]{40}$/i;

function record(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {};
}

/** The frozen head and the seat fact in events read oldest first, so the last of each type is the newest. */
export function reviewFacts(events: { type: string; payload: unknown }[]): { head: string | null; seat: SeatFact | null } {
  let head: string | null = null;
  let seat: SeatFact | null = null;
  for (const event of events) {
    const payload = record(event.payload);
    const eventHead = typeof payload.head === 'string' && FULL_SHA.test(payload.head) ? payload.head : null;
    if (event.type === 'pr.frozen') head = eventHead;
    if (event.type === 'review.seat.assigned') {
      seat = eventHead && typeof payload.slot === 'string' ? { slot: payload.slot, head: eventHead } : null;
    }
  }
  return { head, seat };
}

export const shortHead = (head: string): string => head.slice(0, 8);

/** The slots the overall line names: whatever the server said doesn't count. */
export const slotsNotCounting = (readiness: PullRequestReadiness): string[] =>
  readiness.slots.filter((s) => !s.counts).map((s) => s.slot);

export const atOlderHead = (slot: ReviewSlot, frozenHead: string): boolean => slot.head !== null && slot.head !== frozenHead;

export function verdictLabel(verdict: ReviewVerdict | null): string {
  switch (verdict) {
    case null:
      return t('app.tasks.review.verdict.none', 'None yet');
    case 'APPROVE':
      return t('app.tasks.review.verdict.approve', 'Approved');
    case 'CHANGES_REQUESTED':
      return t('app.tasks.review.verdict.changes-requested', 'Changes requested');
    case 'PASS':
      return t('app.tasks.review.verdict.pass', 'Passed');
    case 'FAIL':
      return t('app.tasks.review.verdict.fail', 'Failed');
    case 'CARRY':
      return t('app.tasks.review.verdict.carry', 'Carried');
    case 'REFUSED':
      return t('app.tasks.review.verdict.refused', 'Refused');
    default:
      return verdict;
  }
}

const KNOWN_STATES: readonly string[] = ['backlog', 'pending', 'started', 'finished', 'cancelled'];

export function seatStateLabel(state: string): string {
  if (state === 'MISSING') return t('app.tasks.review.no-seat', 'No seat');
  const lower = state.toLowerCase();
  return KNOWN_STATES.includes(lower) ? taskStateLabel(lower as TaskDisplayState) : taskStateLabel('unknown', state);
}
