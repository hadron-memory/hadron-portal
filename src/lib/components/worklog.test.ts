import { describe, expect, it } from 'vitest';
import {
  actionClass,
  artifactHref,
  artifactTitle,
  normalizeFilter,
  normalizeKind,
  isWorkerAttributed,
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
    model: null,
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

  // #835 — the sharpest instance of the class, because `action` really is free:
  // `hadron_record_work(action:)` takes any verb, so these are values a caller
  // can genuinely record rather than a theoretical key. Indexed directly they
  // are non-nullish, so `?? ACTION_NEUTRAL` never ran and the chip was handed a
  // function (or Object.prototype) as its class list.
  //
  // Asserting the NEUTRAL value, not merely `not.toContain('violet')` — the
  // weaker assertion passes on the garbage too, which is the trap
  // `hrn:node:hadronmemory.com:hadron-portal:findings:a-lookup-table-answers-for-keys-it-does-not-have`
  // names.
  it.each(['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty'])(
    'falls back to neutral for the inherited key %s',
    (action) => {
      expect(actionClass(action)).toContain('zinc');
    },
  );

  it('lowercasing narrows the hazard but does not close it', () => {
    // Worth pinning because it is the reason this site needed the guard at all:
    // `toString`/`valueOf` fold to non-keys under toLowerCase(), so someone
    // measuring only those two would conclude the site was already safe.
    // `constructor` and `__proto__` are already lowercase and reach the table.
    expect(actionClass('CONSTRUCTOR')).toContain('zinc');
    expect(actionClass('  constructor  ')).toContain('zinc');
  });
});

// Codex P2 + Copilot on #739. The tool control previously derived its OPTIONS
// from the fetched page, which failed twice: a tool present only in records
// older than the page cap could never be selected, and once a tool filter
// matched nothing its option vanished with the rows — leaving the control
// showing "Any" while that filter was still applied.
//
// The fix is a free-text input with a datalist, so suggestions never limit what
// can be typed, plus unioning the active filter into the suggestions so it
// always shows itself. This pins the union rule.
describe('tool filter suggestions', () => {
  function suggestionsFor(items: Array<{ tool: string }>, selected: string): string[] {
    return [...new Set([...items.map((i) => i.tool), ...(selected ? [selected] : [])])].sort();
  }

  it('offers the tools present on the page', () => {
    expect(suggestionsFor([{ tool: 'github' }, { tool: 'gitlab' }], '')).toEqual(['github', 'gitlab']);
  });

  // The case that made the UI lie: filter returns nothing, so no row carries
  // the tool, so the control lost the value it was actively filtering by.
  it('keeps the selected tool even when no row matches it', () => {
    expect(suggestionsFor([], 'linear')).toEqual(['linear']);
  });

  it('does not duplicate a selected tool that is also present', () => {
    expect(suggestionsFor([{ tool: 'github' }], 'github')).toEqual(['github']);
  });

  it('adds nothing when no tool filter is applied', () => {
    expect(suggestionsFor([{ tool: 'github' }], '')).toEqual(['github']);
  });
});

// Codex P2 on #741. `workerName` is display-only and cannot answer "is this a
// Worker": the server writes the bound worker's name, ELSE the attributed
// USER's handle for an unbound session, and pre-#974 records carry a stored
// personaName. A human may also share a worker's name.
//
// This exact conflation shipped twice — once claiming three worker sessions
// meant three workers, and once badging a human's own record "pre-worker" —
// which is why the rule is a named predicate now rather than an inline check.
describe('isWorkerAttributed', () => {
  it('is true only when workerId is present', () => {
    expect(isWorkerAttributed(item({ workerId: 'w1' }))).toBe(true);
    expect(isWorkerAttributed(item({ workerId: null }))).toBe(false);
  });

  // The case that produced the mislabel: an unbound session records the
  // person's handle in workerName. A name is present, a Worker is not.
  it('is false for an unbound session even though workerName is populated', () => {
    expect(isWorkerAttributed(item({ workerId: null, workerName: 'holger' }))).toBe(false);
  });

  // A pre-#974 record carries a personaName. Also a name, also not a Worker —
  // and indistinguishable from the case above, which is why the badge must not
  // claim a reason.
  it('is false for a pre-worker-model record', () => {
    expect(isWorkerAttributed(item({ workerId: null, workerName: 'Ada' }))).toBe(false);
  });

  // The trap in the other direction: a human sharing a worker's name must not
  // become "a Worker" just because the string matches one.
  it('does not infer attribution from the name matching a known worker', () => {
    expect(isWorkerAttributed(item({ workerId: null, workerName: 'Gil' }))).toBe(false);
  });
});
