import { describe, expect, it, vi } from 'vitest';
import { assertDisposableStack, withSyntheticConfig, assertActionAtScrollEdges } from './lib/ai-config-browser.mjs';
const expected = { name: 'synthetic', ownerType: 'ORGANIZATION', ownerId: 'org', provider: 'glm', model: 'glm-5' };
const response = (status: number, body: unknown) => ({ status: () => status, ok: () => status === 200, json: async () => body });
function requestFixture({ conflict = false, wrong = false, preexisting = false } = {}) {
  let rows = preexisting ? [{ ...expected, id: 'borrowed' }] : [];
  const deleted: string[] = [];
  const request = {
    get: vi.fn(async () => response(200, { configs: rows })),
    post: vi.fn(async (_: string, { data }: any) => {
      if (data.action === 'delete') { deleted.push(data.id); rows = rows.filter(r => r.id !== data.id); return response(200, { ok: true }); }
      if (conflict) { if (wrong) rows = [{ ...expected, id: 'impostor' }]; return response(409, {}); }
      const config = { ...expected, id: 'owned' }; rows.push(config); return response(200, { ok: true, config });
    }),
  };
  return { request, deleted, rows: () => rows };
}
describe('#1956 disposable stack guard', () => {
  const env = { AI_CONFIG_TEST_STACK: 'unit-stack', AI_CONFIG_TEST_SERVER: '/synthetic/server', AI_CONFIG_TEST_PORTAL: 'http://localhost:15556', AI_CONFIG_TEST_API: 'http://127.0.0.1:14556' };
  const io = () => ({ readFile: vi.fn(async (path: string) => path.endsWith('portal-port') ? '15556\n' : '14556\n'), checkStack: vi.fn(async () => {}) });
  it('requires recorded ports and a successful seed check before browser setup', async () => {
    const deps = io(); await expect(assertDisposableStack(env, deps)).resolves.toEqual({ portal: env.AI_CONFIG_TEST_PORTAL, api: env.AI_CONFIG_TEST_API }); expect(deps.checkStack).toHaveBeenCalledOnce();
  });
  it.each(['https://localhost:15556', 'http://example.test:15556', 'http://localhost:9999', 'http://localhost:15556/path', 'http://u:p@localhost:15556'])('refuses unsuitable target %s before seed check', async portal => {
    const deps = io(); await expect(assertDisposableStack({ ...env, AI_CONFIG_TEST_PORTAL: portal }, deps)).rejects.toThrow(); expect(deps.checkStack).not.toHaveBeenCalled();
  });
  it('does not pass a failed seed check', async () => { const deps = io(); deps.checkStack.mockRejectedValueOnce(new Error('wrong seed')); await expect(assertDisposableStack(env, deps)).rejects.toThrow('wrong seed'); });
});
describe('#1956 fixture ownership', () => {
  it.each([false, true])('removes only its created fixture after probe failure=%s', async fails => {
    const f = requestFixture(); const probe = vi.fn(async () => { if (fails) throw new Error('probe failed'); });
    const run = withSyntheticConfig(f.request, 'http://localhost:15556', expected, probe);
    if (fails) await expect(run).rejects.toThrow('probe failed'); else await run;
    expect(f.deleted).toEqual(['owned']); expect(f.rows()).toEqual([]);
  });
  it('proves a borrowed409 identity and never deletes it, even on failure', async () => {
    const f = requestFixture({ conflict: true, preexisting: true });
    await expect(withSyntheticConfig(f.request, 'http://localhost:15556', expected, async () => { throw new Error('probe failed'); })).rejects.toThrow('probe failed');
    expect(f.deleted).toEqual([]); expect(f.rows()[0].id).toBe('borrowed');
  });
  it.each([false, true])('refuses an unproved409 identity, wrong=%s', async wrong => {
    const f = requestFixture({ conflict: true, wrong, preexisting: wrong }); const probe = vi.fn();
    await expect(withSyntheticConfig(f.request, 'http://localhost:15556', expected, probe)).rejects.toThrow('Conflict'); expect(probe).not.toHaveBeenCalled(); expect(f.deleted).toEqual([]);
  });
});
describe('#1956 scroll-edge oracle', () => {
  function scene(clipped?: string, covered?: string, clippedRight?: string) {
    let edge = '';
    return { seen: [] as string[], page: { locator: () => ({ allTextContents: async () => ['Name', 'Actions'] }), getByTestId: () => ({ evaluate: async (_fn: unknown, value: string) => { edge = value; }, boundingBox: async () => ({ x: 10, width: 200 }) }) }, trigger: { boundingBox: async () => ({ x: edge === clipped ? -20 : edge === clippedRight ? 190 : 20, width: 40 }), evaluate: async () => (edge === covered ? { ok: false, top: 'SPAN.opacity-60' } : { ok: true, top: 'BUTTON' }) }, edge: () => edge };
  }
  it('visits left and right in order', async () => {
    const s = scene(); const edges: string[] = []; const box = s.trigger.boundingBox;
    s.trigger.boundingBox = async () => { edges.push(s.edge()); return box(); };
    await assertActionAtScrollEdges(s.page, s.trigger, 'synthetic'); expect(edges).toEqual(['left', 'right']);
  });
  it.each(['left', 'right'])('rejects clipping at the %s edge', async edge => {
    const s = scene(edge); await expect(assertActionAtScrollEdges(s.page, s.trigger, 'synthetic')).rejects.toThrow(`${edge} edge`);
  });
  // The scroller spans x 10..210 (+1 tolerance): 190 + 40 ends at 230, past the right bound.
  it.each(['left', 'right'])('rejects an Actions trigger clipped past the right bound at the %s edge (#1975)', async edge => {
    const s = scene(undefined, undefined, edge); await expect(assertActionAtScrollEdges(s.page, s.trigger, 'synthetic')).rejects.toThrow(`${edge} edge`);
  });
  // #1996: inside the scroller but covered by a neighbouring cell's content.
  it.each(['left', 'right'])('rejects an Actions trigger another element covers at the %s edge', async edge => {
    const s = scene(undefined, edge); await expect(assertActionAtScrollEdges(s.page, s.trigger, 'synthetic')).rejects.toThrow(`receives the pointer at the ${edge} edge (hit SPAN.opacity-60)`);
  });
});

// #1975: a scripted server, so each guard and each uncertain-create outcome is its own case.
const portal = 'http://localhost:15556';
type Row = { id: string; name: string; ownerType: string; ownerId: string; provider: string; model: string };
function scripted({ rows = [] as Row[], create, keepOnDelete = false, gets }: { rows?: Row[]; create: (rows: Row[]) => unknown; keepOnDelete?: boolean; gets?: (n: number, rows: Row[]) => Row[] }) {
  const deleted: string[] = []; let reads = 0;
  const request = {
    get: vi.fn(async () => response(200, { configs: gets ? gets(reads++, rows) : rows })),
    post: vi.fn(async (_: string, { data }: any) => {
      if (data.action === 'delete') { deleted.push(data.id); if (!keepOnDelete) rows = rows.filter(r => r.id !== data.id); return response(200, { ok: true }); }
      return create(rows);
    }),
  };
  return { request, deleted, rows: () => rows, setRows: (next: Row[]) => { rows = next; } };
}
const row = (id: string, over: Partial<Row> = {}): Row => ({ ...expected, id, ...over });
const landed = (rows: Row[], over: Partial<Row> = {}) => { rows.push(row('owned', over)); };
describe('#1975 surviving-mutant pins on the fixture guards', () => {
  it('fails when the owned fixture is still listed after its delete answered ok', async () => {
    const f = scripted({ keepOnDelete: true, create: rows => { landed(rows); return response(200, { ok: true, config: row('owned') }); } });
    await expect(withSyntheticConfig(f.request, portal, expected, async () => {})).rejects.toThrow('Owned fixture remains after cleanup');
    expect(f.deleted).toEqual(['owned']);
  });
  it.each([['a changed model', (r: Row[]) => { r[0].model = 'other'; }], ['a vanished row', (r: Row[]) => { r.length = 0; }]])('refuses to clean up %s, deleting nothing', async (_, mutate) => {
    const f = scripted({ create: rows => { landed(rows); return response(200, { ok: true, config: row('owned') }); } });
    await expect(withSyntheticConfig(f.request, portal, expected, async () => mutate(f.rows()))).rejects.toThrow('Refusing cleanup of a changed fixture');
    expect(f.deleted).toEqual([]);
  });
  it.each([
    ['two rows before', (n: number) => n === 0 ? [row('b'), row('b2')] : [row('b')]],
    ['no row after', (n: number) => n === 0 ? [row('b')] : []],
    ['two rows after', (n: number) => n === 0 ? [row('b')] : [row('b'), row('b2')]],
    ['a before row that is not the fixture', (n: number) => [row('b', n === 0 ? { model: 'other' } : {})]],
    ['an after row that is not the fixture', (n: number) => [row('b', n === 0 ? {} : { model: 'other' })]],
    ['a different id after', (n: number) => [row(n === 0 ? 'b' : 'c')]],
  ])('refuses a 409 proved only by %s', async (_, read) => {
    const f = scripted({ gets: (n) => read(n), create: () => response(409, {}) }); const probe = vi.fn();
    await expect(withSyntheticConfig(f.request, portal, expected, probe)).rejects.toThrow('Conflict does not prove');
    expect(probe).not.toHaveBeenCalled(); expect(f.deleted).toEqual([]);
  });
  const env = { AI_CONFIG_TEST_STACK: 'unit-stack', AI_CONFIG_TEST_SERVER: '/synthetic/server', AI_CONFIG_TEST_PORTAL: 'http://localhost:15556', AI_CONFIG_TEST_API: 'http://127.0.0.1:14556' };
  const recorded = (portalPort: string, apiPort: string) => ({ readFile: vi.fn(async (path: string) => path.endsWith('portal-port') ? portalPort : apiPort), checkStack: vi.fn(async () => {}) });
  it('refuses the same recorded port for both origins, before the seed check', async () => {
    const deps = recorded('15556\n', '15556\n');
    await expect(assertDisposableStack({ ...env, AI_CONFIG_TEST_API: 'http://127.0.0.1:15556' }, deps)).rejects.toThrow('Origins must match'); expect(deps.checkStack).not.toHaveBeenCalled();
  });
  it.each([['portal', '15557\n', '14556\n'], ['api', '15556\n', '14557\n']])('refuses an origin that disagrees with the recorded %s port', async (_, p, a) => {
    const deps = recorded(p, a); await expect(assertDisposableStack(env, deps)).rejects.toThrow('Origins must match'); expect(deps.checkStack).not.toHaveBeenCalled();
  });
});
describe('#1975 uncertain synthetic creates are reconciled', () => {
  it.each([
    ['a lost response', (rows: Row[]) => { landed(rows); throw new Error('socket hang up'); }, 'socket hang up'],
    ['a mismatched 200 body', (rows: Row[]) => { landed(rows); return response(200, { ok: true, config: row('owned', { model: 'other' }) }); }, 'Created fixture identity mismatch'],
    ['a 500 after the row was committed', (rows: Row[]) => { landed(rows); return response(500, {}); }, 'Synthetic config creation refused'],
  ])('removes the row a create with %s left behind, and still reports the create failure', async (_, create, message) => {
    const f = scripted({ create }); const probe = vi.fn();
    await expect(withSyntheticConfig(f.request, portal, expected, probe)).rejects.toThrow(message);
    expect(probe).not.toHaveBeenCalled(); expect(f.deleted).toEqual(['owned']); expect(f.rows()).toEqual([]);
  });
  it('deletes nothing when the failed create never landed', async () => {
    const f = scripted({ create: () => { throw new Error('connection refused'); } });
    await expect(withSyntheticConfig(f.request, portal, expected, async () => {})).rejects.toThrow('connection refused'); expect(f.deleted).toEqual([]);
  });
  it('never owns a pre-existing row when the create response is lost', async () => {
    const f = scripted({ rows: [row('borrowed')], create: () => { throw new Error('socket hang up'); } });
    await expect(withSyntheticConfig(f.request, portal, expected, async () => {})).rejects.toThrow('socket hang up');
    expect(f.deleted).toEqual([]); expect(f.rows()[0].id).toBe('borrowed');
  });
  it.each([
    ['a row that is not the fixture', (rows: Row[]) => { landed(rows, { model: 'other' }); }],
    ['two rows with the name', (rows: Row[]) => { landed(rows); rows.push(row('second')); }],
  ])('refuses to delete %s after an uncertain create, and reports both failures', async (_, land) => {
    const f = scripted({ create: rows => { land(rows); throw new Error('socket hang up'); } });
    const error: any = await withSyntheticConfig(f.request, portal, expected, async () => {}).catch(e => e);
    expect(f.deleted).toEqual([]); expect(error.message).toContain('socket hang up'); expect(error.message).toContain('cannot prove');
    expect(error.errors).toHaveLength(2);
  });
  it('never reconciles a 409: a row that appears after one is not owned', async () => {
    const f = scripted({ gets: n => n === 0 ? [] : [row('appeared')], create: () => response(409, {}) });
    await expect(withSyntheticConfig(f.request, portal, expected, async () => {})).rejects.toThrow('Conflict does not prove'); expect(f.deleted).toEqual([]);
  });
});
describe('#1975 a cleanup diagnostic never masks the probe failure', () => {
  it('reports both when the probe fails and the cleanup then fails', async () => {
    const f = scripted({ keepOnDelete: true, create: rows => { landed(rows); return response(200, { ok: true, config: row('owned') }); } });
    const error: any = await withSyntheticConfig(f.request, portal, expected, async () => { throw new Error('probe failed'); }).catch(e => e);
    expect(error.message).toContain('probe failed'); expect(error.message).toContain('Owned fixture remains after cleanup');
    expect(error.errors.map((e: Error) => e.message)).toEqual([expect.stringContaining('probe failed'), expect.stringContaining('Owned fixture remains')]);
  });
  it('still reports a cleanup failure alone when the probe passed', async () => {
    const f = scripted({ keepOnDelete: true, create: rows => { landed(rows); return response(200, { ok: true, config: row('owned') }); } });
    await expect(withSyntheticConfig(f.request, portal, expected, async () => {})).rejects.toThrow('Owned fixture remains after cleanup');
  });
  it('keeps the plain probe error when cleanup is clean', async () => {
    const f = scripted({ create: rows => { landed(rows); return response(200, { ok: true, config: row('owned') }); } });
    const error: any = await withSyntheticConfig(f.request, portal, expected, async () => { throw new Error('probe failed'); }).catch(e => e);
    expect(error.message).toBe('probe failed'); expect(error.errors).toBeUndefined();
  });
});
describe('#1975 canonical fixture names', () => {
  it('refuses a name the server would store in another case, before any request', async () => {
    const f = scripted({ create: () => response(200, {}) });
    await expect(withSyntheticConfig(f.request, portal, { ...expected, name: 'Synthetic' }, async () => {})).rejects.toThrow('lower-case');
    expect(f.request.get).not.toHaveBeenCalled(); expect(f.request.post).not.toHaveBeenCalled();
  });
});
