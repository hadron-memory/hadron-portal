import { RUN_STATUSES, type AppRun, type AppRunStatus } from './runs';
import { t } from '$lib/i18n/t';
export const RUNS_PAGE_SIZE = 20;
export const RUN_SORTS = ['createdAt', 'startedAt', 'finishedAt', 'status'] as const;
export type RunSort = typeof RUN_SORTS[number];
export interface RunsQuery { page: number; statuses: AppRunStatus[]; sort: RunSort; dir: 'asc' | 'desc' }
export interface RunsSection extends RunsQuery { runs: AppRun[]; total: number; failed: boolean; explicitState: boolean }
export function parseRunsQuery(params: URLSearchParams): RunsQuery {
  const raw = params.get('page') ?? '1';
  const n = /^\d+$/.test(raw) ? Number(raw) : 1;
  const page = Number.isSafeInteger(n) && n > 0 ? Math.min(n, 107374183) : 1;
  const selected = new Set((params.get('status') ?? '').split(','));
  const sort = params.get('sort');
  return { page, statuses: RUN_STATUSES.filter(s => selected.has(s)), sort: RUN_SORTS.includes(sort as RunSort) ? sort as RunSort : 'createdAt', dir: params.get('dir') === 'asc' ? 'asc' : 'desc' };
}
export function runsHref(appRef: string, query: RunsQuery): string {
  const p = new URLSearchParams({ tab: 'runs' });
  if (query.statuses.length) p.set('status', query.statuses.join(','));
  if (query.page > 1) p.set('page', String(query.page));
  p.set('sort', query.sort); p.set('dir', query.dir);
  return `/app/apps/${encodeURIComponent(appRef)}?${p}`;
}
/** Refuse malformed retry payloads before any formatter/table receives them. */
export function isRunsSection(value: unknown): value is RunsSection {
  if (!value || typeof value !== 'object') return false;
  const s = value as RunsSection;
  return Number.isSafeInteger(s.page) && s.page >= 1 && Number.isSafeInteger(s.total) && s.total >= 0 && typeof s.failed === 'boolean' && typeof s.explicitState === 'boolean' && RUN_SORTS.includes(s.sort) && ['asc', 'desc'].includes(s.dir) && Array.isArray(s.statuses) && s.statuses.every(x => RUN_STATUSES.includes(x)) && Array.isArray(s.runs) && s.runs.length <= RUNS_PAGE_SIZE && s.runs.every(r => r && typeof r.id === 'string' && RUN_STATUSES.includes(r.status) && typeof r.entryNodeUrn === 'string' && typeof r.triggerKind === 'string' && ['MANUAL', 'WEBHOOK', 'SCHEDULE', 'INTEGRATION', 'SPAWN'].includes(r.triggerKind) && typeof r.createdAt === 'string' && (r.startedAt === null || typeof r.startedAt === 'string') && (r.finishedAt === null || typeof r.finishedAt === 'string') && (r.failure === null || typeof r.failure === 'object') && (r.eventData === null || typeof r.eventData === 'object'));
}

/** The Sort select's label for a served sort (the same `runs.*` keys the select uses). */
export function runSortLabel(sort: RunSort): string {
  switch (sort) {
    case 'startedAt': return t('runs.started', 'Started');
    case 'finishedAt': return t('runs.finished', 'Finished');
    case 'status': return t('runs.status', 'Status');
    default: return t('runs.created', 'Created');
  }
}
/**
 * portal#2291: what the polite live region says after a successful navigate,
 * read from the SERVED section (a clamped page reads true). Direction is not
 * part of it (Uma's row 3 on #2289); Q is at least 1, so an empty list reads
 * "page 1 of 1".
 */
export function runsAnnouncement(section: Pick<RunsSection, 'total' | 'sort' | 'page'>): string {
  const vars = { n: section.total, sort: runSortLabel(section.sort), page: section.page, pages: Math.max(1, Math.ceil(section.total / RUNS_PAGE_SIZE)) };
  return section.total === 1
    ? t('runs.announce.one', '{n} run, sorted by {sort}, page {page} of {pages}', vars)
    : t('runs.announce.many', '{n} runs, sorted by {sort}, page {page} of {pages}', vars);
}
