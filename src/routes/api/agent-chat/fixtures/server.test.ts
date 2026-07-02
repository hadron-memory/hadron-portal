/**
 * Spec 019 T024 — /api/agent-chat/fixtures endpoint tests.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MY_ORGANIZATIONS_QUERY,
  CREATE_NODE_MUTATION,
  UPDATE_NODE_MUTATION,
  DELETE_NODE_MUTATION,
  GRAPH_NODES_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importHandlers() {
  return await import('./+server');
}

function ev(opts: { url?: string; method?: string; body?: unknown; token?: string | null }) {
  const url = new URL(opts.url ?? 'http://test/api/agent-chat/fixtures');
  const init: RequestInit = { method: opts.method ?? 'GET' };
  if (opts.body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' };
    init.body = JSON.stringify(opts.body);
  }
  return {
    url,
    request: new Request(url, init),
    locals: { token: opts.token === undefined ? 'test-token' : opts.token },
  } as unknown as Parameters<Awaited<ReturnType<typeof importHandlers>>['GET']>[0];
}

// Common fixture: a one-org user with one agent that has a system memory.
function mockResolveAgent() {
  mockRequest.mockImplementation(async (query: string, vars?: unknown) => {
    if (query === MY_ORGANIZATIONS_QUERY) {
      return {
        myOrganizations: [
          { id: 'org-a', name: 'A', urn: 'u', agents: [
            { id: 'agent-aaa', organizationId: 'org-a', systemMemoryId: 'sys-mem-a' },
          ] },
        ],
      };
    }
    if (query === GRAPH_NODES_QUERY) {
      return { findNodes: { hits: [
        // Fixture in our agent's memory
        { node: {
          id: 'node-1', loc: 'fixtures:abc', memoryId: 'sys-mem-a',
          data: {
            version: 1, label: 'one',
            turns: [{ user: 'hi', persona: null, assertion: null,
              capturedReply: 'Hi!', capturedRoute: null, capturedVerdict: 'pass', capturedAt: '2026-05-14T00:00:00.000Z' }],
            createdAt: '2026-05-14T00:00:00.000Z', updatedAt: '2026-05-14T00:00:00.000Z',
          },
        } },
        // Fixture in a DIFFERENT memory — must be filtered out
        { node: {
          id: 'node-other', loc: 'fixtures:other', memoryId: 'sys-mem-other',
          data: { version: 1, label: 'other-org', turns: [{ user: 'x', persona: null, assertion: null,
            capturedReply: null, capturedRoute: null, capturedVerdict: null, capturedAt: null }],
            createdAt: 'x', updatedAt: 'x' },
        } },
        // Non-fixture node in our memory — must be filtered out
        { node: {
          id: 'node-conv', loc: 'conversations:setup', memoryId: 'sys-mem-a',
          data: {},
        } },
      ] } };
    }
    if (query === CREATE_NODE_MUTATION) {
      return { createNode: { id: 'node-new', loc: (vars as { input: { loc: string } }).input.loc } };
    }
    if (query === UPDATE_NODE_MUTATION) {
      return { updateNode: { id: 'node-upd', loc: (vars as { input: { loc: string } }).input.loc } };
    }
    if (query === DELETE_NODE_MUTATION) {
      return { deleteNode: true };
    }
    throw new Error(`Unexpected query: ${query.slice(0, 40)}`);
  });
}

// ─── GET ────────────────────────────────────────────────────────────────────

describe('GET /api/agent-chat/fixtures', () => {
  it('401 without token', async () => {
    const { GET } = await importHandlers();
    const res = await GET(ev({ method: 'GET', token: null, url: 'http://test/api/agent-chat/fixtures?agentId=a' }));
    expect(res.status).toBe(401);
  });

  it('400 without agentId', async () => {
    const { GET } = await importHandlers();
    const res = await GET(ev({ method: 'GET' }));
    expect(res.status).toBe(400);
  });

  it('404 (no leak) when agent is not in the caller\'s orgs', async () => {
    mockRequest.mockImplementation(async (query: string) => {
      if (query === MY_ORGANIZATIONS_QUERY) return { myOrganizations: [] };
      throw new Error('unexpected');
    });
    const { GET } = await importHandlers();
    const res = await GET(ev({ method: 'GET', url: 'http://test/api/agent-chat/fixtures?agentId=agent-aaa' }));
    expect(res.status).toBe(404);
    // No fixture data in the body
    const body = await res.text();
    expect(body).not.toContain('fixtures:');
  });

  it('lists only fixtures from the agent\'s system memory (filters other memories + non-fixture locs)', async () => {
    mockResolveAgent();
    const { GET } = await importHandlers();
    const res = await GET(ev({ method: 'GET', url: 'http://test/api/agent-chat/fixtures?agentId=agent-aaa' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixtures).toHaveLength(1);
    expect(body.fixtures[0].label).toBe('one');
    expect(body.fixtures[0].assertionMode).toBeNull();
  });
});

// ─── POST ───────────────────────────────────────────────────────────────────

describe('POST /api/agent-chat/fixtures', () => {
  it('creates a new fixture (no fixtureLoc supplied → minted)', async () => {
    mockResolveAgent();
    const { POST } = await importHandlers();
    const res = await POST(ev({
      method: 'POST',
      body: {
        agentId: 'agent-aaa',
        label: 'new-one',
        turn: { user: 'hello', persona: null, assertion: null },
      },
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.fixtureLoc).toMatch(/^fixtures:[0-9a-f]+$/);
  });

  it('400 on FixtureValidationError (e.g. malformed regex)', async () => {
    mockResolveAgent();
    const { POST } = await importHandlers();
    const res = await POST(ev({
      method: 'POST',
      body: {
        agentId: 'agent-aaa',
        label: 'l',
        turn: { user: 'x', persona: null, assertion: { mode: 'regex', pattern: '(unclosed', flags: '' } },
      },
    }));
    expect(res.status).toBe(400);
  });
});

// ─── DELETE ─────────────────────────────────────────────────────────────────

describe('DELETE /api/agent-chat/fixtures', () => {
  it('204 on successful soft-delete', async () => {
    mockResolveAgent();
    const { DELETE } = await importHandlers();
    const res = await DELETE(ev({
      method: 'DELETE',
      url: 'http://test/api/agent-chat/fixtures?agentId=agent-aaa&fixtureLoc=fixtures:abc',
    }));
    expect(res.status).toBe(204);
  });

  it('400 when fixtureLoc does not start with "fixtures:"', async () => {
    mockResolveAgent();
    const { DELETE } = await importHandlers();
    const res = await DELETE(ev({
      method: 'DELETE',
      url: 'http://test/api/agent-chat/fixtures?agentId=agent-aaa&fixtureLoc=conversations:setup',
    }));
    expect(res.status).toBe(400);
  });
});
