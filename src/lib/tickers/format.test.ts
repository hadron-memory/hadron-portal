/** portal#1099 — how a ticker's cadence, quiet hours and times read. */
import { describe, expect, it } from 'vitest';
import { cadenceText, daysText, reasonsSearchText, isKnownReason, noReasonsText, unrecognisedReasonText, parseQuietHours, quietHoursSummary, reasonHelp, reasonLabel, reasonsText, relativeTime, subscriptionSearchText, tickerSearchText, windowText } from './format';

describe('cadenceText', () => {
  it('uses the largest unit that divides the cadence', () => {
    expect(cadenceText(600)).toBe('10 min');
    expect(cadenceText(7200)).toBe('2 h');
    expect(cadenceText(86400)).toBe('1 day');
    expect(cadenceText(5400)).toBe('90 min');
    expect(cadenceText(90)).toBe('90 s');
  });
  it('says None for no cadence', () => {
    expect(cadenceText(null)).toBe('None');
    expect(cadenceText(0)).toBe('None');
  });
});

describe('quiet hours', () => {
  const q = { timezone: 'Europe/Berlin', windows: [{ days: [5, 1, 2, 3, 4], from: '22:00', to: '07:00' }] };

  it('summarizes the first window with its zone, marking an overnight window', () => {
    expect(quietHoursSummary(q)).toBe('22:00–07:00 Mon–Fri (overnight, ends next day) (Europe/Berlin)');
  });
  it('counts further windows as +N more, never listing them all in a cell', () => {
    const two = { ...q, windows: [...q.windows, { days: [6, 7], from: '00:00', to: '10:00' }] };
    expect(quietHoursSummary(two)).toMatch(/ \+1 more$/);
  });
  it('None when there are no quiet hours', () => {
    expect(quietHoursSummary(null)).toBe('None');
  });
  it('says the schedule isn’t shown rather than guessing one from an unexpected shape', () => {
    expect(parseQuietHours({ tz: 'x' })).toBe('invalid');
    expect(parseQuietHours({ timezone: 'UTC', windows: [{ days: [8], from: '22:00', to: '07:00' }] })).toBe('invalid');
    expect(quietHoursSummary('22:00-07:00')).toBe('Schedule not shown (unrecognized format)');
  });
  it('collapses runs of days and keeps short runs listed', () => {
    expect(daysText([1, 2, 3, 4, 5])).toBe('Mon–Fri');
    expect(daysText([1, 3])).toBe('Mon, Wed');
    expect(daysText([6, 7])).toBe('Sat, Sun');
    expect(daysText([1, 2, 3, 4, 5, 6, 7])).toBe('Every day');
  });
  it('a same-day window has no overnight note', () => {
    expect(windowText({ days: [1], from: '12:00', to: '13:00' })).toBe('12:00–13:00 Mon');
  });
});

describe('relativeTime', () => {
  const now = Date.parse('2026-10-16T10:00:00Z');
  it('reads forward and back', () => {
    expect(relativeTime('2026-10-16T10:10:00Z', now)).toBe('in 10 min.');
    expect(relativeTime('2026-10-16T07:00:00Z', now)).toBe('3 hr. ago');
  });
  it('a dash for no time', () => {
    expect(relativeTime(null, now)).toBe('—');
  });
});

// Anne's P3 on #1136: grid search reaches the labels a reader sees in a cell.
describe('search text carries the visible labels', () => {
  const tk = { name: 'eng', urn: null, enabled: false, relevance: 'MENTIONS' as const, channels: [] };
  it('a ticker’s Disabled and Mentions only labels', () => {
    const text = tickerSearchText(tk);
    expect(text).toContain('Disabled');
    expect(text).toContain('Mentions only');
  });
  it('and not the labels it doesn’t show', () => {
    const text = tickerSearchText({ ...tk, enabled: true, relevance: 'ALL' });
    expect(text).not.toContain('Disabled');
    expect(text).not.toContain('Mentions only');
    expect(text).toContain('Ticking');
  });
  it('a subscription’s via grant label, only when it was made through the grant', () => {
    expect(subscriptionSearchText({ name: 'Ada', viaGrant: true })).toContain('via grant');
    expect(subscriptionSearchText({ name: 'Ada', viaGrant: false })).not.toContain('via grant');
  });
});

describe('ticker reasons (portal#1144)', () => {
  it('labels the three server reasons', () => {
    expect(reasonLabel('READ_TEAM_CHANNEL')).toBe('Team chat');
    expect(reasonLabel('EVERY_TICK')).toBe('Every tick');
    expect(reasonLabel('LIVE_CHECK')).toBe('Live check');
  });
  it('an unknown future reason keeps its raw name and is never coerced to a known one', () => {
    expect(reasonLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(reasonHelp('SOMETHING_NEW')).toBeNull();
    expect(reasonsText(['SOMETHING_NEW'])).toBe('SOMETHING_NEW');
  });
  it('joins reasons as an any-of list in the order the server sent them', () => {
    expect(reasonsText(['EVERY_TICK', 'READ_TEAM_CHANNEL'])).toBe('Every tick, Team chat');
  });
  it('an empty list says the ticker never fires; it is not blank and not a default', () => {
    expect(reasonsText([])).toBe('Never fires (no reasons)');
  });
  it('a list with a non-string element is unavailable, not rendered as the text "null"', () => {
    expect(reasonsText([null])).toBe('Reasons unavailable');
    expect(reasonsText(['EVERY_TICK', 3])).toBe('Reasons unavailable');
  });
  it('a missing or malformed list is unavailable, not "never fires"', () => {
    expect(reasonsText(undefined)).toBe('Reasons unavailable');
    expect(reasonsText('EVERY_TICK')).toBe('Reasons unavailable');
  });
  it('every-tick help says up to one wake and keeps the limits next to the claim, in plain words', () => {
    const help = reasonHelp('EVERY_TICK')!;
    expect(help).toContain('even with no new chat');
    expect(help).toContain('costs up to one wake per subscriber per tick');
    for (const limit of ['daily budget', 'pause', 'quiet hours']) expect(help).toContain(limit);
    expect(help).toContain('can mean no wake');
    expect(help).not.toMatch(/floor|dormancy/i);
    expect(help).not.toMatch(/unconditional|every subscriber is always woken/i);
    expect(help).not.toMatch(/\bAND\b/);
  });
  it('live-check help ends at "whatever is unread", without the unexplained last sentence', () => {
    const help = reasonHelp('LIVE_CHECK')!;
    expect(help).toContain('has not checked its team channel within this ticker’s cadence');
    expect(help.endsWith('whatever is unread.')).toBe(true);
    expect(help).not.toContain('Never for');
  });
  it('the no-reasons text is "Never fires (no reasons)"', () => {
    expect(noReasonsText()).toBe('Never fires (no reasons)');
  });
  it('only the three server reasons are known; the unrecognised note is "(unrecognised)"', () => {
    for (const r of ['READ_TEAM_CHANNEL', 'EVERY_TICK', 'LIVE_CHECK']) expect(isKnownReason(r)).toBe(true);
    expect(isKnownReason('SOMETHING_NEW')).toBe(false);
    expect(unrecognisedReasonText()).toBe('(unrecognised)');
  });
  it('search reaches the unrecognised note for a well-formed unknown reason, in both projections', () => {
    const tk = { name: 'eng', urn: null, enabled: true, relevance: 'ALL', reasons: ['SOMETHING_NEW'] };
    expect(reasonsSearchText(['READ_TEAM_CHANNEL', 'SOMETHING_NEW'])).toBe('Team chat, SOMETHING_NEW (unrecognised)');
    expect(tickerSearchText(tk)).toContain('SOMETHING_NEW');
    expect(tickerSearchText(tk)).toContain('(unrecognised)');
  });
  it('search adds no unrecognised note for known, empty or malformed reasons', () => {
    expect(reasonsSearchText(['EVERY_TICK'])).toBe('Every tick');
    expect(reasonsSearchText([])).toBe('Never fires (no reasons)');
    expect(reasonsSearchText(['SOMETHING_NEW', 3])).toBe('Reasons unavailable');
    expect(reasonsSearchText(undefined)).toBe('Reasons unavailable');
    expect(tickerSearchText({ name: 'eng', urn: null, enabled: true, relevance: 'ALL', reasons: ['EVERY_TICK'] })).not.toContain('unrecognised');
  });
  it('searches by reason label', () => {
    const tk = { name: 'eng', urn: null, enabled: true, relevance: 'ALL', reasons: ['EVERY_TICK'] };
    expect(tickerSearchText(tk)).toContain('Every tick');
    expect(tickerSearchText({ ...tk, reasons: ['READ_TEAM_CHANNEL'] })).not.toContain('Every tick');
  });
});
