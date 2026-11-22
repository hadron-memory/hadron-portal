import { afterEach, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import { inspect } from 'node:util';

vi.mock('$lib/server/node-advice', () => ({ nodeAdviceHandle: vi.fn() }));
vi.mock('$lib/server/session-action-guard', () => ({ sessionActionGuard: vi.fn() }));
vi.mock('$lib/server/csp', () => ({ appendConnectSrc: vi.fn(), resolveAssetStorageOrigin: () => null }));

import { handleError } from './hooks.server';

afterEach(() => { vi.restoreAllMocks(); });

it('logs an unexpected portal exception while returning only safe reader copy', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const error = Object.assign(new TypeError('private portal render failure'), { arbitraryPayload: 'synthetic-extra-property' });
  const result = await handleError({ error, status: 500, message: 'Internal Error', event: {} as never });
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0]).toContainEqual(expect.objectContaining({ error: { name: error.name, message: error.message, stack: error.stack }, status: 500 }));
  expect(inspect(log.mock.calls, { depth: 10 })).not.toContain('synthetic-extra-property');
  expect(result).toEqual({ message: 'Something went wrong on our side.' });
});

it.each([[400, 'Bad Request'], [403, 'Forbidden'], [404, 'Not Found']])(
  'preserves SvelteKit %s framework copy', async (status, message) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handleError({ error: new Error('not reader copy'), status: Number(status), message: String(message), event: {} as never });
    expect(result).toEqual({ message });
  },
);

it('preserves a validated GraphQL request id without returning its diagnostics', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const requestId = 'a4451409-72f6-4f08-b90b-f8db328e8c58';
  const error = { response: { errors: [{ message: 'SELECT private FROM /srv/internal.ts', extensions: { code: 'INTERNAL_SERVER_ERROR', requestId } }] } };
  const result = await handleError({ error, status: 500, message: 'Internal Error', event: {} as never });
  expect(result).toEqual({ message: 'Something went wrong on our side.', requestId });
});


it('logs only bounded GraphQL metadata, never constructor payloads or headers', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const requestId = 'a4451409-72f6-4f08-b90b-f8db328e8c58';
  const request = { query: 'query PrivateOperation { privateField }', variables: { token: 'synthetic-variable-secret' }, headers: { authorization: 'Bearer synthetic-header-secret' } };
  const error = new ClientError({ status: 500, body: 'synthetic-response-body-secret', headers: new Headers({ 'set-cookie': 'synthetic-cookie-secret' }), errors: [new GraphQLError('private-server-prose', { extensions: { code: 'INTERNAL_SERVER_ERROR', requestId } })] }, request);
  const result = await handleError({ error, status: 500, message: 'Internal Error', event: {} as never });
  const logged = inspect(log.mock.calls, { depth: 10 });
  for (const secret of ['PrivateOperation', 'synthetic-variable-secret', 'synthetic-header-secret', 'synthetic-cookie-secret', 'synthetic-response-body-secret', 'private-server-prose']) {
    expect(logged).not.toContain(secret);
  }
  expect(log).toHaveBeenCalledWith('[portal] unexpected GraphQL error', { status: 500, code: 'INTERNAL_SERVER_ERROR', requestId });
  expect(result).toEqual({ message: 'Something went wrong on our side.', requestId });
});

// #1397 (Ruth N4): a PAYLOADLESS ClientError — a non-2xx whose body never
// parsed as GraphQL, so `response` has no `errors` — classifies as transport.
// The `instanceof ClientError` guard is then the ONLY thing routing it to the
// bounded log; the else branch would log .message/.stack, and ClientError's
// constructor embeds the whole {response, request} JSON — query and variables
// included — in the message. Dropping that guard must fail here.
it('a payloadless ClientError logs bounded metadata only, never its embedded query or variables', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => {});
  const error = new ClientError(
    { status: 503, headers: new Headers(), body: 'synthetic-response-body-secret' },
    { query: 'query PrivateOperation { privateField }', variables: { token: 'synthetic-variable-secret' } },
  );
  const result = await handleError({ error, status: 503, message: 'Service Unavailable', event: {} as never });
  const logged = inspect(log.mock.calls, { depth: 10 });
  for (const secret of ['PrivateOperation', 'synthetic-variable-secret', 'synthetic-response-body-secret']) {
    expect(logged).not.toContain(secret);
  }
  expect(log).toHaveBeenCalledOnce();
  expect(log.mock.calls[0][0]).toBe('[portal] unexpected GraphQL error');
  expect(result).toEqual({ message: 'Something went wrong on our side.' });
});
