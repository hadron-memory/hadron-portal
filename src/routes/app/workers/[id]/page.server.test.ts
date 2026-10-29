/**
 * #735 — the worker page loader. Mocks the server's `worker(ref:)` query and
 * asserts the page reads the right worker, and that a refusal is
 * indistinguishable from a miss (the server's own posture: the roster must not
 * be an existence oracle).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { parse, visit } from 'graphql';
import { TEAM_WORK_ITEMS_QUERY, WORKERS_QUERY, WORKER_QUERY, WORKER_SESSIONS_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: (...args: unknown[]) => mockRequest(...args) }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  // #737 — every load now makes three requests: the worker, then its worker
  // sessions and its worklog. This is the DEFAULT for the latter two, so the
  // identity-half tests below can keep seeding only their one-shot worker
  // response; a test that cares about a section seeds it with
  // mockResolvedValueOnce, which takes precedence over this.
  mockRequest.mockResolvedValue({ sessions: [], teamWorkItems: { items: [], total: 0 } });
});

/** `search` is the incoming query string (#758) — a real URL so `url.searchParams`
 *  behaves exactly as the framework's does, rather than a stub that could
 *  disagree with it. */
function ev(id = 'w-1', search = '') {
  return {
    params: { id },
    url: new URL(`http://localhost/app/workers/${id}${search}`),
    locals: { user: { id: 'u1' }, token: 'tok' },
  } as never;
}

async function runLoad(id = 'w-1', search = '') {
  const { load } = await import('./+page.server');
  return (await load(ev(id, search))) as { worker: Record<string, unknown>; initialTab: string | null };
}

async function expectStatus(id = 'w-1'): Promise<number> {
  const { load } = await import('./+page.server');
  try {
    await load(ev(id));
  } catch (e) {
    return (e as { status: number }).status;
  }
  throw new Error('Expected load to throw, but it returned normally');
}

/** A GraphQL ClientError carrying one coded error. */
function gqlError(code: string) {
  return new ClientError(
    { errors: [{ message: 'nope', extensions: { code } }], status: 200 } as never,
    { query: '' } as never,
  );
}

const WORKER = {
  id: 'w-1',
  appId: 'app-1',
  agentId: 'a-1',
  name: 'Gil',
  slug: 'gil',
  urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:gil',
  role: 'portal-engineer',
  promptOverride: null,
  memoryId: 'mem-9',
  retiredAt: null,
  createdAt: '2026-08-16T09:00:00Z',
  agent: { id: 'a-1', name: 'Portal Engineer', urn: 'hrn:agent:x:pe', personaRole: 'portal-engineer' },
  app: { id: 'app-1', name: 'Hadron Dev Team', urn: 'hrn:app:hadronmemory.com:hadron-dev-team' },
};

describe('worker page load', () => {
  it('reads the worker by the route id and returns it', async () => {
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    const data = await runLoad('w-1');
    expect(data.worker).toMatchObject({ name: 'Gil', urn: WORKER.urn });
    expect(mockRequest.mock.calls[0][0]).toBe(WORKER_QUERY);
    expect(mockRequest.mock.calls[0][1]).toEqual({ ref: 'w-1' });
  });

  it('404s when the worker resolves null', async () => {
    mockRequest.mockResolvedValueOnce({ worker: null });
    expect(await expectStatus()).toBe(404);
  });

  // The server reports a denied NAME-form read as WORKER_NOT_FOUND precisely so
  // the roster is not an existence oracle. The portal must not undo that by
  // rendering a distinguishable "forbidden" page.
  it.each(['WORKER_NOT_FOUND', 'NOT_FOUND', 'FORBIDDEN'])(
    'reports %s as an indistinguishable 404',
    async (code) => {
      mockRequest.mockRejectedValueOnce(gqlError(code));
      expect(await expectStatus()).toBe(404);
    },
  );

  // hrn:node:hadronmemory.com:hadron-portal:review:clienterror-map-known-codes-only — an unknown code or a payload-less
  // transport failure must stay a 500, or an outage gets mislabelled as
  // "no such worker" and someone goes looking for a deleted row.
  //
  // The first version of this test was a guard that COULD NOT FAIL, caught by
  // Codex on #742. It called `runLoad()` (consuming the one-shot rejection) and
  // then `expectStatus()`, which ran the loader a second time against a mock
  // now returning undefined — destructuring that threw a TypeError whose
  // `.status` is undefined, and `undefined !== 404` passed trivially. It would
  // have stayed green even if the loader started mapping INTERNAL_SERVER_ERROR
  // to a 404, which is the only thing it was there to prevent.
  //
  // Now it asserts on the ONE rejection it seeds: the error must propagate, and
  // must not be a 404. (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail — mutation-checked
  // by making the loader map this code to 404, which reds it.)
  it('rethrows an unknown GraphQL error code rather than calling it a 404', async () => {
    mockRequest.mockRejectedValueOnce(gqlError('INTERNAL_SERVER_ERROR'));
    const { load } = await import('./+page.server');
    let thrown: unknown;
    try {
      await load(ev());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeDefined();
    // A SvelteKit `error(404, …)` throws an object with status 404; the
    // rethrown ClientError has no `status` at all. Either way it must not be a
    // 404, and it must have actually thrown.
    expect((thrown as { status?: number }).status).not.toBe(404);
    expect(thrown).toBeInstanceOf(ClientError);
  });

  it('rethrows a non-GraphQL failure (transient outage is not a not-found)', async () => {
    mockRequest.mockRejectedValueOnce(new Error('socket hang up'));
    await expect(runLoad()).rejects.toThrow('socket hang up');
  });

  // A worker whose App URN predates flat grammar-v2 has no URN. That is a fact
  // about the App, not an error, so the page must still load.
  //
  // `slug` stays populated: it is `String!` in the schema and deriving it never
  // refuses, so a worker with a slug and no URN is the real shape. The first
  // version of this test nulled both, which was a fixture the server cannot
  // produce — and a fixture that cannot happen hides bugs in whatever depends
  // on the field. Caught by Copilot on #742.
  it('loads a worker with no URN (slug is still present — it is non-null)', async () => {
    mockRequest.mockResolvedValueOnce({ worker: { ...WORKER, urn: null } });
    const data = await runLoad();
    expect(data.worker.urn).toBeNull();
    expect(data.worker.slug).toBe('gil');
    expect(data.worker.name).toBe('Gil');
  });

  it('loads a retired worker rather than hiding it', async () => {
    mockRequest.mockResolvedValueOnce({
      worker: { ...WORKER, retiredAt: '2026-08-17T10:00:00Z' },
    });
    const data = await runLoad();
    expect(data.worker.retiredAt).toBe('2026-08-17T10:00:00Z');
  });
});

describe('WORKER_QUERY selection', () => {
  // RATCHET FLIPPED, not deleted (hrn:node:hadronmemory.com:hadron-server:review:convention-ratchets-must-be-flipped).
  //
  // Through #742 this asserted the OPPOSITE — that WORKER_QUERY must not select
  // `prompt` — because the page had nowhere to put a multi-KB briefing and
  // shipping it in the payload was pure cost. Its own comment named the
  // condition for flipping: "#737 covers showing it behind an explicit expand."
  // That is this change, so the guard moves forward rather than being removed.
  //
  // The invariant was never "never select prompt". It is "select it only where
  // it is rendered, and never on a list" — which is why the sibling guard below
  // now carries the half that actually risks hadron-cli#459.
  it('selects the boot prompt, which the page renders behind an explicit expand', () => {
    expect(WORKER_QUERY).toMatch(/^\s*prompt\s*$/m);
  });

  // The half of the old rule that still bites, and the one with real blast
  // radius. WorkerFields feeds the Staff tab's ROSTER as well as this page, so
  // a `prompt` added there would ship every worker's briefing on every roster
  // render — hadron-cli#459 exactly, where `worker list` cost 68,245 bytes for
  // seven workers against 3,732 without it.
  //
  // Asserted against the ROSTER operation rather than the fragment source, so
  // it stays true however the fragment is composed.
  // portal#1067 (hadron-server#1726): who this worker reports to. The page
  // names the target, so the nested Worker rides along here; the roster
  // resolves it from its own rows instead (one lookup per row otherwise).
  it('selects who the worker reports to, with the target named', () => {
    expect(WORKER_QUERY).toMatch(/^\s*reportsToWorkerId\s*$/m);
    expect(WORKER_QUERY).toMatch(/^\s*reportsToRetired\s*$/m);
    expect(WORKER_QUERY).toMatch(/reportsTo \{ id name urn retiredAt \}/);
  });

  it('the roster selects the reports-to id, its retired flag and last activity, not the nested target', () => {
    expect(WORKERS_QUERY).toMatch(/\breportsToWorkerId\b/);
    expect(WORKERS_QUERY).toMatch(/\breportsToRetired\b/);
    expect(WORKERS_QUERY).toMatch(/\blastActiveAt\b/);
    expect(WORKERS_QUERY).not.toMatch(/reportsTo \{/);
  });

  it('keeps the boot prompt OFF the staff roster', () => {
    expect(WORKERS_QUERY).not.toMatch(/^\s*prompt\s*$/m);
  });

  // The URN is the whole point of the page — without it the identity chip and
  // the copyable link both vanish silently.
  it('selects urn and slug', () => {
    expect(WORKER_QUERY).toMatch(/^\s*urn\s*$/m);
    expect(WORKER_QUERY).toMatch(/^\s*slug\s*$/m);
  });

  // The breadcrumb's "Apps" link must go to the ORG app list for an org-owned
  // App: /app/apps is the org-less "My apps" list (#647) and would not contain
  // the team App the reader just came from. That destination is chosen from
  // `app.organizationId`, so the query has to select it. Codex on #742.
  it('selects the App organizationId the breadcrumb needs', () => {
    expect(WORKER_QUERY).toMatch(/app\s*\{[^}]*\borganizationId\b/);
  });

  // The resolver hands over only a worker id, so Worker.app is what lets the
  // page name and link the team.
  it('selects the App so the page can link it', () => {
    expect(WORKER_QUERY).toMatch(/app\s*\{[^}]*\bname\b/);
  });
});

/**
 * #737 — the two sections that answer "what has this worker actually done".
 *
 * The rule under test throughout: a section the viewer cannot read surfaces as
 * UNAVAILABLE (null), never as empty ([]). Collapsing a refusal or an outage
 * into an empty array is the portal telling the reader this worker has done
 * nothing, which is a claim it did not read.
 */
describe('worker page sections (#737)', () => {
  const SESSION = {
    id: 's-1',
    type: 'DEVELOPER',
    repo: 'hadron-memory/hadron-portal',
    branch: 'main',
    tool: 'claude-code',
    host: 'laptop',
    llmModel: 'claude-opus-5',
    plan: null,
    summary: null,
    prNumber: 749,
    turnCount: 12,
    errorCount: 0,
    startedAt: '2026-08-20T09:00:00Z',
    endedAt: null,
    expiresAt: '2026-08-21T09:00:00Z',
    autoExpiredAt: null,
    transcriptPath: '/Users/x/.claude/t.jsonl',
  };
  const ITEM = {
    nodeId: 'n-1',
    sessionId: 's-1',
    workerName: 'Gil',
    workerId: 'w-1',
    tool: 'github',
    kind: 'pr',
    ref: 'hadron-memory/hadron-portal#749',
    action: 'opened',
    at: '2026-08-20T10:00:00Z',
    detail: null,
  };

  it('filters both sections by THIS worker, server-side', async () => {
    mockRequest
      .mockResolvedValueOnce({ worker: WORKER })
      .mockResolvedValueOnce({ sessions: [SESSION] })
      .mockResolvedValueOnce({ teamWorkItems: { items: [ITEM], total: 1 } });
    const data = (await runLoad()) as Record<string, unknown>;

    expect(mockRequest.mock.calls[1][0]).toBe(WORKER_SESSIONS_QUERY);
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ workerRef: 'w-1' });
    // The worklog needs BOTH: teamWorkItems is App-scoped and workerRef narrows
    // within it. Dropping the workerRef would silently show the whole team's
    // worklog on one worker's page.
    expect(mockRequest.mock.calls[2][1]).toMatchObject({ appRef: 'app-1', workerRef: 'w-1' });
    expect(data.worklogTotal).toBe(1);
  });

  it('reports a FAILED sessions read as unavailable (null), not as an empty history', async () => {
    mockRequest
      .mockResolvedValueOnce({ worker: WORKER })
      .mockRejectedValueOnce(gqlError('FORBIDDEN'))
      .mockResolvedValueOnce({ teamWorkItems: { items: [], total: 0 } });
    const data = (await runLoad()) as Record<string, unknown>;
    expect(data.workerSessions).toBeNull();
  });

  it('reports a FAILED worklog read as unavailable (null), not as an empty worklog', async () => {
    mockRequest
      .mockResolvedValueOnce({ worker: WORKER })
      .mockResolvedValueOnce({ sessions: [] })
      .mockRejectedValueOnce(new Error('socket hang up'));
    const data = (await runLoad()) as Record<string, unknown>;
    expect(data.worklog).toBeNull();
    // An empty list is a DIFFERENT value and must stay distinguishable.
    expect(data.worklog).not.toEqual([]);
  });

  it('distinguishes a genuinely empty section from an unavailable one', async () => {
    mockRequest
      .mockResolvedValueOnce({ worker: WORKER })
      .mockResolvedValueOnce({ sessions: [] })
      .mockResolvedValueOnce({ teamWorkItems: { items: [], total: 0 } });
    const data = (await runLoad()) as Record<string, unknown>;
    expect(data.workerSessions).toEqual([]);
    expect(data.worklog).toEqual([]);
  });

  // Neither section may take the page down: the identity half loaded fine, and
  // a reader who came from a GitHub signature still gets their answer.
  it('still returns the worker when BOTH sections fail', async () => {
    mockRequest
      .mockResolvedValueOnce({ worker: WORKER })
      .mockRejectedValueOnce(new Error('down'))
      .mockRejectedValueOnce(new Error('down'));
    const data = (await runLoad()) as Record<string, unknown>;
    expect((data.worker as { name: string }).name).toBe('Gil');
    expect(data.workerSessions).toBeNull();
    expect(data.worklog).toBeNull();
  });

  // `worker.app` runs its own read gate and masks to null on deny (#552), and
  // teamWorkItems REQUIRES an appRef. So a masked App is not an outage and not
  // an empty worklog — it is a section that cannot even be asked for.
  it('does not attempt the worklog when the App is masked, and reports unavailable', async () => {
    mockRequest.mockResolvedValueOnce({ worker: { ...WORKER, app: null } });
    const data = (await runLoad()) as Record<string, unknown>;
    expect(data.worklog).toBeNull();
    // The worklog request is never made. Asserted by document, not by a call
    // count: portal#1099's wake read is a further, independent call.
    expect(mockRequest.mock.calls.map((c) => c[0])).not.toContain(TEAM_WORK_ITEMS_QUERY);
    expect(mockRequest.mock.calls.map((c) => c[0])).toContain(WORKER_SESSIONS_QUERY);
  });

  // `sessions` returns a bare [Session!]! with no total, so "is there more" can
  // only be observed. The loader fetches limit+1 and slices.
  it('detects more worker sessions by a full page, and does not show the probe row', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...SESSION, id: `s-${i}` }));
    mockRequest
      .mockResolvedValueOnce({ worker: WORKER })
      .mockResolvedValueOnce({ sessions: many })
      .mockResolvedValueOnce({ teamWorkItems: { items: [], total: 0 } });
    const data = (await runLoad()) as Record<string, unknown>;
    expect(data.sessionsTruncated).toBe(true);
    expect((data.workerSessions as unknown[]).length).toBe(20);
    // The +1 is a probe, not content — asking for exactly the page size would
    // make a full page indistinguishable from the last one.
    expect(mockRequest.mock.calls[1][1]).toMatchObject({ limit: 21 });
  });

  it('does not claim truncation on a short page', async () => {
    mockRequest
      .mockResolvedValueOnce({ worker: WORKER })
      .mockResolvedValueOnce({ sessions: [SESSION] })
      .mockResolvedValueOnce({ teamWorkItems: { items: [], total: 0 } });
    const data = (await runLoad()) as Record<string, unknown>;
    expect(data.sessionsTruncated).toBe(false);
  });
});

describe('WORKER_SESSIONS_QUERY selection', () => {
  // The reap-vs-close distinction the whole page turns on. endedAt alone cannot
  // draw it — the reaper sets endedAt too — so dropping autoExpiredAt would
  // render every reaped session as a deliberate close.
  it('selects autoExpiredAt and expiresAt, the two lifecycle signals no client shows', () => {
    expect(WORKER_SESSIONS_QUERY).toMatch(/^\s*autoExpiredAt\s*$/m);
    expect(WORKER_SESSIONS_QUERY).toMatch(/^\s*expiresAt\s*$/m);
  });

  // Session.worker runs a WIDER gate than worker(ref:) — it admits any org
  // member and survives a user leaving the App. Selecting working state through
  // it would let a former member read current staffing off a historical
  // session, which would look like a working feature.
  it('does not reach a Worker through the wider Session.worker gate', () => {
    expect(WORKER_SESSIONS_QUERY).not.toMatch(/\bworker\s*\{/);
    expect(WORKER_SESSIONS_QUERY).not.toMatch(/\bheldByUserId\b/);
  });
});

/**
 * Codex P1 on #752 — SCOPE. `sessions` returns "sessions recorded against the
 * caller" and `workerRef` only narrows that caller-scoped set, so the section
 * shows the VIEWER's stints as this worker, never the worker's full history.
 *
 * #737 assumed otherwise. These guards keep the assumption from creeping back
 * in through a query change, since nothing in the operation's shape reveals it.
 */
describe('WORKER_SESSIONS_QUERY scope (#752)', () => {
  it('passes workerRef, which is the only thing narrowing the caller-scoped set', () => {
    expect(WORKER_SESSIONS_QUERY).toMatch(/sessions\(\s*workerRef:\s*\$workerRef/);
  });

});

// #758 — the tab ids are ADDRESSES. This page is the destination of every
// `hrn:worker:` URN a worker signs its outward-facing work with, and #761 made
// `?tab=` survive the resolver, so a shared deep link lands on a named tab.
// Validated in the LOADER so an unknown value falls back rather than rendering
// a page where no panel matches.
describe('worker page tabs (#758)', () => {
  it('accepts each real tab id', async () => {
    for (const tab of ['profile', 'briefing', 'sessions', 'worklog']) {
      mockRequest.mockResolvedValueOnce({ worker: WORKER });
      const data = await runLoad('w-1', `?tab=${tab}`);
      expect(data.initialTab, tab).toBe(tab);
    }
  });

  it('falls back to null for an unknown tab rather than passing it through', async () => {
    // A value that reached the component unvalidated would match no panel and
    // render a page with a tab strip and nothing under it.
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    expect((await runLoad('w-1', '?tab=nonsense')).initialTab).toBeNull();
  });

  it('is null when no tab is requested', async () => {
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    expect((await runLoad('w-1')).initialTab).toBeNull();
  });

  it('does not confuse the App page\'s tab ids for its own', async () => {
    // `?tab=staff` is the App page's, and the two pages are one resolver hop
    // apart — a worker URN and its App URN both land in /app/u. A shared id
    // space would silently open the wrong panel.
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    expect((await runLoad('w-1', '?tab=staff')).initialTab).toBeNull();
  });
});

describe('#1010 — the briefing view is URL-addressable (@codex on #857)', () => {
  it('accepts each real view id', async () => {
    for (const view of ['rendered', 'source']) {
      mockRequest.mockResolvedValueOnce({ worker: WORKER });
      const data = (await runLoad('w-1', `?tab=briefing&view=${view}`)) as unknown as {
        initialView: string | null;
      };
      expect(data.initialView, view).toBe(view);
    }
  });

  it('falls back to null for an unknown view rather than passing it through', async () => {
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    const data = (await runLoad('w-1', '?tab=briefing&view=nonsense')) as unknown as {
      initialView: string | null;
    };
    expect(data.initialView).toBeNull();
  });

  it('is null when no view is requested', async () => {
    // Which the component reads as Rendered — the safe default, since Source
    // is the half that can be SAVED from.
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    const data = (await runLoad('w-1', '?tab=briefing')) as unknown as { initialView: string | null };
    expect(data.initialView).toBeNull();
  });
});

describe('#1379 retired prompt contract', () => {
  it('does not select legacy prompt fields on detail or roster', () => {
    for (const query of [WORKER_QUERY, WORKERS_QUERY]) {
      const fields: string[] = [];
      visit(parse(query), { Field: node => { fields.push(node.name.value); } });
      expect(fields).not.toContain('systemPrompt');
      expect(fields).not.toContain('promptOverride');
    }
  });
});

// portal#1099 — the Wake-ups tab (Tickers S7a, read-only).
describe('Wake-ups tab (portal#1099)', () => {
  it('accepts ?tab=wake', async () => {
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    expect((await runLoad('w-1', '?tab=wake')).initialTab).toBe('wake');
  });

  it('reads the worker’s wake settings by id', async () => {
    const { WORKER_WAKE_SETTINGS_QUERY } = await import('$lib/server/tickers');
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    await runLoad();
    expect(mockRequest).toHaveBeenCalledWith(WORKER_WAKE_SETTINGS_QUERY, { workerRef: WORKER.id });
  });

  it('a non-participant’s WORKER_NOT_FOUND on the wake read is the inline state, and the page still loads', async () => {
    const { WORKER_WAKE_SETTINGS_QUERY } = await import('$lib/server/tickers');
    mockRequest.mockImplementation(async (q: string) => {
      if (q === WORKER_WAKE_SETTINGS_QUERY) throw gqlError('WORKER_NOT_FOUND');
      return { sessions: [], teamWorkItems: { items: [], total: 0 }, appTickerSettings: null };
    });
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    const data = (await runLoad()) as unknown as { wake: unknown; worker: unknown };
    expect(data.worker).toBeTruthy();
    expect(data.wake).toEqual({ kind: 'not-participant' });
  });

  it('a failed wake read is a failure state and never 404s the worker', async () => {
    const { WORKER_WAKE_SETTINGS_QUERY } = await import('$lib/server/tickers');
    mockRequest.mockImplementation(async (q: string) => {
      if (q === WORKER_WAKE_SETTINGS_QUERY) throw gqlError('INTERNAL_SERVER_ERROR');
      return { sessions: [], teamWorkItems: { items: [], total: 0 }, appTickerSettings: null };
    });
    mockRequest.mockResolvedValueOnce({ worker: WORKER });
    expect(((await runLoad()) as unknown as { wake: unknown }).wake).toEqual({ kind: 'failed' });
  });
});
