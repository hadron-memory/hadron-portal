/**
 * portal#696 — review:clienterror-map-known-codes-only, applied to the
 * /api/assets/* endpoints.
 *
 * The five original endpoints each hand-rolled a mapping whose tail was
 * "any other ClientError → 400". That turns a resolver crash and a dead gateway
 * into "your request was bad". The cases below are exactly the ones that shape
 * failed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ClientError } from 'graphql-request';
import { mapAssetError } from './assetErrors';
import { LOC_CONFLICT_CODE } from '$lib/assets/error-codes';

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** A ClientError carrying a GraphQL errors payload. */
function gqlError(code: string | undefined, message = 'nope') {
  return new ClientError(
    {
      errors: [{ message, ...(code ? { extensions: { code } } : {}) }],
      status: 200,
    } as never,
    { query: 'query X { x }' },
  );
}

describe('mapAssetError', () => {
  it('maps a known auth code to 401', () => {
    const [body, init] = mapAssetError(gqlError('UNAUTHENTICATED'), 'x');
    expect(init.status).toBe(401);
    expect(body.code).toBe('UNAUTHENTICATED');
  });

  it('maps not-found to 404', () => {
    expect(mapAssetError(gqlError('NOT_FOUND'), 'x')[1].status).toBe(404);
  });

  it('maps a scan gate to 409, not 400 — nothing was wrong with the request', () => {
    expect(mapAssetError(gqlError('SCAN_PENDING'), 'x')[1].status).toBe(409);
    expect(mapAssetError(gqlError('SCAN_BLOCKED'), 'x')[1].status).toBe(409);
  });

  it('maps the upload-refusal code to 400', () => {
    const [body, init] = mapAssetError(gqlError('MEMORY_NOT_ACCEPTING_UPLOADS'), 'x');
    expect(init.status).toBe(400);
    expect(body.code).toBe('MEMORY_NOT_ACCEPTING_UPLOADS');
  });

  it('maps a taken reference-node loc to 409, under the code the server really emits', () => {
    // PR #697 review: reference-node writes go through writeNodeCore in 'create'
    // mode, whose typed errors set extensions.code to the CLASS NAME. An earlier
    // draft mapped a guessed `LOC_CONFLICT`, which matches nothing — so a
    // collision fell through to a 500 and the attach dialog could not retry it.
    const [body, init] = mapAssetError(gqlError(LOC_CONFLICT_CODE), 'x');
    expect(init.status).toBe(409);
    expect(body.code).toBe(LOC_CONFLICT_CODE);
  });

  it('exposes the conflict code as the class name, not a SCREAMING_CASE constant', () => {
    // Pins the shape, since the whole retry path keys on this string matching what
    // hadron-server throws (NodeLocConflictError in src/lib/entityRef/errors.ts).
    expect(LOC_CONFLICT_CODE).toBe('NodeLocConflictError');
  });

  it('maps a malformed loc to 400', () => {
    expect(mapAssetError(gqlError('InvalidLocError'), 'x')[1].status).toBe(400);
  });

  it('does NOT collapse an internal server error into a 4xx', () => {
    const [body, init] = mapAssetError(gqlError('INTERNAL_SERVER_ERROR'), 'x');
    expect(init.status).toBe(500);
    expect(body.code).toBe('INTERNAL');
  });

  it('does NOT collapse an unrecognised code into a 4xx', () => {
    expect(mapAssetError(gqlError('SOME_NEW_CODE'), 'x')[1].status).toBe(500);
  });

  it('treats a ClientError with an errors entry but no code as internal', () => {
    expect(mapAssetError(gqlError(undefined), 'x')[1].status).toBe(500);
  });

  it('treats a payload-less ClientError (transport failure) as internal', () => {
    // graphql-request also uses ClientError for a bad gateway / HTML error body,
    // where `response.errors` is absent — reading extensions.code off it yields
    // undefined, and a catch-all turns an outage into a false 4xx.
    const transport = new ClientError({ status: 502 } as never, { query: 'query X { x }' });
    expect(mapAssetError(transport, 'x')[1].status).toBe(500);
  });

  it('treats a non-GraphQL error as internal', () => {
    expect(mapAssetError(new Error('socket hang up'), 'x')[1].status).toBe(500);
  });

  it('does not leak the underlying message to the client on an internal error', () => {
    const [body] = mapAssetError(new Error('connect ECONNREFUSED 10.0.0.5:4000'), 'x');
    expect(body.message).not.toMatch(/ECONNREFUSED/);
  });

  it('logs the context so an unmapped failure is diagnosable from the logs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mapAssetError(gqlError('WEIRD'), 'completeAssetUpload');
    expect(spy.mock.calls.flat().join(' ')).toMatch(/completeAssetUpload/);
  });
});
