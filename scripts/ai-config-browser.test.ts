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
  function scene(clipped?: string) {
    let edge = '';
    return { seen: [] as string[], page: { locator: () => ({ allTextContents: async () => ['Name', 'Actions'] }), getByTestId: () => ({ evaluate: async (_fn: unknown, value: string) => { edge = value; }, boundingBox: async () => ({ x: 10, width: 200 }) }) }, trigger: { boundingBox: async () => ({ x: edge === clipped ? -20 : 20, width: 40 }) }, edge: () => edge };
  }
  it('visits left and right in order', async () => {
    const s = scene(); const edges: string[] = []; const box = s.trigger.boundingBox;
    s.trigger.boundingBox = async () => { edges.push(s.edge()); return box(); };
    await assertActionAtScrollEdges(s.page, s.trigger, 'synthetic'); expect(edges).toEqual(['left', 'right']);
  });
  it.each(['left', 'right'])('rejects clipping at the %s edge', async edge => {
    const s = scene(edge); await expect(assertActionAtScrollEdges(s.page, s.trigger, 'synthetic')).rejects.toThrow(`${edge} edge`);
  });
});
