/**
 * #855 (@codex on #908) — the team chat's roster re-read: when it asks, when it
 * does not, and that a failure is retried rather than remembered.
 */
import { describe, expect, it, vi } from 'vitest';
import { createRosterRefresher, fetchRosterFrom, type RosterEntry } from './team-chat-roster';

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
    expect(await r.refreshFor([m('new')], new Set())).toEqual(ROSTER);
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
