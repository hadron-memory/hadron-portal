/**
 * portal#2683 (hadron-server#5394, hrn:node:hadronmemory.com:specs:cor:cht:010:02): a start runs under the App it
 * names, and the server never searches for one. The four routes that call startChat with a person's token send
 * `appRef`, refuse a request that names no App before any start is sent, and show one fixed message when the server
 * refuses with CHAT_APP_NOT_IDENTIFIED. The exact `appRef` on each start is also pinned in that route's own test.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_APPS_QUERY, AGENT_OWNED_APPS_QUERY, START_CHAT_MUTATION } from '$lib/server/queries';
import { __resetRateLimit } from '$lib/server/rate-limit';
import { asTesterManager } from '$lib/test/tester-manage';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: (q: string, v?: unknown) => asTesterManager(mockRequest, { visibleAgentIds: ['agent-1'] })(q, v) }) }));

const REFUSAL = 'raw server prose that must not reach the user';
const refused = Object.assign(new Error(REFUSAL), { response: { errors: [{ message: REFUSAL, extensions: { code: 'CHAT_APP_NOT_IDENTIFIED' } }] } });

function ev(body: unknown) {
  return {
    request: new Request('http://test/api', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    locals: { token: 'test-token', user: { id: 'u1' } },
  } as never;
}

const ROUTES: Array<{ name: string; body: Record<string, unknown>; call: (body: unknown) => Promise<Response> }> = [
  { name: 'start', body: { agentId: 'agent-1' }, call: async (b) => (await import('./start/+server')).POST(ev(b)) },
  { name: 'test-run', body: { agentId: 'agent-1', message: 'hi' }, call: async (b) => (await import('./test-run/+server')).POST(ev(b)) },
  { name: 'test-persona', body: { agentId: 'agent-1', personaName: 'P', openingMessage: 'hello' }, call: async (b) => (await import('./test-persona/+server')).POST(ev(b)) },
  { name: 'fixtures/run', body: { agentId: 'agent-1' }, call: async (b) => (await import('./fixtures/run/+server')).POST(ev(b)) },
];

const startCalls = () => mockRequest.mock.calls.filter((c) => c[0] === START_CHAT_MUTATION);

beforeEach(() => {
  mockRequest.mockReset();
  mockRequest.mockResolvedValue({});
  __resetRateLimit();
});

describe.each(ROUTES)('portal#2683 $name', ({ body, call, name }) => {
  it.each([
    ['no appId', undefined],
    ['an empty appId', ''],
    ['a blank appId', '   '],
    ['a non-string appId', 42],
  ])('refuses %s before anything is sent', async (_label, appId) => {
    const res = await call({ ...body, appId });
    expect(res.status).toBe(400);
    const out = await res.json();
    expect(out.code).toBe('appRequired');
    expect(out.error).toMatch(/App/);
    expect(out.message).toBeUndefined();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not report a start as a success when the server refuses CHAT_APP_NOT_IDENTIFIED', async () => {
    // fixtures/run starts only for stored fixtures, so its refusal is asserted with fixtures in fixtures/run/server.test.ts.
    if (name === 'fixtures/run') return;
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === START_CHAT_MUTATION) throw refused;
      return {};
    });
    const res = await call({ ...body, appId: 'app-1' });
    expect(res.status).toBeGreaterThanOrEqual(400);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(REFUSAL);
    expect(text).toMatch(/App/);
    expect(startCalls().length).toBeLessThanOrEqual(1);
  });
});

describe('portal#2683 the document', () => {
  // The route tests replace the transport, so a variable the document never declares passes them and is dropped on
  // the wire. These pin the document itself.
  it('declares $appRef as an ID and passes it to startChat', () => {
    expect(START_CHAT_MUTATION).toMatch(/\$appRef: ID\b/);
    expect(START_CHAT_MUTATION).toMatch(/\bappRef: \$appRef\b/);
    expect(START_CHAT_MUTATION).not.toMatch(/\$appRef: ID!/);
  });
});

describe('portal#2683 the Tester\'s Apps reads', () => {
  // Same trap as the mutation: page.server.test.ts only sees that `agentId` was passed, not that the document uses it.
  it.each([['AGENT_APPS_QUERY', AGENT_APPS_QUERY], ['AGENT_OWNED_APPS_QUERY', AGENT_OWNED_APPS_QUERY]])(
    '%s declares $agentId and filters the install on it',
    (_name, doc) => {
      expect(doc).toMatch(/\$agentId: ID\b/);
      expect(doc).toMatch(/agentRef: \$agentId\b/);
    },
  );
});

describe('portal#2683 start', () => {
  it('sends the trimmed App as appRef', async () => {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === START_CHAT_MUTATION) throw refused; // stop after the start; only its variables matter
      return {};
    });
    await ROUTES[0].call({ agentId: 'agent-1', appId: '  app-1  ' });
    expect(startCalls()[0][1]).toMatchObject({ agentRef: 'agent-1', appRef: 'app-1' });
  });

  it('maps CHAT_APP_NOT_IDENTIFIED to the fixed message with the code, status 409', async () => {
    mockRequest.mockImplementation(async (doc: string) => {
      if (doc === START_CHAT_MUTATION) throw refused;
      return {};
    });
    const res = await ROUTES[0].call({ agentId: 'agent-1', appId: 'app-1' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "This chat can't start because it isn't tied to an App. Open it from an App that installs this Agent and try again.",
      code: 'appNotIdentified',
    });
  });
});
