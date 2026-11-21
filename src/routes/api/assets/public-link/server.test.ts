/**
 * #1131 — POST /api/assets/public-link, the proxy over setAssetPublicLink.
 *
 * The server decides who may switch the link, so the proxy's own job is small
 * and is pinned here: refuse malformed input BEFORE the server is called (this
 * field publishes a file), pass the typed refusal through as a fixed-code JSON
 * body, and never turn a fault into a success or into a false 4xx.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from 'graphql-request';
import { SET_ASSET_PUBLIC_LINK_MUTATION } from '$lib/server/assetQueries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

function call(body: unknown, token: string | null = 'tok') {
  return import('./+server').then(({ POST }) =>
    POST({ request: { json: async () => body }, locals: { token } } as never),
  );
}

function gqlError(code: string, message: string) {
  return new ClientError(
    { status: 200, headers: new Headers(), errors: [{ message, extensions: { code } } as never] } as never,
    { query: SET_ASSET_PUBLIC_LINK_MUTATION } as never,
  );
}

const answer = { id: 'a1', publicLinkEnabled: true, canManagePublicLink: true, publicLinkAvailable: true, publicUrl: 'https://x/assets/a1' };

describe('POST /api/assets/public-link', () => {
  it('sends assetRef and enabled to setAssetPublicLink and returns the server\'s asset', async () => {
    mockRequest.mockResolvedValue({ setAssetPublicLink: answer });
    const res = await call({ assetId: 'a1', enabled: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(answer);
    const [doc, vars] = mockRequest.mock.calls[0];
    expect(doc).toBe(SET_ASSET_PUBLIC_LINK_MUTATION);
    expect(vars).toEqual({ assetRef: 'a1', enabled: true });
  });

  it('asks the mutation for the three signals and the URL, so the caller refreshes from the answer', () => {
    for (const field of ['publicLinkEnabled', 'canManagePublicLink', 'publicLinkAvailable', 'publicUrl']) {
      expect(SET_ASSET_PUBLIC_LINK_MUTATION).toContain(field);
    }
  });

  it('refuses a request with no session before calling the server', async () => {
    const res = await call({ assetId: 'a1', enabled: true }, null);
    expect(res.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing assetId', { enabled: true }],
    ['an empty assetId', { assetId: '', enabled: true }],
    ['a non-string assetId', { assetId: 7, enabled: true }],
    ['a missing enabled', { assetId: 'a1' }],
    ['a string "false", which is truthy to the next reader', { assetId: 'a1', enabled: 'false' }],
    ['a number', { assetId: 'a1', enabled: 1 }],
    ['null', { assetId: 'a1', enabled: null }],
    ['no body at all', null],
  ])('rejects %s with 400 and never reaches the server', async (_label, body) => {
    const res = await call(body);
    expect(res.status).toBe(400);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('passes a non-manager\'s typed refusal through as a fixed code, with the status it maps to', async () => {
    mockRequest.mockRejectedValue(gqlError('PERMISSION_DENIED', 'caller does not manage this asset\'s memory'));
    const res = await call({ assetId: 'a1', enabled: true });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PERMISSION_DENIED');
  });

  it('answers NOT_FOUND for an asset the caller cannot see', async () => {
    mockRequest.mockRejectedValue(gqlError('NOT_FOUND', 'asset not found'));
    const res = await call({ assetId: 'nope', enabled: false });
    expect(res.status).toBe(404);
  });

  it('keeps an unknown code a failure (500), not a refusal, and does not reflect the server\'s prose', async () => {
    mockRequest.mockRejectedValue(gqlError('SOMETHING_NEW', 'database password is hunter2'));
    const res = await call({ assetId: 'a1', enabled: true });
    expect(res.status).toBe(500);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('hunter2');
  });

  it('keeps a transport fault a failure (500)', async () => {
    mockRequest.mockRejectedValue(new Error('socket hang up'));
    expect((await call({ assetId: 'a1', enabled: true })).status).toBe(500);
  });

  it.each([
    ['null', null],
    ['another asset', { ...answer, id: 'other' }],
    ['a flag that is not a boolean', { ...answer, publicLinkEnabled: 'yes' }],
  ])('treats a malformed answer (%s) as a fault, never as a successful switch', async (_label, bad) => {
    mockRequest.mockResolvedValue({ setAssetPublicLink: bad });
    expect((await call({ assetId: 'a1', enabled: true })).status).toBe(500);
  });
});
