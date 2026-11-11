import { t } from '$lib/i18n/t';
/** Formatting only. No projection, ceiling comparison or freshness threshold lives here. */
export function percent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return value > 0 && value < 1 ? '<1%' : `${Math.round(value)}%`;
}
export function range(low: number | null, high: number | null): string {
  if (low === null || high === null) return '—';
  return `${percent(low).replace(/%$/, '')}–${percent(high)}`;
}
export function reasonText(reason: string | null): string {
  const reasons: Record<string, string> = {
    NO_HISTORY: t('token-use.reason.no-history', 'No usage history is available.'),
    NO_WINDOW: t('token-use.reason.no-window', 'This window has no usage reading.'),
    STALE: t('token-use.reason.stale', 'Data is out of date, so use is unknown, not zero'),
    NO_RESET: t('token-use.reason.no-reset', 'The reset time is not known.'),
    RESET_PASSED: t('token-use.reason.reset-passed', 'The reported reset time has passed.'),
    NO_WORKERS_CONFIGURED: t('token-use.reason.no-workers', 'No worker burn estimate is available.'),
    WHATIF_SOURCE_UNKNOWN: t('token-use.reason.source-unknown', 'The source worker’s burn is not known.'),
    LOW_USE: t('token-use.reason.low-use', 'Too little use to project.'),
    TOO_FEW_SNAPSHOTS: t('token-use.reason.too-few', 'More usage history is needed.'),
    HISTORY_INCOMPLETE: t('token-use.reason.incomplete', 'The server could not finish checking this account’s history.'),
  };
  return reason && Object.hasOwn(reasons, reason) ? reasons[reason] : t('token-use.reason.unknown', 'No projection: the server gave no reason we know.');
}
export function snapshotAge(observed: string, asOf: string): string {
  const minutes = Math.max(0, Math.floor((Date.parse(asOf) - Date.parse(observed)) / 60_000));
  return Number.isFinite(minutes) ? t('token-use.age', '{minutes} min ago', { minutes }) : t('token-use.age-unknown', 'Age unavailable');
}

export function dateMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
