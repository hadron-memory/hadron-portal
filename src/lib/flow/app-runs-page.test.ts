import { describe, it, expect } from 'vitest';
import { parseRunsQuery, runsHref, isRunsSection } from './app-runs-page';
describe('App Runs URL state', () => {
  it('drops invalid status members, deduplicates and never turns them into GraphQL enums', () => {
    expect(parseRunsQuery(new URLSearchParams('page=3&status=FAILED,bad,FAILED,RUNNING&sort=startedAt&dir=asc'))).toEqual({ page: 3, statuses: ['RUNNING', 'FAILED'], sort: 'startedAt', dir: 'asc' });
  });
  it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'])('defaults invalid page %s', page => expect(parseRunsQuery(new URLSearchParams({ page })).page).toBe(1));
  it('bounds GraphQL offsets and roundtrips the canonical Back/Reload URL', () => {
    const q = parseRunsQuery(new URLSearchParams('page=9999999999&sort=status&dir=asc&status=FAILED'));
    expect((q.page - 1) * 20).toBeLessThanOrEqual(2147483647);
    expect(parseRunsQuery(new URL(runsHref('a', q), 'https://test').searchParams)).toEqual(q);
  });
  it('refuses malformed retry data rather than presenting it as no runs', () => {
    const good = { ...parseRunsQuery(new URLSearchParams()), runs: [], total: 0, failed: false, explicitState: false };
    expect(isRunsSection(good)).toBe(true);
    for (const bad of [{ ...good, total: -1 }, { ...good, runs: [{}] }, { ...good, statuses: ['bad'] }, { ...good, failed: 'false' }]) expect(isRunsSection(bad)).toBe(false);
  });
  it('accepts SPAWN rows from the current GraphQL trigger enum', () => {
    const row = { id: 'spawn', status: 'PENDING', entryNodeUrn: 'hrn:node:test:memory:entry', triggerKind: 'SPAWN', createdAt: '2026-11-01T00:00:00Z', startedAt: null, finishedAt: null, failure: null, eventData: null };
    expect(isRunsSection({ ...parseRunsQuery(new URLSearchParams()), runs: [row], total: 1, failed: false, explicitState: false })).toBe(true);
  });

});
