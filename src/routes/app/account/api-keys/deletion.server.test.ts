// portal#1011 P2: delete an own UserApiKey over the merged #3298 wire
// (deleteUserApiKey(id): UserApiKeyDeletion!, hrn:node:hadronmemory.com:specs:cor:dmo:070:03).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, print } from 'graphql';
const request = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => vi.fn(() => ({ request })));
vi.mock('$lib/server/api', () => ({ gqlClient: client }));
import { load, actions } from './+page.server';
import { DELETE_USER_API_KEY_MUTATION, MY_USER_API_KEYS_QUERY } from '$lib/server/queries';

const action = (values: Record<string, string | undefined>, token: string | null = 'synthetic-session') => {
  const fd = new FormData(); for (const [k, v] of Object.entries(values)) { if (v !== undefined) fd.set(k, v); }
  return { locals: { token }, request: { formData: async () => fd } } as never;
};
const record = (keyId: string, revokedKeyIds: string[], mintedKeyIds: string[] = []) => ({
  deleteUserApiKey: { id: 'deletion-1', keyId, deletedAt: '2026-11-03T00:00:00Z', revokedKeyIds, mintedKeyIds },
});
const refusal = (code: string, message = `server prose for ${code}`) =>
  ({ response: { errors: [{ message, extensions: { code } }] } });
const deletion = (r: unknown) => (r as { data?: { deletion?: Record<string, unknown> }; deletion?: Record<string, unknown> });
const notice = (r: unknown) => deletion(r).data?.deletion ?? deletion(r).deletion;

beforeEach(() => { vi.clearAllMocks(); });

describe('#1011 P2 deletion wire', () => {
  it('selects the deletion record without any secret, hash or raw key', () => {
    const doc = print(parse(DELETE_USER_API_KEY_MUTATION));
    expect(doc).toContain('deleteUserApiKey(id: $id)');
    for (const field of ['keyId', 'revokedKeyIds', 'mintedKeyIds']) expect(doc).toContain(field);
    for (const secret of ['rawKey', 'hash', 'secret', 'token']) expect(doc.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it('sends exactly one mutation with the trimmed id, forwarding only the caller credential', async () => {
    request.mockResolvedValueOnce(record('own-live', ['own-live', 'child'], ['child']));
    const result = await actions.delete(action({ id: '  own-live ', userId: 'forged', ownerId: 'forged' }));
    expect(client).toHaveBeenCalledExactlyOnceWith('synthetic-session');
    expect(request).toHaveBeenCalledExactlyOnceWith(DELETE_USER_API_KEY_MUTATION, { id: 'own-live' });
    expect(notice(result)).toMatchObject({ type: 'success' });
    expect(String(notice(result)?.text)).toMatch(/revoked first/i);
    // The record stays server-side: no child ids, counts or record fields reach the page.
    const json = JSON.stringify(result);
    for (const leaked of ['child', 'deletion-1', 'mintedKeyIds', 'revokedKeyIds']) expect(json).not.toContain(leaked);
  });

  it('an already-revoked delete promises no new revocation', async () => {
    request.mockResolvedValueOnce(record('own-revoked', [], ['child']));
    const result = await actions.delete(action({ id: 'own-revoked' }));
    expect(notice(result)).toMatchObject({ type: 'success' });
    expect(String(notice(result)?.text)).toMatch(/no key was newly revoked/i);
    expect(String(notice(result)?.text)).not.toMatch(/revoked first/i);
  });

  it.each([{}, { id: '' }, { id: '   ' }])('refuses malformed input without a request: %j', async values => {
    expect(await actions.delete(action(values))).toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });

  it('does not call upstream without a user credential', async () => {
    expect(await actions.delete(action({ id: 'own-live' }, null))).toMatchObject({ status: 401 });
    expect(client).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    ['a record for another key', record('someone-else', ['someone-else'])],
    ['a null record', { deleteUserApiKey: null }],
    ['no record', {}],
    ['revokedKeyIds missing', { deleteUserApiKey: { id: 'd', keyId: 'own-live', mintedKeyIds: [] } }],
    ['revokedKeyIds not ids', { deleteUserApiKey: { id: 'd', keyId: 'own-live', revokedKeyIds: [1], mintedKeyIds: [] } }],
  ])('treats %s as uncertain, never as a success', async (_label, response) => {
    request.mockResolvedValueOnce(response);
    const result = await actions.delete(action({ id: 'own-live' }));
    expect(result).toMatchObject({ status: 502 });
    expect(notice(result)).toMatchObject({ type: 'error', recover: true });
    expect(String(notice(result)?.text)).toMatch(/could not confirm/i);
  });

  it('answers unknown and foreign ids identically, never echoing server prose', async () => {
    request.mockRejectedValueOnce(refusal('NOT_FOUND', 'No key unknown-id'));
    const unknown = await actions.delete(action({ id: 'unknown-id' }));
    request.mockRejectedValueOnce(refusal('NOT_FOUND', 'Key foreign-id belongs to synthetic-other@example.test'));
    const foreign = await actions.delete(action({ id: 'foreign-id' }));
    expect(unknown).toEqual(foreign);
    expect(JSON.stringify(foreign)).not.toContain('synthetic-other');
    expect(JSON.stringify(unknown)).not.toContain('unknown-id');
    expect(notice(foreign)).toMatchObject({ type: 'error' });
    expect(notice(foreign)?.recover).toBeFalsy();
  });

  it.each(['FORBIDDEN', 'UNAUTHENTICATED', 'SESSION_EXPIRED', 'BAD_USER_INPUT'])(
    'maps the %s refusal to fixed copy without server prose and without a recovery prompt', async code => {
      request.mockRejectedValueOnce(refusal(code, 'synthetic-server-prose'));
      const result = await actions.delete(action({ id: 'own-live' }));
      expect(notice(result)).toMatchObject({ type: 'error' });
      expect(notice(result)?.recover).toBeFalsy();
      expect(JSON.stringify(result)).not.toContain('synthetic-server-prose');
      expect(String(notice(result)?.text)).not.toMatch(/API key deleted/i);
    });

  it.each([
    ['a transport failure', new Error('Authorization: synthetic-private-value')],
    ['an unclassified server error', refusal('INTERNAL_SERVER_ERROR', 'synthetic-private-value')],
  ])('reports %s as uncertain without diagnostics', async (_label, error) => {
    request.mockRejectedValueOnce(error);
    const result = await actions.delete(action({ id: 'own-live' }));
    expect(result).toMatchObject({ status: 502 });
    expect(notice(result)).toMatchObject({ type: 'error', recover: true });
    expect(JSON.stringify(result)).not.toContain('synthetic-private-value');
  });

  it('opens the no-JS confirmation only for a key in the loaded list', async () => {
    const page = { myUserApiKeysPage: { items: [{ id: 'own-live', keyPreview: 'abcd', label: null, createdAt: '2026-11-03T00:00:00Z', lastUsedAt: null, revokedAt: null, hiddenAt: null, issuedVia: 'portal' }], total: 1, hasMore: false } };
    const event = (search: string) => ({ locals: { token: 'synthetic-session' }, url: new URL(`http://localhost/app/account/api-keys${search}`) }) as never;
    request.mockResolvedValue(page);
    expect(await load(event('?confirmDelete=own-live'))).toMatchObject({ deleteTarget: 'own-live' });
    expect(await load(event('?confirmDelete=foreign-id'))).toMatchObject({ deleteTarget: null });
    expect(await load(event(''))).toMatchObject({ deleteTarget: null });
    expect(request).toHaveBeenCalledWith(MY_USER_API_KEYS_QUERY, expect.anything());
  });
});
