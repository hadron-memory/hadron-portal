import { describe, expect, it } from 'vitest';
import {
  EXPIRY_WARNING_MS,
  formatExpiryDistance,
  workerSessionStatus,
} from './worker-session-status';

const NOW = Date.parse('2026-08-20T12:00:00Z');
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('workerSessionStatus', () => {
  it('reports an open session with no end and no deadline', () => {
    expect(workerSessionStatus({}, NOW)).toEqual({
      state: 'open',
      msUntilExpiry: null,
      expiringSoon: false,
    });
  });

  it('reports a deliberately closed session as ended', () => {
    expect(workerSessionStatus({ endedAt: iso(-3600_000) }, NOW).state).toBe('ended');
  });

  it('reports a REAPED session as expired, not ended', () => {
    // The whole point of the module. The reaper sets endedAt too, so a session
    // carrying both must read as expired — "died", not "finished".
    const reaped = { endedAt: iso(-3600_000), autoExpiredAt: iso(-3600_000) };
    expect(workerSessionStatus(reaped, NOW).state).toBe('expired');
  });

  it('checks autoExpiredAt BEFORE endedAt', () => {
    // Ordering guard. Swap the two branches and this is the assertion that
    // dies: every reaped session would report a clean close, which is the
    // wrong conclusion the portal exists to stop the reader drawing.
    const reapedOnly = { autoExpiredAt: iso(-60_000) };
    const bothSet = { endedAt: iso(-60_000), autoExpiredAt: iso(-60_000) };
    expect(workerSessionStatus(reapedOnly, NOW).state).toBe('expired');
    expect(workerSessionStatus(bothSet, NOW).state).toBe('expired');
  });

  it('counts down an open session with a deadline', () => {
    const s = workerSessionStatus({ expiresAt: iso(5 * 3600_000) }, NOW);
    expect(s.state).toBe('open');
    expect(s.msUntilExpiry).toBe(5 * 3600_000);
    expect(s.expiringSoon).toBe(false);
  });

  it('warns inside the window, and exactly ON the boundary', () => {
    expect(workerSessionStatus({ expiresAt: iso(EXPIRY_WARNING_MS) }, NOW).expiringSoon).toBe(true);
    expect(workerSessionStatus({ expiresAt: iso(EXPIRY_WARNING_MS + 1) }, NOW).expiringSoon).toBe(
      false,
    );
  });

  it('still warns when the deadline has already passed', () => {
    // A past deadline on an open session is real: the row is live only until
    // the reaper next runs. Reporting "not expiring soon" here would be the
    // most misleading possible answer.
    const s = workerSessionStatus({ expiresAt: iso(-30 * 60_000) }, NOW);
    expect(s.state).toBe('open');
    expect(s.expiringSoon).toBe(true);
    expect(s.msUntilExpiry).toBeLessThan(0);
  });

  it('says nothing rather than implying safety on an unparseable deadline', () => {
    const s = workerSessionStatus({ expiresAt: 'not-a-date' }, NOW);
    expect(s).toEqual({ state: 'open', msUntilExpiry: null, expiringSoon: false });
  });

  it('does not warn about a session that already ended', () => {
    const s = workerSessionStatus({ endedAt: iso(-60_000), expiresAt: iso(60_000) }, NOW);
    expect(s.expiringSoon).toBe(false);
    expect(s.msUntilExpiry).toBeNull();
  });
});

describe('formatExpiryDistance', () => {
  it('renders future and past deadlines differently', () => {
    expect(formatExpiryDistance(45 * 60_000)).toBe('in 45 min');
    expect(formatExpiryDistance(3 * 3600_000)).toBe('in 3 h');
    expect(formatExpiryDistance(-12 * 60_000)).toBe('12 min ago');
  });

  it('never rounds a deadline UP — 90 minutes is "1 h", not "2 h"', () => {
    // Found by driving the page: the fixture expiring in 90 minutes rendered
    // "in 2 h". On a deadline, erring long is the one direction that matters —
    // it hands the reader an hour of confidence they do not have. Flip the
    // floor back to a round and this is the assertion that dies.
    expect(formatExpiryDistance(90 * 60_000)).toBe('in 1 h');
    expect(formatExpiryDistance(119 * 60_000)).toBe('in 1 h');
    expect(formatExpiryDistance(120 * 60_000)).toBe('in 2 h');
  });

  it('does not round sub-minute time up to a full minute', () => {
    // "in 1 min" on 30 seconds is the same overstatement in miniature.
    expect(formatExpiryDistance(30_000)).toBe('in 0 min');
    expect(formatExpiryDistance(59_000)).toBe('in 0 min');
  });
});
