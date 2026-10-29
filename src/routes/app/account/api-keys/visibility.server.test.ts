import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, print } from 'graphql';
const request = vi.hoisted(() => vi.fn());
const client = vi.hoisted(() => vi.fn(() => ({ request })));
vi.mock('$lib/server/api', () => ({ gqlClient: client }));
import { load, actions } from './+page.server';
import { MY_USER_API_KEYS_QUERY } from '$lib/server/queries';
const event = (search = '') => ({ locals: { token: 'synthetic-session' }, url: new URL(`http://localhost/app/account/api-keys${search}`) }) as never;
const action = (values: Record<string, string | undefined>, token: string | null = 'synthetic-session') => {
  const fd = new FormData(); for (const [k,v] of Object.entries(values)) { if (v !== undefined) fd.set(k,v); }
  return { locals: { token }, request: { formData: async () => fd } } as never;
};
beforeEach(() => { vi.clearAllMocks(); request.mockResolvedValue({ myUserApiKeys: [] }); });
describe('#1011 hidden UserApiKey wire', () => {
  it('requests default / included / default at the server, and keeps the selected state', async () => {
    for (const [search, includeHidden] of [['', false], ['?includeHidden=true', true], ['', false]] as const) {
      const result = await load(event(search));
      expect(request).toHaveBeenLastCalledWith(MY_USER_API_KEYS_QUERY, { includeHidden });
      expect(result).toMatchObject({ includeHidden });
    }
    expect(print(parse(MY_USER_API_KEYS_QUERY))).toContain('myUserApiKeys(includeHidden: $includeHidden)');
    expect(print(parse(MY_USER_API_KEYS_QUERY))).toContain('hiddenAt');
  });
  it.each(['true', 'false'])('sends explicit hidden=%s and id, forwarding only the caller credential', async hidden => {
    request.mockResolvedValueOnce({ setUserApiKeyHidden: { id: 'own-revoked', hiddenAt: hidden === 'true' ? '2026-10-28T00:00:00Z' : null } });
    const result = await actions.visibility(action({ id: 'own-revoked', hidden, userId: 'forged' }));
    expect(client).toHaveBeenCalledWith('synthetic-session');
    expect(request).toHaveBeenCalledWith(expect.any(String), { id: 'own-revoked', hidden: hidden === 'true' });
    expect(result).toMatchObject({ visibility: { type: 'success', id: 'own-revoked' } });
    expect(JSON.stringify(result)).not.toContain('rawKey');
  });
  it.each([{id:'x'}, {id:'x',hidden:'yes'}, {id:'',hidden:'true'}, {hidden:'false'}])('rejects malformed input without a request: %j', async values => {
    expect(await actions.visibility(action(values))).toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });
  it('does not call upstream without a user credential', async () => {
    expect(await actions.visibility(action({id:'x',hidden:'true'}, null))).toMatchObject({ status: 401 });
    expect(request).not.toHaveBeenCalled();
  });
  it.each(['BAD_USER_INPUT', 'NOT_FOUND', 'FORBIDDEN', 'UNAUTHENTICATED'])('renders the server refusal %s without a success', async code => {
    request.mockRejectedValueOnce({ response: { errors: [{ message: code, extensions: { code, ...(code === 'BAD_USER_INPUT' ? {reason:'KEY_ACTIVE'} : {}) } }] } });
    const result = await actions.visibility(action({id:'x',hidden:'true'}));
    expect(result).toMatchObject({ status: 500, data: { visibility: { type: 'error', text: code } } });
  });
  it('does not expose transport diagnostics', async () => {
    request.mockRejectedValueOnce(new Error('Authorization: synthetic-private-value'));
    const result = await actions.visibility(action({id:'x',hidden:'true'}));
    expect(JSON.stringify(result)).not.toContain('synthetic-private-value');
  });
});
