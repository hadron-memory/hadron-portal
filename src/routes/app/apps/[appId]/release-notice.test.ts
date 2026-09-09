/**
 * #823 — the release notice's CHROME, not its wording.
 *
 * The defect this guards is not a sentence: it is a green `role="status"` box
 * asserting success for a release that did not happen, or for one whose owed
 * team-chat announcement failed. Asserting the copy would have passed on the
 * old code the moment somebody edited the string, so these pin the mapping.
 */
import { describe, it, expect } from 'vitest';
import { releaseNotice } from './release-notice';
import type { ReleaseOutcome } from './schema';

describe('releaseNotice', () => {
  it('renders nothing for an absent message or an error', () => {
    // An error is shown in the page's own alert box; rendering it here too
    // would duplicate it.
    expect(releaseNotice(undefined)).toBeNull();
    expect(releaseNotice(null)).toBeNull();
    expect(releaseNotice({ type: 'error', text: 'nope' })).toBeNull();
  });

  it('is green and polite only for a release that happened and owed nobody a notice', () => {
    const notice = releaseNotice({ type: 'success', outcome: 'released', text: 'Name released.' });
    expect(notice).toMatchObject({ role: 'status', text: 'Name released.' });
    expect(notice?.class).toContain('green');
  });

  it('alerts, and is not green, when the owed announcement failed', () => {
    // The release stands, so this is not an error — but a notice other people
    // rely on did not go out, and a green success box is how that reaches
    // nobody. `role="alert"` is the part a screen reader gets.
    const notice = releaseNotice({
      type: 'success',
      outcome: 'announcement-failed',
      text: 'Name released — but the team-chat announcement did not post.',
    });
    expect(notice?.role).toBe('alert');
    expect(notice?.class).not.toContain('green');
  });

  it('is neutral, not green, when nothing was released', () => {
    const notice = releaseNotice({ type: 'success', outcome: 'not-held', text: 'Nothing to release.' });
    expect(notice?.class).not.toContain('green');
  });

  // A success carrying no outcome is the shape an older build's in-flight reply
  // has, and the shape a future `message()` call that forgets the field will
  // have. Falling back to the green "released" chrome would re-assert the exact
  // claim #823 removes, on the one input that says nothing about it.
  it('does not claim a release for a success with no outcome', () => {
    const notice = releaseNotice({ type: 'success', text: 'Something happened.' });
    expect(notice?.role).toBe('status');
    expect(notice?.class).not.toContain('green');
  });

  // Same skew, the other direction: a deploy adds a fourth outcome and the
  // action starts sending it to tabs whose bundle knows three. A bare
  // `CHROME[outcome]` is `undefined` there, and reading `.role` off it throws
  // inside a `$derived` — the whole App page goes down to decorate one box.
  it('degrades an outcome it does not know to neutral rather than throwing', () => {
    const notice = releaseNotice({
      type: 'success',
      outcome: 'some-future-outcome' as ReleaseOutcome,
      text: 'Something happened.',
    });
    expect(notice?.role).toBe('status');
    expect(notice?.class).not.toContain('green');
  });

  it('gives each outcome its own chrome', () => {
    const chrome = (['released', 'announcement-failed', 'not-held'] as const).map(
      (outcome) => {
        const notice = releaseNotice({ type: 'success', outcome, text: 'x' });
        return `${notice?.role}|${notice?.class}`;
      },
    );
    expect(new Set(chrome).size).toBe(3);
  });
});
