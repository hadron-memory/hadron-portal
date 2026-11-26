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
/** A typed refusal with intentional server copy (#1397 known-refusal
 *  controls): the message IS the product text a known list opts into, while
 *  the carrier's response body, query and variables never are. It carries the
 *  same requestId extension the internal fault does, so the sweep below
 *  guards an id leak that could actually happen — without it, the
 *  not.toContain(requestId) assertion pins nothing. */
function refusal(code: string, message: string) {
  return new ClientError({
    status: 500, headers: new Headers(), body: 'synthetic refusal body',
    errors: [new GraphQLError(message, { extensions: { code, requestId } })],
  }, { query: 'mutation PrivateOperation { fixture }', variables: { token: 'synthetic-variable-secret' } });
}
function event(fields: Record<string, string> = {}, params: Record<string, string> = { id: 'fixture-memory', nodeId: 'fixture-anchor', token: 'fixture-invite' }) {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return { params,
    locals: { token: 'fixture-token', user: { id: 'fixture-user' } },
    request: { formData: async () => fd } } as never;
}
beforeEach(() => { request.mockReset(); });

/** One request the sink is expected to make: what its GraphQL document must
 *  contain and the variables it must deep-match, when the call is asserted.
 *  Metadata, not a name-string branch — a sink's call shape lives beside its
 *  run(), so adding a sink with reads cannot quietly de-synchronize the two
 *  (#1397: replaces the old `if (name === 'node reorder')` special case). */
interface ExpectedCall {
  documentContains?: string;
  variables?: unknown;
}
interface Sink {
  name: string;
  shape: 'form' | 'action' | 'http' | 'json';
  fallback: string;
  /** Successful responses served, in order, before the faulting call. */
  readServes?: unknown[];
  expectedCalls: ExpectedCall[];
  run: () => Promise<unknown>;
}
// Each sink is a named object so the targeted tests below reference the
// object itself, never a name-string lookup (#1397 review: finding a sink
// by name reintroduces exactly the coupling this harness removed — a wrong
// name silently selects the wrong sink or none).
const memorySettingsUpdate: Sink = { name: 'memory settings update', shape: 'form', fallback: 'Failed to update', expectedCalls: [{}], run: async () => {
  const { actions } = await import('../../routes/app/memories/[id]/settings/+page.server');
  return actions.update!(event({ displayName: 'Fixture' }));
} };
const nodeReorder: Sink = { name: 'node reorder', shape: 'action', fallback: 'Reorder failed', expectedCalls: [
  {},
  { variables: { ref: 'fixture', memoryRef: 'fixture-memory' } },
  { documentContains: 'mutation UpdateNode', variables: { input: { memoryRef: 'fixture-memory', loc: 'fixture', tags: [], seq: 1 } } },
], readServes: [
  { node: { id: 'fixture-anchor', memoryId: 'fixture-memory' } },
  { node: { id: 'fixture-sibling', memoryId: 'fixture-memory', loc: 'fixture', tags: [] } },
], run: async () => {
  const { actions } = await import('../../routes/app/memories/[id]/nodes/[nodeId]/+page.server');
  return actions.reorder!(event({ updates: JSON.stringify([{ loc: 'fixture', seq: 1 }]) }));
} };
const invitationAcceptance: Sink = { name: 'invitation acceptance', shape: 'form', fallback: 'Failed to accept invitation', expectedCalls: [{}], run: async () => {
  const { actions } = await import('../../routes/invite/[token]/+page.server');
  return actions.accept!(event({ _kind: 'acceptInvitation' }));
} };
const organizationCreation: Sink = { name: 'organization creation', shape: 'form', fallback: 'Failed to create organization', expectedCalls: [{}], run: async () => {
  const { actions } = await import('../../routes/app/orgs/new/+page.server');
  return actions.default!(event({ name: 'Fixture', urn: 'fixture.example' }));
} };
// Both calls pinned, not just the count (#1397 review): call 1 is the
// NodeDataByLoc read, call 2 the UpdateNode write — only the pinning proves
// the FAULTING call is the write.
const conversationPosition: Sink = { name: 'conversation position', shape: 'action', fallback: 'Failed to save position', expectedCalls: [
  { documentContains: 'query NodeDataByLoc', variables: { ref: 'fixture', memoryRef: 'fixture-memory' } },
  { documentContains: 'mutation UpdateNode', variables: { input: { memoryRef: 'fixture-memory', loc: 'fixture', data: { position: { x: 1, y: 2 } } } } },
], readServes: [
  { node: { data: {} } },
], run: async () => {
  const { actions } = await import('../../routes/app/agents/[id]/conversations/+page.server');
  return actions.savePosition!(event({ systemMemoryId: 'fixture-memory', loc: 'fixture', x: '1', y: '2' }));
} };
const conversationEdgeDeletion: Sink = { name: 'conversation edge deletion', shape: 'action', fallback: 'Failed to delete edge', expectedCalls: [{}], run: async () => {
  const { actions } = await import('../../routes/app/agents/[id]/conversations/+page.server');
  return actions.deleteEdge!(event({ edgeId: 'fixture-edge' }));
} };
const githubInstallationCallback: Sink = { name: 'GitHub installation callback', shape: 'http', fallback: 'Failed to link GitHub App installation', expectedCalls: [{}], run: async () => {
  const { load } = await import('../../routes/app/github/install/callback/+page.server');
  try { return await load!({ url: new URL('http://localhost/callback?installation_id=123&state=fixture-org'), locals: { token: 'fixture' } } as never); }
  catch (error) { return error; }
} };
const urnResolution: Sink = { name: 'URN resolution JSON', shape: 'json', fallback: 'resolve failed', expectedCalls: [{}], run: async () => {
  const { GET } = await import('../../routes/app/u/resolve/+server');
  const response = await GET({ url: new URL('http://localhost/app/u/resolve?urn=hrn:org:fixture.example'), locals: { token: 'fixture' } } as never);
  return { status: response.status, body: await response.json() };
} };
const sinks: Sink[] = [memorySettingsUpdate, nodeReorder, invitationAcceptance, organizationCreation, conversationPosition, conversationEdgeDeletion, githubInstallationCallback, urnResolution];

/** Queue a sink's successful reads, then run it — so the FAULTING call is the
 *  write, exactly as in production, for both the suppression and the
 *  known-refusal directions. */
async function runSink(sink: Sink): Promise<unknown> {
  for (const served of sink.readServes ?? []) request.mockResolvedValueOnce(served);
  return sink.run();
}

function expectCalls(sink: Sink) {
  expect(request).toHaveBeenCalledTimes(sink.expectedCalls.length);
  sink.expectedCalls.forEach((expected, i) => {
    if (expected.documentContains) expect(request.mock.calls[i][0]).toContain(expected.documentContains);
    if (expected.variables !== undefined) expect(request.mock.calls[i][1]).toEqual(expected.variables);
  });
}

for (const sink of sinks) {
  it.each(['INTERNAL_SERVER_ERROR', 'UNKNOWN_FAULT', null])(`${sink.name} suppresses %s payload text`, async (code) => {
    request.mockRejectedValue(fault(code));
    const result = await runSink(sink);
    expectCalls(sink);
    const safeText = code === 'INTERNAL_SERVER_ERROR'
      ? `Something went wrong on our side. Request ID: ${requestId}`
      : code === 'UNKNOWN_FAULT' ? 'Something went wrong on our side.' : sink.fallback;
    if (sink.shape === 'form') expect(result).toMatchObject({ status: 500, data: { form: { message: { type: 'error', text: safeText } } } });
    if (sink.shape === 'action') expect(result).toEqual(expect.objectContaining({ status: 500, data: { error: safeText } }));
    if (sink.shape === 'http') expect(result).toMatchObject({ status: 500, body: code === 'INTERNAL_SERVER_ERROR'
      ? { message: 'Something went wrong on our side.', requestId }
      : { message: safeText } });
    if (sink.shape === 'json') expect(result).toEqual({ status: 500, body: { code: 'INTERNAL', message: safeText } });
    const text = JSON.stringify(result);
    for (const secret of ['SELECT private', '/srv/private.ts', 'PrivateOperation', 'synthetic-variable-secret', 'synthetic response body']) {
      expect(text).not.toContain(secret);
    }
    if (code === 'INTERNAL_SERVER_ERROR') expect(text).toContain(requestId);
    else expect(text).not.toContain(requestId);
  });
}

// #1397: queueing a sink's reads (runSink above) makes the FAULTING call the
// write, exactly as in production — but the pre-refactor suite also covered
// the sink whose READ itself faults (conversation position's NODE_DATA_BY_LOC
// before its mutation). That failed-read path through savePosition's catch
// keeps its own pin here; expectCalls does not apply because the write never
// runs.
it.each(['INTERNAL_SERVER_ERROR', 'UNKNOWN_FAULT', null])('conversation position read fault suppresses %s payload text', async (code) => {
  request.mockRejectedValue(fault(code));
  const { actions } = await import('../../routes/app/agents/[id]/conversations/+page.server');
  const result = await actions.savePosition!(event({ systemMemoryId: 'fixture-memory', loc: 'fixture', x: '1', y: '2' }));
  expect(request).toHaveBeenCalledTimes(1);
  const safeText = code === 'INTERNAL_SERVER_ERROR'
    ? `Something went wrong on our side. Request ID: ${requestId}`
    : code === 'UNKNOWN_FAULT' ? 'Something went wrong on our side.' : 'Failed to save position';
  expect(result).toEqual(expect.objectContaining({ status: 500, data: { error: safeText } }));
  const text = JSON.stringify(result);
  for (const secret of ['SELECT private', '/srv/private.ts', 'PrivateOperation', 'synthetic-variable-secret', 'synthetic response body']) {
    expect(text).not.toContain(secret);
  }
  if (code === 'INTERNAL_SERVER_ERROR') expect(text).toContain(requestId);
  else expect(text).not.toContain(requestId);
});

// The opt-in direction (#1397 known-refusal controls): a code on the route's
// OWN known list is an intentional, pre-commit refusal, so its server message
// is the reader's product text and survives verbatim — while the carrier's
// response body, query and variables never reach the reader. Pinned for the
// two lists the #1396 reviews called out: savePosition's
// ['NODE_WRITE_CONFLICT'] and reorder's NODE_WRITE_REFUSALS (whose 'CONFLICT'
// entry is verified present in the route's list). Rows carry the sink OBJECT
// plus a display label — the label is only the test title, never a lookup.
// Removing either list from its call site must fail here (the text falls
// back to the generic 'Failed to …' copy).
it.each([
  [conversationPosition, 'conversation position', 'NODE_WRITE_CONFLICT', 'The conversation was changed since you opened it, so nothing was moved.'],
  [nodeReorder, 'node reorder', 'CONFLICT', 'The node was changed since you opened it, so nothing was reordered.'],
] as const)('%s preserves its known refusal text without the carrier payload', async (sink, _label, code, message) => {
  request.mockRejectedValue(refusal(code, message));
  const result = await runSink(sink);
  expectCalls(sink);
  expect(result).toEqual(expect.objectContaining({ status: 500, data: { error: message } }));
  const text = JSON.stringify(result);
  for (const secret of ['synthetic refusal body', 'PrivateOperation', 'synthetic-variable-secret', requestId]) {
    expect(text).not.toContain(secret);
  }
});

// #1397: the two install surfaces share CREATE_APP_REFUSALS
// (create-app-refusals.ts, extracted by this change). These pin that each
// call site still PASSES the list to extractGqlError — dropping the list (or
// the import) from either page falls back to the generic copy and the
// server's intentional refusal text is lost. Reads are served per document
// so the FAULTING call is the write.
it.each([
  ['personal app creation', async () => {
    request.mockImplementation(async (doc: unknown) => {
      if (typeof doc === 'string' && doc.includes('mutation CreatePersonalApp')) throw refusal('URN_NOT_QUALIFIED', 'That URN cannot be used for an app.');
      // Malformed read pages: each fetch fails fast inside its own catch, so
      // the installable-agents gate is skipped as unreliable (ok: false).
      return {};
    });
    const { actions } = await import('../../routes/app/apps/new/+page.server');
    return actions.default!(event({ _kind: 'createPersonalApp', agentId: 'fixture-agent', name: 'Fixture', urn: 'fixture-urn', appType: 'WORKSTATION' }));
  }],
  ['organization agent install', async () => {
    request.mockImplementation(async (doc: unknown) => {
      if (typeof doc === 'string' && doc.includes('mutation CreateApp')) throw refusal('URN_NOT_QUALIFIED', 'That URN cannot be used for an app.');
      // One organizations page carrying the target org and agent, so
      // resolveInstallTarget resolves without further reads.
      return { organizations: { items: [{ id: 'fixture-org', agents: [{ id: 'fixture-agent' }], apps: [] }] } };
    });
    const { actions } = await import('../../routes/app/orgs/[id]/agents/install/[aid]/+page.server');
    return actions.install!(event({ _kind: 'installAgent', name: 'Fixture', urn: 'fixture-urn', appType: 'WORKSTATION' }, { id: 'fixture-org', aid: 'fixture-agent' }));
  }],
] as const)('%s keeps the shared CREATE_APP_REFUSALS list in play', async (_label, run) => {
  const result = await run();
  expect(result).toMatchObject({ status: 400, data: { form: { message: { type: 'error', text: 'That URN cannot be used for an app.' } } } });
  const text = JSON.stringify(result);
  for (const secret of ['synthetic refusal body', 'PrivateOperation', 'synthetic-variable-secret', requestId]) {
    expect(text).not.toContain(secret);
  }
});

// These paths intentionally preserve genuine transport and known-refusal
// text. Split by carrier kind (#1397 review): the carrier-payload pins only
// mean anything where the fixture actually carries those strings — against
// a plain transport Error they were vacuous.
it('GitHub callback preserves a typed refusal without the carrier payload', async () => {
  request.mockRejectedValue(new ClientError({
    status: 400, headers: new Headers(), body: 'synthetic refusal response', errors: [new GraphQLError('intentional refusal', { extensions: { code: 'BAD_USER_INPUT' } })],
  }, { query: 'query Fixture { fixture }' }));
  const result = await githubInstallationCallback.run();
  expect(result).toMatchObject({ status: 500, body: { message: 'intentional refusal' } });
  expect((result as { body: object }).body).not.toHaveProperty('requestId');
  // #1397: the preserved text is the server's intentional refusal; the
  // ClientError carrier's own response body and query stay behind it.
  const text = JSON.stringify(result);
  expect(text).not.toContain('synthetic refusal response');
  expect(text).not.toContain('query Fixture');
});

it('GitHub callback preserves plain transport text without internal metadata', async () => {
  request.mockRejectedValue(new Error('network unavailable'));
  const result = await githubInstallationCallback.run();
  expect(result).toMatchObject({ status: 500, body: { message: 'network unavailable' } });
  expect((result as { body: object }).body).not.toHaveProperty('requestId');
});

it('URN JSON suppresses non-Error thrown text while retaining its 500/code contract', async () => {
  request.mockRejectedValue('SELECT private FROM /srv/private.ts');
  expect(await urnResolution.run()).toEqual({
    status: 500, body: { code: 'INTERNAL', message: 'resolve failed' },
  });
});
