import { beforeEach, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';

const request = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request }) }));
vi.mock('$lib/server/emailLogin', () => ({ emailLoginErrorStatus: vi.fn(), startBoundMagicLink: vi.fn() }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn() }));

const requestId = 'a4451409-72f6-4f08-b90b-f8db328e8c58';
function fault(code: string | null) {
  return new ClientError({
    status: 500, headers: new Headers(), body: 'synthetic response body',
    ...(code ? { errors: [new GraphQLError('SELECT private FROM /srv/private.ts', { extensions: { code, requestId } })] } : {}),
  }, { query: 'mutation PrivateOperation { fixture }', variables: { token: 'synthetic-variable-secret' } });
}
function event(fields: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return { params: { id: 'fixture-memory', nodeId: 'fixture-anchor', token: 'fixture-invite' },
    locals: { token: 'fixture-token', user: { id: 'fixture-user' } },
    request: { formData: async () => fd } } as never;
}
beforeEach(() => { request.mockReset(); });

const sinks: Array<{ name: string; run: () => Promise<unknown> }> = [
  { name: 'memory settings update', run: async () => {
    const { actions } = await import('../../routes/app/memories/[id]/settings/+page.server');
    return actions.update!(event({ displayName: 'Fixture' }));
  } },
  { name: 'node reorder', run: async () => {
    request.mockResolvedValueOnce({ node: { id: 'fixture-anchor', memoryId: 'fixture-memory' } });
    const { actions } = await import('../../routes/app/memories/[id]/nodes/[nodeId]/+page.server');
    return actions.reorder!(event({ updates: JSON.stringify([{ loc: 'fixture', seq: 1 }]) }));
  } },
  { name: 'invitation acceptance', run: async () => {
    const { actions } = await import('../../routes/invite/[token]/+page.server');
    return actions.accept!(event({ _kind: 'acceptInvitation' }));
  } },
  { name: 'organization creation', run: async () => {
    const { actions } = await import('../../routes/app/orgs/new/+page.server');
    return actions.default!(event({ name: 'Fixture', urn: 'fixture.example' }));
  } },
  { name: 'conversation position', run: async () => {
    const { actions } = await import('../../routes/app/agents/[id]/conversations/+page.server');
    return actions.savePosition!(event({ systemMemoryId: 'fixture-memory', loc: 'fixture', x: '1', y: '2' }));
  } },
  { name: 'conversation edge deletion', run: async () => {
    const { actions } = await import('../../routes/app/agents/[id]/conversations/+page.server');
    return actions.deleteEdge!(event({ edgeId: 'fixture-edge' }));
  } },
  { name: 'GitHub installation callback', run: async () => {
    const { load } = await import('../../routes/app/github/install/callback/+page.server');
    try { return await load!({ url: new URL('http://localhost/callback?installation_id=123&state=fixture-org'), locals: { token: 'fixture' } } as never); }
    catch (error) { return error; }
  } },
  { name: 'URN resolution JSON', run: async () => {
    const { GET } = await import('../../routes/app/u/resolve/+server');
    const response = await GET({ url: new URL('http://localhost/app/u/resolve?urn=hrn:org:fixture.example'), locals: { token: 'fixture' } } as never);
    return { status: response.status, body: await response.json() };
  } },
];

for (const { name, run } of sinks) {
  it.each(['INTERNAL_SERVER_ERROR', 'UNKNOWN_FAULT', null])(`${name} suppresses %s payload text`, async (code) => {
    request.mockRejectedValue(fault(code));
    const result = await run();
    expect(request).toHaveBeenCalled();
    expect(result).toMatchObject({ status: 500 });
    const text = JSON.stringify(result);
    for (const secret of ['SELECT private', '/srv/private.ts', 'PrivateOperation', 'synthetic-variable-secret', 'synthetic response body']) {
      expect(text).not.toContain(secret);
    }
    if (code === 'INTERNAL_SERVER_ERROR') expect(text).toContain(requestId);
    else expect(text).not.toContain(requestId);
  });
}
