import { describe, expect, it } from 'vitest';
import { selectionOutcome, selectionRefusalCodes } from './selection';
import type { Grant } from './types';
const g = (id: string, over: Partial<Grant> = {}) => ({ id, appId: 'a', activatedAt: null, revokedAt: null, holderDepartedAt: null, expiresAt: null, ...over }) as Grant;
describe('what became of a selection (portal#2638 item 4)', () => {
  it('reports each selected grant on its own: two activated, one still pending, never "all"', () => {
    const out = selectionOutcome(['a', 'b', 'c'], [g('a', { activatedAt: '2026-11-25T00:00:00Z' }), g('b', { activatedAt: '2026-11-25T00:00:01Z' }), g('c'), g('z', { activatedAt: 'x' })], 0);
    expect(out).toEqual({ activated: 2, pending: 1, ended: 0, elsewhere: 0 });
  });
  it('a revoked or departed grant is ended, an expired pending one is ended', () => {
    const now = Date.parse('2027-01-02T00:00:00Z');
    const out = selectionOutcome(['a', 'b', 'c'], [g('a', { revokedAt: 'x' }), g('b', { holderDepartedAt: 'x' }), g('c', { expiresAt: '2027-01-01T00:00:00Z' })], now);
    expect(out).toEqual({ activated: 0, pending: 0, ended: 3, elsewhere: 0 });
  });
  it('a selected grant that is not on the read page is counted as elsewhere, never guessed', () => {
    expect(selectionOutcome(['a', 'gone'], [g('a')], 0)).toEqual({ activated: 0, pending: 1, ended: 0, elsewhere: 1 });
  });
});
describe('the refusal codes the page words from the server (portal#2638 item 3)', () => {
  it('names exactly the codes the issue lists, plus FORBIDDEN while impersonating', () => {
    expect([...selectionRefusalCodes].sort()).toEqual(['FORBIDDEN', 'GRANT_EXPIRED', 'GRANT_NOT_FOUND', 'GRANT_NOT_PENDING', 'GRANT_TERMS_UNREPRESENTABLE', 'SELECTION_DUPLICATE_GRANT', 'SELECTION_EMPTY', 'SELECTION_MIXED_APPS', 'SELECTION_TOO_LARGE']);
  });
});
