import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { grantsFixture, fixtureGrant } from './grants.fixture';
import { setStubPage, resetStubPage } from '$lib/test/stubs/app-stores';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/signing-capability', () => ({ deploymentOffersSigning: async () => true }));
const definition = {
  name: 'future.fifth',
  parameters: [
    { name: 'differentNode', type: 'node-ref', refusesWildcard: true },
    { name: 'secondNode', type: 'node-ref', refusesWildcard: false },
  ],
};
let catalogue: typeof definition[] | null;
let catalogueError: Error | null;
let listGrants: typeof fixtureGrant[];
beforeEach(() => {
  catalogue = [definition];
  catalogueError = null;
  listGrants = [];
  request.mockReset();
  request.mockImplementation(async (q: string) => {
    if (q.includes('query AppGrantsApp')) return { app: grantsFixture().app };
    if (q.includes('query AppGrantActions')) {
      if (catalogueError) throw catalogueError;
      return { grantActions: catalogue && { items: catalogue, total: catalogue.length } };
    }
    if (q.includes('query AppGrantsPage')) return { appGrants: { items: listGrants, total: listGrants.length } };
    if (q.includes('query GrantHolderWorker')) return { worker: grantsFixture().choices.workers[0] };
    if (q.includes('query AppGrantWorkers')) return { teamRoster: { workers: [{ worker: { id: 'worker-example', name: 'Builder' } }] } };
    if (q.includes('query AppInstalledAgents')) return { app: { appAgents: [] } };
    if (q.includes('query Memories')) return { memories: { items: [], total: 0 } };
    if (q.includes('mutation CreateAppGrant')) return { createGrant: fixtureGrant };
    throw Error('Unexpected query: ' + q);
  });
  setStubPage('http://localhost/app/apps/app-example/grants', { appId: 'app-example' });
});
afterEach(resetStubPage);
function draw(actionDefinitions: unknown) {
  return render(Page, { props: { data: { ...grantsFixture(), actionDefinitions: actionDefinitions ?? [] } } as never }).body;
}
function event(body: Record<string, string> = {}) {
  return {
    params: { appId: 'app-example' }, locals: { token: 'synthetic', user: { id: 'person-example' } },
    url: new URL('http://localhost/app/apps/app-example/grants'),
    request: new Request('http://localhost', { method: 'POST', body: new URLSearchParams(body) }),
  };
}
it('offers exactly the served names and one picker for each declared parameter', () => {
  const html = draw([definition]);
  expect(html).toContain('future.fifth');
  expect(html).not.toContain('value="schedule.create"');
  expect(html).toContain('differentNode');
  expect(html).toContain('secondNode');
  expect(html.match(/name="parameter:/g)).toHaveLength(2);
});
it.each([[], null])('empty and refused/null definitions have the same no-actions state (%j)', (defs) => {
  const html = draw(defs);
  expect(html).toContain('No actions you can grant here.');
  expect(html).not.toContain('?/create');
});
it('does not guess a field or submit for an unknown parameter type', () => {
  const html = draw([{ ...definition, parameters: [{ name: 'futureValue', type: 'future-type' }] }]);
  expect(html).toContain('cannot be granted here');
  expect(html).not.toContain('name="parameter:futureValue"');
  expect(html).not.toContain('>Create</button>');
});
it.each([[], null])('does not fall back when the server action read is empty/null (%j)', async (defs) => {
  catalogue = defs;
  const { load, actions } = await import('./+page.server');
  expect((await load(event() as never) as any).actionDefinitions).toEqual([]);
  const result = await actions.create!(event({ holder: 'WORKER:worker-example', action: 'schedule.create',
    'parameter:entryNode': 'node-a', reason: 'Testing' }) as never) as any;
  expect(result.status).toBe(400);
  expect(request.mock.calls.some(([q]) => q.includes('mutation CreateAppGrant'))).toBe(false);
});
it('rejects an unsupported definition on POST too', async () => {
  catalogue = [{ ...definition, parameters: [{ name: 'unknown', type: 'new-type', refusesWildcard: false }] }];
  const { actions } = await import('./+page.server');
  expect((await actions.create!(event({ holder: 'WORKER:worker-example', action: definition.name,
    'parameter:unknown': 'guessed', reason: 'Testing' }) as never) as any).status).toBe(400);
  expect(request.mock.calls.some(([q]) => q.includes('mutation CreateAppGrant'))).toBe(false);
});
it('reads the catalogue afresh per form load with the named App', async () => {
  const { load } = await import('./+page.server');
  for (let i = 0; i < 2; i++) expect((await load(event() as never) as any).actionDefinitions).toEqual([definition]);
  const reads = request.mock.calls.filter(([q]) => q.includes('query AppGrantActions'));
  expect(reads).toHaveLength(2);
  expect(reads[0][1]).toMatchObject({ appRef: 'app-example' });
});
it('keeps grants and exact raw values visible during a catalogue outage, but refuses create', async () => {
  catalogueError = Error('Synthetic catalogue outage');
  listGrants = [fixtureGrant];
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const { load, actions } = await import('./+page.server');
    const data = await load(event() as never) as any;
    expect(data.grants.items).toEqual([fixtureGrant]);
    expect(data.actionDefinitionsFailed).toBe(true);
    const html = render(Page, { props: { data } as never }).body;
    expect(html).toContain('node-example');
    expect(html).toContain('Actions could not be loaded. Refresh before creating a grant.');
    expect(html).not.toContain('No actions you can grant here.');
    expect(html).not.toContain('?/create');
    const result = await actions.create!(event({ holder: 'WORKER:worker-example', action: definition.name,
      'parameter:differentNode': 'node-a', 'parameter:secondNode': 'node-b', reason: 'Testing' }) as never) as any;
    expect(result.status).toBe(400);
    expect(request.mock.calls.some(([q]) => q.includes('mutation CreateAppGrant'))).toBe(false);
    expect(warn).toHaveBeenCalledWith('[app-grants] action catalogue unavailable');
  } finally { warn.mockRestore(); }
});
it('submits stored node ids under every server-declared name, without a legacy table', async () => {
  const { actions } = await import('./+page.server');
  const result = await actions.create!(event({ holder: 'WORKER:worker-example', action: definition.name,
    'parameter:differentNode': 'node-a', 'parameter:secondNode': 'node-b', reason: 'Testing' }) as never) as any;
  expect(result.grant).toEqual(fixtureGrant);
  const write = request.mock.calls.find(([q]) => q.includes('mutation CreateAppGrant'))!;
  expect(write[1].input.values).toEqual({ differentNode: 'node-a', secondNode: 'node-b' });
});
it.each(['hrn:node:example.test:memory:node', '*', 'one,two'])('refuses non-scalar-id node values before writing (%s)', async (value) => {
  const { actions } = await import('./+page.server');
  const result = await actions.create!(event({ holder: 'WORKER:worker-example', action: definition.name,
    'parameter:differentNode': value, 'parameter:secondNode': 'node-b', reason: 'Testing' }) as never) as any;
  expect(result.status).toBe(400);
  expect(request.mock.calls.some(([q]) => q.includes('mutation CreateAppGrant'))).toBe(false);
});
it('offers no form and submits nothing for a definition declaring one parameter name twice', async () => {
  const dup = { ...definition, parameters: [
    { name: 'sameNode', type: 'node-ref', refusesWildcard: true },
    { name: 'sameNode', type: 'node-ref', refusesWildcard: false },
  ] };
  const html = draw([dup]);
  expect(html).toContain('cannot be granted here');
  expect(html).not.toContain('name="parameter:sameNode"');
  expect(html).not.toContain('>Create</button>');
  catalogue = [dup];
  const { actions } = await import('./+page.server');
  expect((await actions.create!(event({ holder: 'WORKER:worker-example', action: dup.name,
    'parameter:sameNode': 'node-a', reason: 'Testing' }) as never) as any).status).toBe(400);
  expect(request.mock.calls.some(([q]) => q.includes('mutation CreateAppGrant'))).toBe(false);
});
it('submits an empty values object for a declared action with no parameters', async () => {
  const none = { name: 'future.none', parameters: [] as typeof definition.parameters };
  catalogue = [none as never];
  const { actions } = await import('./+page.server');
  const result = await actions.create!(event({ holder: 'WORKER:worker-example', action: none.name,
    reason: 'Testing' }) as never) as any;
  expect(result.grant).toEqual(fixtureGrant);
  const write = request.mock.calls.find(([q]) => q.includes('mutation CreateAppGrant'))!;
  expect(write[1].input.values).toEqual({});
});
