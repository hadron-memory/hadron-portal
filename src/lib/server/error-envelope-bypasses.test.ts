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

const sinks: Array<{ name: string; shape: 'form' | 'action' | 'http' | 'json'; fallback: string; run: () => Promise<unknown> }> = [
  { name: 'memory settings update', shape: 'form', fallback: 'Failed to update', run: async () => {
    const { actions } = await import('../../routes/app/memories/[id]/settings/+page.server');
    return actions.update!(event({ displayName: 'Fixture' }));
  } },
  { name: 'node reorder', shape: 'action', fallback: 'Reorder failed', run: async () => {
    request.mockResolvedValueOnce({ node: { id: 'fixture-anchor', memoryId: 'fixture-memory' } });
    request.mockResolvedValueOnce({ node: { id: 'fixture-sibling', memoryId: 'fixture-memory', loc: 'fixture', tags: [] } });
    const { actions } = await import('../../routes/app/memories/[id]/nodes/[nodeId]/+page.server');
    return actions.reorder!(event({ updates: JSON.stringify([{ loc: 'fixture', seq: 1 }]) }));
  } },
  { name: 'invitation acceptance', shape: 'form', fallback: 'Failed to accept invitation', run: async () => {
    const { actions } = await import('../../routes/invite/[token]/+page.server');
    return actions.accept!(event({ _kind: 'acceptInvitation' }));
  } },
  { name: 'organization creation', shape: 'form', fallback: 'Failed to create organization', run: async () => {
    const { actions } = await import('../../routes/app/orgs/new/+page.server');
    return actions.default!(event({ name: 'Fixture', urn: 'fixture.example' }));
  } },
  { name: 'conversation position', shape: 'action', fallback: 'Failed to save position', run: async () => {
    const { actions } = await import('../../routes/app/agents/[id]/conversations/+page.server');
    return actions.savePosition!(event({ systemMemoryId: 'fixture-memory', loc: 'fixture', x: '1', y: '2' }));
  } },
  { name: 'conversation edge deletion', shape: 'action', fallback: 'Failed to delete edge', run: async () => {
    const { actions } = await import('../../routes/app/agents/[id]/conversations/+page.server');
    return actions.deleteEdge!(event({ edgeId: 'fixture-edge' }));
  } },
  { name: 'GitHub installation callback', shape: 'http', fallback: 'Failed to link GitHub App installation', run: async () => {
    const { load } = await import('../../routes/app/github/install/callback/+page.server');
    try { return await load!({ url: new URL('http://localhost/callback?installation_id=123&state=fixture-org'), locals: { token: 'fixture' } } as never); }
    catch (error) { return error; }
  } },
  { name: 'URN resolution JSON', shape: 'json', fallback: 'resolve failed', run: async () => {
    const { GET } = await import('../../routes/app/u/resolve/+server');
    const response = await GET({ url: new URL('http://localhost/app/u/resolve?urn=hrn:org:fixture.example'), locals: { token: 'fixture' } } as never);
    return { status: response.status, body: await response.json() };
  } },
];

for (const { name, shape, fallback, run } of sinks) {
  it.each(['INTERNAL_SERVER_ERROR', 'UNKNOWN_FAULT', null])(`${name} suppresses %s payload text`, async (code) => {
    request.mockRejectedValue(fault(code));
    const result = await run();
    if (name === 'node reorder') {
      expect(request).toHaveBeenCalledTimes(3);
      expect(request.mock.calls[1][1]).toEqual({ ref: 'fixture', memoryRef: 'fixture-memory' });
      expect(request.mock.calls[2][0]).toContain('mutation UpdateNode');
      expect(request.mock.calls[2][1]).toEqual({ input: { memoryId: 'fixture-memory', loc: 'fixture', tags: [], seq: 1 } });
    } else expect(request).toHaveBeenCalledTimes(1);
    const safeText = code === 'INTERNAL_SERVER_ERROR'
      ? `Something went wrong on our side. Request ID: ${requestId}`
      : code === 'UNKNOWN_FAULT' ? 'Something went wrong on our side.' : fallback;
    if (shape === 'form') expect(result).toMatchObject({ status: 500, data: { form: { message: { type: 'error', text: safeText } } } });
    if (shape === 'action') expect(result).toEqual(expect.objectContaining({ status: 500, data: { error: safeText } }));
    if (shape === 'http') expect(result).toMatchObject({ status: 500, body: code === 'INTERNAL_SERVER_ERROR'
      ? { message: 'Something went wrong on our side.', requestId }
      : { message: safeText } });
    if (shape === 'json') expect(result).toEqual({ status: 500, body: { code: 'INTERNAL', message: safeText } });
    const text = JSON.stringify(result);
    for (const secret of ['SELECT private', '/srv/private.ts', 'PrivateOperation', 'synthetic-variable-secret', 'synthetic response body']) {
      expect(text).not.toContain(secret);
    }
    if (code === 'INTERNAL_SERVER_ERROR') expect(text).toContain(requestId);
    else expect(text).not.toContain(requestId);
  });
}

// These paths intentionally preserve genuine transport and known-refusal text.
it.each(['BAD_USER_INPUT', 'plain transport'])('GitHub callback preserves %s without internal metadata', async (kind) => {
  request.mockRejectedValue(kind === 'plain transport' ? new Error('network unavailable') : new ClientError({
    status: 400, headers: new Headers(), body: 'synthetic refusal response', errors: [new GraphQLError('intentional refusal', { extensions: { code: kind } })],
  }, { query: 'query Fixture { fixture }' }));
  const result = await sinks.find((sink) => sink.shape === 'http')!.run();
  expect(result).toMatchObject({ status: 500, body: { message: kind === 'plain transport' ? 'network unavailable' : 'intentional refusal' } });
  expect((result as { body: object }).body).not.toHaveProperty('requestId');
});

it('URN JSON suppresses non-Error thrown text while retaining its 500/code contract', async () => {
  request.mockRejectedValue('SELECT private FROM /srv/private.ts');
  expect(await sinks.find((sink) => sink.shape === 'json')!.run()).toEqual({
    status: 500, body: { code: 'INTERNAL', message: 'resolve failed' },
  });
});
