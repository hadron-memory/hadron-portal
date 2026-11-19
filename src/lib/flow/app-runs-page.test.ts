import { describe, it, expect } from 'vitest';
import { parseRunsQuery, runsHref, isRunsSection, runsAnnouncement } from './app-runs-page';
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

describe('runsAnnouncement (portal#2291)', () => {
  it.each([
    [{ total: 100, sort: 'createdAt', page: 3 }, '100 runs, sorted by Created, page 3 of 5'],
    [{ total: 21, sort: 'startedAt', page: 2 }, '21 runs, sorted by Started, page 2 of 2'],
    [{ total: 20, sort: 'finishedAt', page: 1 }, '20 runs, sorted by Finished, page 1 of 1'],
    [{ total: 1, sort: 'status', page: 1 }, '1 run, sorted by Status, page 1 of 1'],
    [{ total: 0, sort: 'createdAt', page: 1 }, '0 runs, sorted by Created, page 1 of 1'],
  ] as const)('%j reads "%s"', (served, text) => {
    expect(runsAnnouncement(served)).toBe(text);
  });
});
