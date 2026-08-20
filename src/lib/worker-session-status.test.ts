import { describe, expect, it } from 'vitest';
import {
  EXPIRY_WARNING_MS,
  expiryDistance,
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

describe('expiryDistance', () => {
  it('returns a magnitude and a unit, in minutes below an hour', () => {
    expect(expiryDistance(45 * 60_000)).toEqual({ value: 45, unit: 'min' });
    expect(expiryDistance(3 * 3600_000)).toEqual({ value: 3, unit: 'h' });
  });

  it('returns no direction — "in" versus "ago" is the caller\'s sentence', () => {
    // Codex P2 on #750: returning a phrase pushes an English fragment past the
    // i18n boundary, so a translated "Expires" ends up in front of untranslated
    // text no locale can reorder. Magnitude only; the caller picks a t() key.
    expect(expiryDistance(-12 * 60_000)).toEqual(expiryDistance(12 * 60_000));
  });

  it('never rounds a deadline UP — 90 minutes is 1 h, not 2 h', () => {
    // Found by driving the page: a fixture expiring in 90 minutes rendered
    // "in 2 h". On a deadline, erring long is the one direction that matters —
    // it hands the reader an hour of confidence they do not have. Flip the
    // floor back to a round and this is the assertion that dies.
    expect(expiryDistance(90 * 60_000)).toEqual({ value: 1, unit: 'h' });
    expect(expiryDistance(119 * 60_000)).toEqual({ value: 1, unit: 'h' });
    expect(expiryDistance(120 * 60_000)).toEqual({ value: 2, unit: 'h' });
  });

  it('does not round sub-minute time up to a full minute', () => {
    // "1 min" on 30 seconds is the same overstatement in miniature.
    expect(expiryDistance(30_000)).toEqual({ value: 0, unit: 'min' });
    expect(expiryDistance(59_000)).toEqual({ value: 0, unit: 'min' });
  });

  it('switches unit exactly at the hour, not before', () => {
    expect(expiryDistance(59 * 60_000).unit).toBe('min');
    expect(expiryDistance(60 * 60_000).unit).toBe('h');
  });
});
