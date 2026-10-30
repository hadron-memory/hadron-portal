import { t } from '$lib/i18n/t';
import type { LiveStops, ManagesHint, StopLevel, StopScope, StopSignal, WorkerOption } from './types';

/**
 * portal#1139 — how a stop signal reads. Copy states only the persisted
 * enforcement this slice supplies (hrn:node:hadronmemory.com:specs:cor:agt:090:03): no copy promises that a
 * worker is interrupted or told (the consumer is hadron-server#2169, not
 * built), none implies messages are held (R70), and none names a precedence
 * among overlapping stops (R69).
 */

export const STOP_LEVELS: StopLevel[] = ['PAUSE_DISPATCH', 'PAUSE', 'HALT'];

export function levelLabel(level: StopLevel): string {
  switch (level) {
    case 'PAUSE_DISPATCH':
      return t('app.stops.level.pause-dispatch', 'Pause dispatch');
    case 'PAUSE':
      return t('app.stops.level.pause', 'Pause');
    case 'HALT':
      return t('app.stops.level.halt', 'Halt');
  }
}

/** What each level does today. Each names only its own enforcement. */
export function levelEffect(level: StopLevel): string {
  switch (level) {
    case 'PAUSE_DISPATCH':
      return t('app.stops.effect.pause-dispatch', 'Matching skips the worker and a manual assignment to it is refused. Its ticks, its messages and its stall time are not affected.');
    case 'PAUSE':
      return t('app.stops.effect.pause', 'Everything Pause dispatch does, and the worker gets no ticks and its stall time is not counted.');
    case 'HALT':
      return t(
        'app.stops.effect.halt',
        'The same enforcement as Pause. Interrupting a worker is not available yet, so a halt does not stop work already in progress and no one is told.',
      );
  }
}

export function scopeLabel(scope: StopScope): string {
  switch (scope) {
    case 'WORKER':
      return t('app.stops.scope.worker', 'One worker');
    case 'TEAM':
      return t('app.stops.scope.team', 'A team');
    case 'HOST':
      return t('app.stops.scope.host', 'A host');
  }
}

/** What a scope covers, for the set form and its confirmation. TEAM is never "this worker only". */
export function scopeCoverage(scope: StopScope): string {
  return scope === 'TEAM'
    ? t('app.stops.coverage.team', 'The worker you pick and every worker reporting to it, directly or not.')
    : t('app.stops.coverage.worker', 'Only the worker you pick.');
}

export type StopState = 'live' | 'lifted' | 'expired';

/** The server's own word (`live`, `endKind`), never the client clock. */
export function stopState(s: StopSignal): StopState {
  if (s.live) return 'live';
  return s.endKind === 'EXPIRED' ? 'expired' : 'lifted';
}

export function stateLabel(state: StopState): string {
  switch (state) {
    case 'live':
      return t('app.stops.state.live', 'In effect');
    case 'lifted':
      return t('app.stops.state.lifted', 'Lifted');
    case 'expired':
      return t('app.stops.state.expired', 'Expired');
  }
}

/** The worker a signal targets, from the roster the page already read; an id not in it is shown bare. */
export function targetOf(s: StopSignal, workers: WorkerOption[]): { name: string | null; urn: string | null; id: string } | null {
  if (s.scope === 'HOST') return s.targetHostId ? { name: null, urn: null, id: s.targetHostId } : null;
  if (!s.targetWorkerId) return null;
  const w = workers.find((x) => x.id === s.targetWorkerId);
  return { name: w?.name ?? null, urn: w?.urn ?? null, id: s.targetWorkerId };
}

/** Who set or ended it: a member the viewer may see, "a host key", or "a person" with the id. */
export function actorText(userId: string | null, hostKey: boolean, people: Record<string, string>): string {
  if (hostKey) return t('app.stops.actor.host-key', 'a host key');
  if (!userId) return '—';
  return people[userId] ?? t('app.stops.actor.person', 'a person ({id})', { id: userId });
}

/** The banner's count line. A partial read says "at least", never an exact count or "none". */
export function bannerCount(live: LiveStops): string {
  const n = live.signals.length;
  if (!live.complete) {
    return n === 1
      ? t('app.stops.banner.at-least-one', 'At least 1 stop is in effect')
      : t('app.stops.banner.at-least', 'At least {n} stops are in effect', { n });
  }
  return n === 1 ? t('app.stops.banner.one', '1 stop is in effect') : t('app.stops.banner.many', '{n} stops are in effect', { n });
}

/** Lift buttons need a decisive yes: unknown (a failed hint read) and no both read-only. */
export function canLiftStops(impersonating: string | null | undefined, manages: ManagesHint): boolean {
  return !impersonating && manages === 'yes';
}
