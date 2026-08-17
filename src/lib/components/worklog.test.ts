import { describe, expect, it } from 'vitest';
import {
  actionClass,
  artifactHref,
  artifactTitle,
  normalizeFilter,
  normalizeKind,
  sessionsPerRef,
} from './worklog';
import type { TeamWorkItem } from '$lib/types';

function item(over: Partial<TeamWorkItem> = {}): TeamWorkItem {
  return {
    nodeId: 'n1',
    sessionId: 'sess-1',
    workerName: 'Gil',
    workerId: 'w1',
    tool: 'github',
    kind: 'pr',
    ref: 'hadron-memory/hadron-portal#738',
    action: 'opened',
    at: '2026-08-17T11:00:00Z',
    detail: null,
    ...over,
  };
}

describe('normalizeKind', () => {
  it.each(['pr', 'issue', 'commit', 'branch', 'repo'])('accepts %s', (k) => {
    expect(normalizeKind(k)).toBe(k);
  });

  it('lowercases and trims', () => {
    expect(normalizeKind('  PR ')).toBe('pr');
  });

  // The server refuses an unknown kind outright, so forwarding a stray query
  // param would turn a bookmarked URL into an error page. Dropping it degrades
  // to "no filter", which is what clearing the control does.
  it.each([['pull-request'], [''], ['   '], [null], [undefined]])(
    'drops an unusable kind %j rather than forwarding it',
    (raw) => {
      expect(normalizeKind(raw as string | null | undefined)).toBeUndefined();
    },
  );
});

describe('normalizeFilter', () => {
  it('trims a value', () => {
    expect(normalizeFilter('  github ')).toBe('github');
  });

  it('treats blank as absent', () => {
    expect(normalizeFilter('   ')).toBeUndefined();
    expect(normalizeFilter(null)).toBeUndefined();
  });
});

describe('artifactHref', () => {
  it('returns an http(s) url from detail', () => {
    expect(artifactHref(item({ detail: { url: 'https://github.com/o/r/pull/1' } }))).toBe(
      'https://github.com/o/r/pull/1',
    );
  });

  it('returns null when there is no detail or no url', () => {
    expect(artifactHref(item({ detail: null }))).toBeNull();
    expect(artifactHref(item({ detail: { title: 'no url here' } }))).toBeNull();
  });

  // detail is stored data written by every session on the team, not a validated
  // field. An unchecked value in an href is a stored-XSS sink.
  it.each([
    ['javascript:alert(1)'],
    ['JavaScript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD4='],
    ['file:///etc/passwd'],
    ['//evil.example.com'],
  ])('refuses the non-http(s) scheme %s', (url) => {
    expect(artifactHref(item({ detail: { url } }))).toBeNull();
  });

  it('refuses a non-string url', () => {
    expect(artifactHref(item({ detail: { url: 42 } }))).toBeNull();
  });
});

describe('artifactTitle', () => {
  it('returns a trimmed title', () => {
    expect(artifactTitle(item({ detail: { title: '  Fix the thing ' } }))).toBe('Fix the thing');
  });

  it('returns null for a missing or blank title', () => {
    expect(artifactTitle(item({ detail: null }))).toBeNull();
    expect(artifactTitle(item({ detail: { title: '   ' } }))).toBeNull();
  });
});

describe('sessionsPerRef', () => {
  // The whole point of the worklog: a PR worked across three worker sessions is
  // three records, and the spread IS the answer to "which sessions produced
  // this PR?". This helper labels that fan-out; it must never be used to
  // collapse it.
  it('counts distinct sessions per ref', () => {
    const counts = sessionsPerRef([
      item({ ref: 'o/r#1', sessionId: 's1' }),
      item({ ref: 'o/r#1', sessionId: 's2' }),
      item({ ref: 'o/r#1', sessionId: 's3' }),
      item({ ref: 'o/r#2', sessionId: 's1' }),
    ]);
    expect(counts.get('o/r#1')).toBe(3);
    expect(counts.get('o/r#2')).toBe(1);
  });

  // Two milestones from one session (opened, then merged) are ONE contributor,
  // not two — otherwise the badge would overstate how many sessions touched it.
  it('counts a session once even when it recorded several milestones', () => {
    const counts = sessionsPerRef([
      item({ ref: 'o/r#1', sessionId: 's1', action: 'opened' }),
      item({ ref: 'o/r#1', sessionId: 's1', action: 'merged' }),
    ]);
    expect(counts.get('o/r#1')).toBe(1);
  });

  it('is empty for no records', () => {
    expect(sessionsPerRef([]).size).toBe(0);
  });
});

describe('actionClass', () => {
  it('colours a known action', () => {
    expect(actionClass('merged')).toContain('violet');
    expect(actionClass('opened')).toContain('emerald');
  });

  it('is case-insensitive', () => {
    expect(actionClass('MERGED')).toBe(actionClass('merged'));
  });

  // `action` is a free lowercased string server-side, so an unrecognised verb
  // must render neutrally rather than borrow another action's meaning.
  it('falls back to neutral for an unknown action', () => {
    expect(actionClass('rebased')).toContain('zinc');
    expect(actionClass('')).toContain('zinc');
  });
});
