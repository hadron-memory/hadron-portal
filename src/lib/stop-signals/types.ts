/**
 * portal#1139 — stop signals (hadron-server S6 #2022, wire from #2166).
 * Scalars only: the API returns ids, never entity URNs, and a stop signal has
 * no URN of its own (none is invented here).
 */
export type StopLevel = 'PAUSE_DISPATCH' | 'PAUSE' | 'HALT';
export type StopScope = 'HOST' | 'TEAM' | 'WORKER';

export interface StopSignal {
  id: string;
  level: StopLevel;
  scope: StopScope;
  targetWorkerId: string | null;
  targetHostId: string | null;
  setAt: string;
  until: string | null;
  setByUserId: string | null;
  setByHostKey: boolean;
  live: boolean;
  endedAt: string | null;
  endKind: 'LIFTED' | 'EXPIRED' | null;
  endedByUserId: string | null;
  endedByHostKey: boolean;
}

export interface StopSignalPage {
  signals: StopSignal[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
}

/** `App.viewerManages` as a display hint. A failed read is `unknown`, never `no`. */
export type ManagesHint = 'yes' | 'no' | 'unknown';

export type StopRead<T> = { kind: 'ok'; value: T } | { kind: 'not-participant' } | { kind: 'failed' };

/** Every live signal the banner could read; `complete` is false when pages remained past the bound. */
export interface LiveStops {
  signals: StopSignal[];
  complete: boolean;
}

export interface WorkerOption {
  id: string;
  name: string;
  urn: string | null;
}
