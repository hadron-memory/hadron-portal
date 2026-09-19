/**
 * #735 — the worker page loader. Mocks the server's `worker(ref:)` query and
 * asserts the page reads the right worker, and that a refusal is
 * indistinguishable from a miss (the server's own posture: the roster must not
 * be an existence oracle).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { UPDATE_WORKER_MUTATION, WORKERS_QUERY, WORKER_QUERY, WORKER_SESSIONS_QUERY } from '$lib/server/queries';

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
    // Two calls, not three: the worklog request is never made.
    expect(mockRequest.mock.calls).toHaveLength(2);
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

/**
 * #1010 — the Briefing tab edits the OVERRIDE, and that distinction is the
 * feature rather than an implementation detail.
 *
 * `Worker.prompt` is derived — bound template + override + a register block the
 * server evaluates per reader — and `updateWorker` takes only `promptOverride`.
 * A control that saved the composed briefing would fold the shared template
 * into the override and prepend it again on every render, compounding with each
 * save. These pin the two halves of not doing that: what is SENT, and what is
 * SEEDED.
 */
describe('#1010 — the briefing editor writes the override', () => {
  const WITH_OVERRIDE = { ...WORKER, promptOverride: 'Dara-specific text.', prompt: 'BOUND TEMPLATE\n\nDara-specific text.' };

  function actionEv(promptOverride: string, id = 'w-1') {
    const fd = new FormData();
    fd.set('_kind', 'updateBriefing');
    fd.set('promptOverride', promptOverride);
    return {
      params: { id },
      locals: { user: { id: 'u1' }, token: 'tok' },
      request: { formData: async () => fd },
    } as never;
  }

  async function runAction(promptOverride: string, id = 'w-1') {
    const { actions } = await import('./+page.server');
    return actions.updateBriefing(actionEv(promptOverride, id));
  }

  it('seeds the editor with the stored override, not with the composed briefing', async () => {
    // The seed is what a reader edits and saves back. Seeding it with `prompt`
    // is the whole defect this design avoids — the first save would store the
    // template inside the override.
    mockRequest.mockResolvedValueOnce({ worker: WITH_OVERRIDE });
    const data = (await runLoad()) as unknown as { briefingForm: { data: { promptOverride: string } } };
    expect(data.briefingForm.data.promptOverride).toBe('Dara-specific text.');
    expect(data.briefingForm.data.promptOverride).not.toContain('BOUND TEMPLATE');
  });

  it('seeds an empty string when the worker has no override', async () => {
    mockRequest.mockResolvedValueOnce({ worker: { ...WORKER, promptOverride: null } });
    const data = (await runLoad()) as unknown as { briefingForm: { data: { promptOverride: string } } };
    expect(data.briefingForm.data.promptOverride).toBe('');
  });

  it('sends promptOverride to updateWorker, and nothing else', async () => {
    mockRequest.mockResolvedValueOnce({ updateWorker: { id: 'w-1', promptOverride: 'new text' } });
    await runAction('new text');
    expect(mockRequest).toHaveBeenCalledWith(UPDATE_WORKER_MUTATION, {
      workerRef: 'w-1',
      promptOverride: 'new text',
    });
  });

  it('sends an EMPTY STRING to clear, never null', async () => {
    // The mutation null-clears by PRESENCE: `null` means "leave it untouched".
    // Sending null for an emptied textarea would silently discard the edit and
    // hand the reader their old text back on the next load.
    mockRequest.mockResolvedValueOnce({ updateWorker: { id: 'w-1', promptOverride: null } });
    await runAction('');
    const [, vars] = mockRequest.mock.calls[0] as [string, { promptOverride: unknown }];
    expect(vars.promptOverride).toBe('');
    expect(vars.promptOverride).not.toBeNull();
  });

  it('reports WORKER_RETIRED in the server\'s own terms', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('retired'), {
        response: { errors: [{ message: 'retired', extensions: { code: 'WORKER_RETIRED' } }] },
      }),
    );
    const res = (await runAction('x')) as { data?: { form?: { message?: { type: string; text: string } } } };
    const msg = res?.data?.form?.message;
    expect(msg?.type).toBe('error');
    expect(msg?.text).toMatch(/retired/i);
  });

  it('does NOT label an outage a client error', async () => {
    // @copilot on #857. A transport failure carries no GraphQL payload, so
    // there is no code to recognise — and the previous mapping swept it in
    // with the 4xx refusals, telling monitoring and retry logic that a server
    // fault was bad input. The same defect #843 and #851 removed from two
    // other surfaces.
    mockRequest.mockRejectedValueOnce(new Error('fetch failed'));
    const res = (await runAction('x')) as { status?: number };
    expect(res?.status).toBe(500);
  });

  it('does NOT label an unrecognised GraphQL code a client error either', async () => {
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('boom'), {
        response: { errors: [{ message: 'boom', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] },
      }),
    );
    const res = (await runAction('x')) as { status?: number };
    expect(res?.status).toBe(500);
  });

  it('keeps the typed override on screen when the save fails', async () => {
    // 500 rather than a rethrow, on purpose: a rethrow renders the error page
    // and discards what the reader typed. For a multi-KB briefing that is a
    // worse outcome than the status code was worth, so the form comes back
    // carrying their text.
    mockRequest.mockRejectedValueOnce(new Error('fetch failed'));
    const res = (await runAction('TEXT THE READER TYPED')) as {
      data?: { form?: { data?: { promptOverride?: string } } };
    };
    expect(res?.data?.form?.data?.promptOverride).toBe('TEXT THE READER TYPED');
  });

  it('reports a staffing refusal as 403 with an actionable message', async () => {
    // The portal deliberately does NOT pre-derive staffing access to hide the
    // editor — the App page's own note explains why a hidden control is worse
    // than a refused one — so the refusal has to say what access is needed.
    mockRequest.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), {
        response: { errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] },
      }),
    );
    const res = (await runAction('x')) as {
      status?: number;
      data?: { form?: { message?: { type: string; text: string } } };
    };
    expect(res?.status).toBe(403);
    expect(res?.data?.form?.message?.text).toMatch(/permission/i);
  });
});

describe('#1010 — WORKER_QUERY carries the inherited template', () => {
  it('selects the agent\'s personaPrompt, for the Source view\'s read-only half', () => {
    expect(WORKER_QUERY).toMatch(/agent\s*\{\s*personaPrompt\s*\}/);
  });

  it('keeps personaPrompt OFF the roster fragment', () => {
    // Same rule as `prompt`: select it where it is rendered, never on a list.
    // WorkerFields feeds the Staff roster, and a multi-KB template per row is
    // hadron-cli#459 in miniature.
    expect(WORKERS_QUERY).not.toMatch(/personaPrompt/);
  });
});
