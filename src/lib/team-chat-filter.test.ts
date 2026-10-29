import { describe, expect, it } from 'vitest';
import {
  NO_TEAM_FILTER,
  filterKeyOf,
  filterQueryOf,
  filterVariablesOf,
  parseTeamParam,
  teamChatReadUrl,
  withTeamFilter,
} from './team-chat-filter';
import { mergeTranscript } from './team-chat-refresh';
import type { TeamChatMessage } from '$lib/types';

// #1137. The team filter rides the URL as `?team=<headRef>` or `?team=untagged`
// and is read on the server only: the portal never filters a loaded page and
// never computes a team (a human has none).
describe('parseTeamParam', () => {
  it('reads no parameter as the unfiltered thread', () => {
    expect(parseTeamParam(null)).toEqual({ ok: true, filter: NO_TEAM_FILTER });
  });

  it('reads `untagged` as the untagged view, and any other id as a head', () => {
    expect(parseTeamParam('untagged')).toEqual({ ok: true, filter: { kind: 'untagged' } });
    expect(parseTeamParam('01a17c7a966f78e3ae29b643e303ea4d')).toEqual({
      ok: true,
      filter: { kind: 'team', headRef: '01a17c7a966f78e3ae29b643e303ea4d' },
    });
  });

  it('refuses a malformed value rather than falling back to the unfiltered thread', () => {
    for (const bad of ['', ' ', 'a b', 'x'.repeat(129), 'a/b', 'a&b=c', '<script>']) {
      expect(parseTeamParam(bad), JSON.stringify(bad)).toEqual({ ok: false });
    }
  });
});

describe('filter wire shapes', () => {
  const team = { kind: 'team', headRef: 'h1' } as const;

  it('sends exactly one of teamHeadRef / untagged, never both', () => {
    expect(filterVariablesOf(NO_TEAM_FILTER)).toEqual({});
    expect(filterVariablesOf(team)).toEqual({ teamHeadRef: 'h1' });
    expect(filterVariablesOf({ kind: 'untagged' })).toEqual({ untagged: true });
  });

  it('round-trips through the query string the route validates', () => {
    expect(filterQueryOf(NO_TEAM_FILTER)).toBe('');
    expect(filterQueryOf(team)).toBe('team=h1');
    expect(filterQueryOf({ kind: 'untagged' })).toBe('team=untagged');
  });

  it('keys stale-response guards on the head id, never on a label', () => {
    expect(filterKeyOf(NO_TEAM_FILTER)).toBe('all');
    expect(filterKeyOf(team)).toBe('team:h1');
    expect(filterKeyOf({ kind: 'untagged' })).toBe('untagged');
    expect(filterKeyOf(team)).not.toBe(filterKeyOf({ kind: 'team', headRef: 'h2' }));
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
  it('sets and clears ?team= on the page URL and keeps every other parameter', () => {
    const base = new URL('https://x.test/app/apps/a1?tab=chats&view=full&team=old');
    expect(withTeamFilter(base, { kind: 'team', headRef: 'h1' }).search).toBe('?tab=chats&view=full&team=h1');
    expect(withTeamFilter(base, { kind: 'untagged' }).searchParams.get('team')).toBe('untagged');
    const cleared = withTeamFilter(base, NO_TEAM_FILTER);
    expect(cleared.searchParams.has('team')).toBe(false);
    expect(cleared.searchParams.get('view')).toBe('full');
    expect(base.searchParams.get('team')).toBe('old'); // the input is not mutated
  });

  it('carries the filter on tail, older and newer reads of the isolated endpoint', () => {
    const f = { kind: 'team', headRef: 'h 1' } as const;
    expect(teamChatReadUrl('a1', {}, NO_TEAM_FILTER)).toBe('/app/apps/a1/team-chat');
    expect(teamChatReadUrl('a1', {}, f)).toBe('/app/apps/a1/team-chat?team=h+1');
    expect(teamChatReadUrl('a1', { sinceSeq: 5 }, f)).toBe('/app/apps/a1/team-chat?sinceSeq=5&team=h+1');
    expect(teamChatReadUrl('a1', { beforeSeq: 5 }, { kind: 'untagged' })).toBe('/app/apps/a1/team-chat?beforeSeq=5&team=untagged');
  });
});
