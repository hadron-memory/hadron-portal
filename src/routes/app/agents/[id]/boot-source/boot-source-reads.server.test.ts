import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GET as resolved } from './resolved/+server';
import { GET as lint } from './lint/+server';
import { AGENT_BOOT_START_QUERY, BOOT_RESOLVED_SOURCE_QUERY, BOOT_SOURCE_LINT_QUERY, BOOT_SOURCE_QUERY } from '$lib/server/queries';

const request = vi.fn();
const gqlClient = vi.fn((_token: unknown) => ({ request }));
vi.mock('$lib/server/api', () => ({ gqlClient: (...args: unknown[]) => gqlClient(args[0]) }));

const AGENT = { agent: { id: 'a', systemMemoryId: 'sys', bootPromptRef: null, bootPromptTargetDeleted: false } };
const answer = (node: unknown) => (query: string) => (query === AGENT_BOOT_START_QUERY ? AGENT : { node });
const PAGE = { items: [{ kind: 'BROKEN_INCLUDE', position: 8, targetUrn: null, pinnedRevision: null, newerRevision: null }], total: 1, nextCursor: null };
const event = (over: { token?: string | null; search?: string } = {}) => ({
  locals: { token: over.token === undefined ? 'viewer' : over.token },
  params: { id: 'agent-7' },
  url: new URL(`http://localhost/x${over.search ?? ''}`),
}) as never;
const forbidden = () => new ClientError({ status: 200, errors: [{ message: 'hrn:node:secret:target', extensions: { code: 'FORBIDDEN' } }] } as never, { query: '' });

beforeEach(() => { request.mockReset(); gqlClient.mockClear(); });

describe('the two queries (portal#1667)', () => {
  it('resolves through raw: false, and keeps the source read that feeds the editor raw', () => {
    expect(BOOT_RESOLVED_SOURCE_QUERY).toContain('raw: false');
    expect(BOOT_SOURCE_QUERY).toContain('raw: true');
  });
  it('keeps lint out of the source read, and never selects the server sentence that names targets', () => {
    expect(BOOT_SOURCE_QUERY).not.toContain('lintWarnings');
    expect(BOOT_SOURCE_LINT_QUERY).toContain('lintWarnings(first: 50, after: $after)');
    expect(BOOT_SOURCE_LINT_QUERY).not.toMatch(/\btext\b/);
  });
});

describe.each([['resolved', resolved], ['lint', lint]] as const)('%s endpoint', (_name, GET) => {
  it('refuses a request with no token and reads nothing', async () => {
    expect((await GET(event({ token: null }))).status).toBe(401);
    expect(gqlClient).not.toHaveBeenCalled();
  });
  it('reads with the viewer token, and the node comes from the Agent, never the request', async () => {
    request.mockImplementation(answer({ id: 'n', revision: 3, content: 'x', lintWarnings: PAGE }));
    const res = await GET(event({ search: '?ref=other-node&memoryRef=other&id=other' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(gqlClient).toHaveBeenCalledWith('viewer');
    expect(request.mock.calls[0]).toEqual([AGENT_BOOT_START_QUERY, { ref: 'agent-7' }]);
    expect(request.mock.calls[1][1]).toMatchObject({ ref: 'boot:source', memoryRef: 'sys' });
  });
  it('a refused read is a failure that carries nothing of the refusal', async () => {
    request.mockImplementation((query: string) => { if (query === AGENT_BOOT_START_QUERY) return AGENT; throw forbidden(); });
    const res = await GET(event());
    expect(res.status).toBe(502);
    expect(await res.text()).not.toContain('secret');
  });
  it('an Agent with no system memory or no source is not a success', async () => {
    request.mockResolvedValue({ agent: { systemMemoryId: null } });
    expect((await GET(event())).status).toBe(404);
    request.mockReset();
    request.mockImplementation(answer(null));
    expect((await GET(event())).status).toBe(404);
  });
});

describe('resolved endpoint', () => {
  it('answers with the revision and text the server returned, its notice untouched', async () => {
    request.mockImplementation(answer({ id: 'n', revision: 5, content: 'a [Include unavailable] b' }));
    expect(await (await resolved(event())).json()).toEqual({ node: { id: 'n', revision: 5, content: 'a [Include unavailable] b' } });
  });
});

describe('lint endpoint', () => {
  it('passes the cursor through and returns the page', async () => {
    request.mockImplementation(answer({ id: 'n', revision: 5, lintWarnings: PAGE }));
    const res = await lint(event({ search: '?after=opaque%2B%2F%3D' }));
    expect(request.mock.calls[1]).toEqual([BOOT_SOURCE_LINT_QUERY, { ref: 'boot:source', memoryRef: 'sys', after: 'opaque+/=' }]);
    expect(await res.json()).toEqual({ id: 'n', revision: 5, page: PAGE });
  });
  it('keeps a null page null: unavailable is not an empty list', async () => {
    request.mockImplementation(answer({ id: 'n', revision: 5, lintWarnings: null }));
    expect(await (await lint(event())).json()).toEqual({ id: 'n', revision: 5, page: null });
  });
});
