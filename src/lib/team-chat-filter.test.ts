import { describe, expect, it } from 'vitest';
import {
  NO_TEAM_FILTER,
  filterKeyOf,
  filterQueryOf,
  filterVariablesOf,
  parseTeamParam,
  teamChatReadUrl,
  toggleTeamHead,
  withTeamFilter,
  type TeamChatFilter,
} from './team-chat-filter';
import { mergeTranscript } from './team-chat-refresh';
import type { TeamChatMessage } from '$lib/types';

// #1137/#1482. The team filter rides the URL as repeated `?team=<headRef>`
// values (the selection is a set) or `?team=untagged`, and is read on the
// server only: the portal never filters a loaded page and never computes a
// team (a human has none).
describe('parseTeamParam', () => {
  it('reads no parameter as the unfiltered thread', () => {
    // `null` left the signature with the single-value `get()` era (#2250 fix
    // round): every caller passes `searchParams.getAll('team')`, which is
    // never null — an absent parameter is the empty list.
    expect(parseTeamParam([])).toEqual({ ok: true, filter: NO_TEAM_FILTER });
  });

  it('reads `untagged` as the untagged view, and head ids as the selection', () => {
    expect(parseTeamParam(['untagged'])).toEqual({ ok: true, filter: { kind: 'untagged' } });
    expect(parseTeamParam(['01a17c7a966f78e3ae29b643e303ea4d'])).toEqual({
      ok: true,
      filter: { kind: 'teams', headRefs: ['01a17c7a966f78e3ae29b643e303ea4d'] },
    });
  });

  it('reads several heads as ONE selection, first-seen order kept, duplicates collapsed', () => {
    expect(parseTeamParam(['h1', 'h2'])).toEqual({ ok: true, filter: { kind: 'teams', headRefs: ['h1', 'h2'] } });
    expect(parseTeamParam(['h2', 'h1', 'h2'])).toEqual({ ok: true, filter: { kind: 'teams', headRefs: ['h2', 'h1'] } });
  });

  it('collapses a doubled `untagged` to the untagged view — duplicates are not a mix', () => {
    // The single-value read served ?team=untagged&team=untagged as untagged
    // (it read the first value); the set read must not turn that URL into an
    // error. Only untagged WITH heads is a mutually-exclusive mix.
    expect(parseTeamParam(['untagged', 'untagged'])).toEqual({ ok: true, filter: { kind: 'untagged' } });
  });

  it('holds the server’s documented cap: 20 heads parse, the 21st is invalid locally', () => {
    // The schema caps teamHeadRefs at 20 entries. Over-cap is refused HERE so
    // the read never becomes the server’s sticky cap refusal; the invalid
    // state names the filter and is left the same way as any other bad URL.
    const twenty = Array.from({ length: 20 }, (_, i) => `h${i}`);
    expect(parseTeamParam(twenty)).toEqual({ ok: true, filter: { kind: 'teams', headRefs: twenty } });
    expect(parseTeamParam([...twenty, 'h20'])).toEqual({ ok: false });
  });

  it('refuses `untagged` mixed with heads rather than dropping either side', () => {
    // The server would refuse the pair as mutually exclusive (server#3759);
    // the portal refuses at the URL so nothing is read at all.
    expect(parseTeamParam(['untagged', 'h1'])).toEqual({ ok: false });
    expect(parseTeamParam(['h1', 'untagged'])).toEqual({ ok: false });
  });

  it('refuses any malformed value rather than falling back to the unfiltered thread', () => {
    for (const bad of ['', ' ', 'a b', 'x'.repeat(129), 'a/b', 'a&b=c', '<script>']) {
      expect(parseTeamParam(['h1', bad]), JSON.stringify(bad)).toEqual({ ok: false });
      expect(parseTeamParam([bad]), JSON.stringify(bad)).toEqual({ ok: false });
    }
  });
});

describe('toggleTeamHead — a tag chip click', () => {
  it('adds a head to the selection, and starts one from no filter', () => {
    expect(toggleTeamHead(NO_TEAM_FILTER, 'h1')).toEqual({ kind: 'teams', headRefs: ['h1'] });
    expect(toggleTeamHead({ kind: 'teams', headRefs: ['h1'] }, 'h2')).toEqual({ kind: 'teams', headRefs: ['h1', 'h2'] });
  });

  it('removes a selected head, and removing the last clears the filter (never a set of zero)', () => {
    expect(toggleTeamHead({ kind: 'teams', headRefs: ['h1', 'h2'] }, 'h1')).toEqual({ kind: 'teams', headRefs: ['h2'] });
    expect(toggleTeamHead({ kind: 'teams', headRefs: ['h1'] }, 'h1')).toEqual(NO_TEAM_FILTER);
  });

  it('takes a tag click from the untagged view to that team, as from no filter', () => {
    expect(toggleTeamHead({ kind: 'untagged' }, 'h1')).toEqual({ kind: 'teams', headRefs: ['h1'] });
  });

  it('does not grow a full selection past the cap: the click is a no-op, not a wedging read', () => {
    // 20 is the server’s documented teamHeadRefs cap. Toggling a 21st head in
    // returns the SAME filter (the chip keeps its state) so navigation never
    // asks for a read the server would refuse wholesale; removals still work.
    const twenty: TeamChatFilter = { kind: 'teams', headRefs: Array.from({ length: 20 }, (_, i) => `h${i}`) };
    expect(toggleTeamHead(twenty, 'h20')).toBe(twenty);
    expect(toggleTeamHead(twenty, 'h0')).toEqual({ kind: 'teams', headRefs: twenty.headRefs.slice(1) });
  });
});

describe('filter wire shapes', () => {
  const teams: TeamChatFilter = { kind: 'teams', headRefs: ['h1', 'h2'] };

  it('sends exactly one of teamHeadRefs / untagged, never both — one head travels as the list of one', () => {
    expect(filterVariablesOf(NO_TEAM_FILTER)).toEqual({});
    expect(filterVariablesOf({ kind: 'teams', headRefs: ['h1'] })).toEqual({ teamHeadRefs: ['h1'] });
    expect(filterVariablesOf(teams)).toEqual({ teamHeadRefs: ['h1', 'h2'] });
    expect(filterVariablesOf({ kind: 'untagged' })).toEqual({ untagged: true });
  });

  it('round-trips through the query string the route validates', () => {
    expect(filterQueryOf(NO_TEAM_FILTER)).toBe('');
    expect(filterQueryOf({ kind: 'teams', headRefs: ['h1'] })).toBe('team=h1');
    expect(filterQueryOf(teams)).toBe('team=h1&team=h2');
    expect(filterQueryOf({ kind: 'untagged' })).toBe('team=untagged');
  });

  it('keys stale-response guards on the head ids, order-insensitively, never on a label', () => {
    expect(filterKeyOf(NO_TEAM_FILTER)).toBe('all');
    expect(filterKeyOf({ kind: 'teams', headRefs: ['h1', 'h2'] })).toBe('teams:h1+h2');
    expect(filterKeyOf({ kind: 'teams', headRefs: ['h2', 'h1'] })).toBe('teams:h1+h2');
    expect(filterKeyOf({ kind: 'untagged' })).toBe('untagged');
    expect(filterKeyOf(teams)).not.toBe(filterKeyOf({ kind: 'teams', headRefs: ['h1'] }));
    expect(filterKeyOf(teams)).not.toBe(filterKeyOf({ kind: 'teams', headRefs: ['h1', 'h3'] }));
  });
});

describe('mergeTranscript with structured teamTags', () => {
  const base: TeamChatMessage = {
    nodeId: 'n1', seq: 1, body: 'x', at: '2026-10-27T00:00:00Z', authorUserId: null,
    authorWorkerId: 'w1', authorName: 'Gil', sessionId: null, replyToSeq: null, mentions: [], urn: null,
    teamTags: [{ headId: 'h1', label: 'team.ada' }],
  };

  it('treats a re-read row with equal tag objects as unchanged, so a quiet poll stays invisible', () => {
    const existing = [base];
    const reread = [{ ...base, teamTags: [{ headId: 'h1', label: 'team.ada' }] }];
    expect(mergeTranscript(existing, reread)).toBe(existing);
  });

  it('still notices a changed tag, and a null that became a list', () => {
    const existing = [base];
    expect(mergeTranscript(existing, [{ ...base, teamTags: [{ headId: 'h2', label: 'team.ada' }] }])).not.toBe(existing);
    expect(mergeTranscript(existing, [{ ...base, teamTags: null }])).not.toBe(existing);
    expect(mergeTranscript([{ ...base, teamTags: null }], [{ ...base, teamTags: [] }])).not.toBe(existing);
  });
});

describe('URL builders', () => {
  it('sets and clears the repeated ?team= values on the page URL and keeps every other parameter', () => {
    const base = new URL('https://x.test/app/apps/a1?tab=chats&view=full&team=old');
    expect(withTeamFilter(base, { kind: 'teams', headRefs: ['h1'] }).search).toBe('?tab=chats&view=full&team=h1');
    expect(withTeamFilter(base, { kind: 'teams', headRefs: ['h1', 'h2'] }).searchParams.getAll('team')).toEqual(['h1', 'h2']);
    expect(withTeamFilter(base, { kind: 'untagged' }).searchParams.get('team')).toBe('untagged');
    const cleared = withTeamFilter(base, NO_TEAM_FILTER);
    expect(cleared.searchParams.has('team')).toBe(false);
    expect(cleared.searchParams.get('view')).toBe('full');
    expect(base.searchParams.get('team')).toBe('old'); // the input is not mutated
  });

  it('carries the selection on tail, older and newer reads of the isolated endpoint', () => {
    const f: TeamChatFilter = { kind: 'teams', headRefs: ['h 1', 'h2'] };
    expect(teamChatReadUrl('a1', {}, NO_TEAM_FILTER)).toBe('/app/apps/a1/team-chat');
    expect(teamChatReadUrl('a1', {}, f)).toBe('/app/apps/a1/team-chat?team=h+1&team=h2');
    expect(teamChatReadUrl('a1', { sinceSeq: 5 }, f)).toBe('/app/apps/a1/team-chat?sinceSeq=5&team=h+1&team=h2');
    expect(teamChatReadUrl('a1', { beforeSeq: 5 }, { kind: 'untagged' })).toBe('/app/apps/a1/team-chat?beforeSeq=5&team=untagged');
  });
});
