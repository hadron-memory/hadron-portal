/**
 * #855 (@codex on #908) — the team chat's roster re-read: when it asks, when it
 * does not, and that a failure is retried rather than remembered.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRosterRefresher, createRosterRefreshers, fetchRosterFrom, type RosterEntry } from './team-chat-roster';

const m = (authorWorkerId: string | null) => ({ authorWorkerId });
const ROSTER: RosterEntry[] = [{ id: 'new', urn: 'hrn:worker:acme.com:team:new' }];

describe('createRosterRefresher', () => {
  it('does not ask on a routine tick — every author already known', async () => {
    const fetchRoster = vi.fn(async () => ROSTER);
    const r = createRosterRefresher(fetchRoster);
    expect(await r.refreshFor([m('w1'), m(null)], new Set(['w1']))).toBeNull();
    expect(fetchRoster).not.toHaveBeenCalled();
  });

  it('asks once for a never-seen worker, and not again after a successful read — even if still unknown', async () => {
    const fetchRoster = vi.fn(async () => [] as RosterEntry[]); // succeeds, but lacks the id
    const r = createRosterRefresher(fetchRoster);
    expect(await r.refreshFor([m('ghost')], new Set())).toEqual([]);
    await r.refreshFor([m('ghost')], new Set());
    await r.refreshFor([m('ghost')], new Set());
    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });

  it('RETRIES after a failed read — a transient failure must not leave the worker chip-less (@codex on #908)', async () => {
    const fetchRoster = vi.fn<() => Promise<RosterEntry[] | null>>()
      .mockResolvedValueOnce(null) // failed
      .mockResolvedValueOnce(ROSTER);
    const r = createRosterRefresher(fetchRoster);
    expect(await r.refreshFor([m('new')], new Set())).toBeNull();
    // Forward polling no longer repeats the message that introduced this
    // worker; an empty later page still has to retry the pending lookup.
    expect(await r.refreshFor([], new Set())).toEqual(ROSTER);
    expect(fetchRoster).toHaveBeenCalledTimes(2);
  });

  it('a THROWN failure is released for retry too', async () => {
    const fetchRoster = vi.fn<() => Promise<RosterEntry[] | null>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(ROSTER);
    const r = createRosterRefresher(fetchRoster);
    expect(await r.refreshFor([m('new')], new Set())).toBeNull();
    expect(await r.refreshFor([m('new')], new Set())).toEqual(ROSTER);
  });

  it('a slow EARLIER read never replaces a newer roster (@codex on #908)', async () => {
    const releases: Array<(v: RosterEntry[]) => void> = [];
    const fetchRoster = vi.fn(() => new Promise<RosterEntry[]>((res) => releases.push(res)));
    const r = createRosterRefresher(fetchRoster);
    const older = r.refreshFor([m('a')], new Set()); // read #1, for worker a
    const newer = r.refreshFor([m('b')], new Set()); // read #2, for worker b, while #1 is in flight
    const both: RosterEntry[] = [{ id: 'a', urn: 'hrn:worker:acme.com:team:a' }, { id: 'b', urn: 'hrn:worker:acme.com:team:b' }];
    releases[1](both); // #2 lands first
    expect(await newer).toEqual(both);
    releases[0]([{ id: 'a', urn: 'hrn:worker:acme.com:team:a' }]); // #1 lands late, without b
    expect(await older).toBeNull(); // dropped, not applied over the newer roster
  });

  it('retries an id from a stale earlier read when the newer roster did not include it', async () => {
    const releases: Array<(v: RosterEntry[]) => void> = [];
    const fetchRoster = vi.fn(() => new Promise<RosterEntry[]>((res) => releases.push(res)));
    const r = createRosterRefresher(fetchRoster);
    const older = r.refreshFor([m('a')], new Set());
    const newer = r.refreshFor([m('b')], new Set());
    const b = [{ id: 'b', urn: 'hrn:worker:acme.com:team:b' }];
    releases[1](b);
    expect(await newer).toEqual(b);
    releases[0]([{ id: 'a', urn: 'hrn:worker:acme.com:team:a' }]);
    expect(await older).toBeNull();

    const retry = r.refreshFor([], new Set(['b']));
    expect(fetchRoster).toHaveBeenCalledTimes(3);
    const both = [...b, { id: 'a', urn: 'hrn:worker:acme.com:team:a' }];
    releases[2](both);
    expect(await retry).toEqual(both);
  });

  it('an older success still applies when the NEWER read failed', async () => {
    const settles: Array<(v: RosterEntry[] | null) => void> = [];
    const fetchRoster = vi.fn(() => new Promise<RosterEntry[] | null>((res) => settles.push(res)));
    const r = createRosterRefresher(fetchRoster);
    const older = r.refreshFor([m('a')], new Set());
    const newer = r.refreshFor([m('b')], new Set());
    settles[1](null); // #2 failed
    expect(await newer).toBeNull();
    settles[0](ROSTER); // #1 succeeds late — nothing newer was applied, so it counts
    expect(await older).toEqual(ROSTER);
  });

  it('two overlapping polls cost ONE read', async () => {
    let release!: (v: RosterEntry[]) => void;
    const fetchRoster = vi.fn(() => new Promise<RosterEntry[]>((res) => (release = res)));
    const r = createRosterRefresher(fetchRoster);
    const first = r.refreshFor([m('new')], new Set());
    const second = await r.refreshFor([m('new')], new Set()); // while the first is in flight
    expect(second).toBeNull();
    release(ROSTER);
    expect(await first).toEqual(ROSTER);
    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });
});

describe('fetchRosterFrom', () => {
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it('returns the workers of a good response', async () => {
    expect(await fetchRosterFrom('/x', respond(200, { workers: ROSTER, loadFailed: false }))()).toEqual(ROSTER);
  });

  it('reduces every failure shape to null — non-2xx, loadFailed, malformed body, rejected fetch', async () => {
    expect(await fetchRosterFrom('/x', respond(500, {}))()).toBeNull();
    expect(await fetchRosterFrom('/x', respond(200, { workers: [], loadFailed: true }))()).toBeNull();
    expect(await fetchRosterFrom('/x', respond(200, { nope: 1 }))()).toBeNull();
    const bad = vi.fn(async () => new Response('not json', { status: 200 })) as unknown as typeof fetch;
    expect(await fetchRosterFrom('/x', bad)()).toBeNull();
    const down = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await fetchRosterFrom('/x', down)()).toBeNull();
  });
});

describe('createRosterRefreshers — one refresher per roster generation (@codex on #908)', () => {
  it('a NEW generation re-asks an id an old generation already asked', async () => {
    const fetchRoster = vi.fn(async () => ROSTER);
    const forGen = createRosterRefreshers(fetchRoster);
    const gen1 = [{ id: 'old' }];
    const gen2 = [{ id: 'old' }]; // a reloaded roster: a different object
    await forGen(gen1).refreshFor([m('new')], new Set());
    // The page dropped gen1's result (its roster was replaced mid-flight);
    // gen2 has asked nothing, so the same id is asked again.
    await forGen(gen2).refreshFor([m('new')], new Set());
    expect(fetchRoster).toHaveBeenCalledTimes(2);
  });

  it('the SAME generation keeps its memory — no re-ask', async () => {
    const fetchRoster = vi.fn(async () => ROSTER);
    const forGen = createRosterRefreshers(fetchRoster);
    const gen = [{ id: 'old' }];
    await forGen(gen).refreshFor([m('new')], new Set());
    await forGen(gen).refreshFor([m('new')], new Set());
    expect(fetchRoster).toHaveBeenCalledTimes(1);
  });

  it('"no roster" (null) is one generation, shared', async () => {
    const forGen = createRosterRefreshers(async () => ROSTER);
    expect(forGen(null)).toBe(forGen(null));
  });
});
