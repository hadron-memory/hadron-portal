/**
 * #668 — the principal's memory-share controls.
 *
 * The load is itself an authorization check (`Memory.shares` is
 * principal/org-admin only), and the three actions each key on a grantee
 * reference. The assertions below concentrate on the two things that can go
 * wrong quietly:
 *
 *   1. `shares: null` (the server declined) collapsing into `[]` (nobody has
 *      access) — a fact about the request rendered as a fact about the memory.
 *   2. a BLANK granteeRef reaching `deleteMemoryShare`, where omitting the ref
 *      is the caller's own "leave" path — so an empty value does not fail, it
 *      deletes a different row and reports success.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

async function importMod() {
  return import('./+page.server');
}

function ev(fields: Record<string, string> = {}, memId = 'mem-1') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return {
    params: { id: memId },
    locals: { token: 'test-token' },
    request: { formData: async () => fd },
  } as never;
}

function loadEv(memId = 'mem-1') {
  return { params: { id: memId }, locals: { token: 'test-token' } } as never;
}

const memory = (over: Record<string, unknown> = {}) => ({
  id: 'mem-1',
  name: 'Notes',
  urn: 'hrn:mem:acme.com:notes',
  class: 'personal',
  userId: 'owner-1',
  shareable: true,
  shares: [],
  ...over,
});

const share = (over: Record<string, unknown> = {}) => ({
  role: 'reader',
  createdAt: '1789430400000',
  updatedAt: null,
  grantee: { id: 'u-2', urn: 'hrn:user:ada', handle: 'ada', name: 'Ada', email: 'ada@x.test', avatarUrl: null },
  grantor: { id: 'owner-1', urn: 'hrn:user:holger', handle: 'holger', name: 'Holger' },
  ...over,
});

function formOf(result: unknown) {
  return (result as { data?: { form?: { valid?: boolean; message?: unknown; errors?: Record<string, string[]> } };
                     form?: { valid?: boolean; message?: unknown; errors?: Record<string, string[]> } } | undefined)
    ?.data?.form ?? (result as { form?: { valid?: boolean; message?: unknown; errors?: Record<string, string[]> } } | undefined)?.form;
}

describe('share load()', () => {
  it('returns the shares the server gave it', async () => {
    mockRequest.mockResolvedValueOnce({ memory: memory({ shares: [share()] }) });
    const { load } = await importMod();

    const res = (await load(loadEv())) as { shares: unknown[] | null; shareMemory: { shareable: boolean } };

    expect(res.shares).toHaveLength(1);
    expect(res.shareMemory.shareable).toBe(true);
  });

  it('keeps a REFUSED list (null) distinct from an empty one', async () => {
    // The page renders these differently on purpose: null is "you may not see
    // this", [] is "nobody has access". Coercing null to [] here would tell a
    // non-owner the memory is shared with nobody.
    mockRequest.mockResolvedValueOnce({ memory: memory({ shares: null }) });
    const { load } = await importMod();

    const res = (await load(loadEv())) as { shares: unknown[] | null };

    expect(res.shares).toBeNull();
    expect(res.shares).not.toEqual([]);
  });

  it('404s on a missing memory rather than rendering an empty page', async () => {
    mockRequest.mockResolvedValueOnce({ memory: null });
    const { load } = await importMod();

    await expect(load(loadEv())).rejects.toMatchObject({ status: 404 });
  });

  it('does NOT swallow a loader failure into an empty share list', async () => {
    // hrn:node:hadronmemory.com:hadron-portal:review:no-silent-loader-catch — a transport error must not render as
    // "shared with nobody".
    mockRequest.mockRejectedValueOnce(new Error('boom'));
    const { load } = await importMod();

    await expect(load(loadEv())).rejects.toThrow();
  });
});

describe('createShare action', () => {
  it('sends the memory from params and the grantee ref from the form', async () => {
    mockRequest.mockResolvedValueOnce({ createMemoryShare: { memoryShare: { role: 'writer' } } });
    const { actions } = await importMod();

    await actions.createShare(ev({ _kind: 'createShare', granteeRef: 'u-2', role: 'writer' }, 'mem-real'));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toEqual({ memoryId: 'mem-real', granteeRef: 'u-2', role: 'writer' });
  });

  it('refuses a blank grantee before calling the server', async () => {
    const { actions } = await importMod();

    const result = await actions.createShare(ev({ _kind: 'createShare', granteeRef: '  ', role: 'reader' }));

    expect(formOf(result)?.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses a role outside the server enum', async () => {
    const { actions } = await importMod();

    const result = await actions.createShare(ev({ _kind: 'createShare', granteeRef: 'u-2', role: 'admin' }));

    expect(formOf(result)?.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it("surfaces the server's refusal verbatim rather than inventing a cause", async () => {
    mockRequest.mockRejectedValueOnce({
      response: { errors: [{ message: 'InvalidMemoryClassForShareError', extensions: { code: 'BAD_USER_INPUT' } }] },
    });
    const { actions } = await importMod();

    const result = await actions.createShare(ev({ _kind: 'createShare', granteeRef: 'u-2', role: 'reader' }));

    expect(formOf(result)?.message).toMatchObject({ type: 'error' });
    expect(JSON.stringify(formOf(result)?.message)).toContain('InvalidMemoryClassForShareError');
  });
});

describe('updateShareRole action', () => {
  it('passes grantee and role through', async () => {
    mockRequest.mockResolvedValueOnce({ updateMemoryShareRole: { memoryShare: { role: 'writer' } } });
    const { actions } = await importMod();

    await actions.updateShareRole(ev({ _kind: 'updateShareRole', granteeRef: 'u-2', role: 'writer' }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toEqual({ memoryId: 'mem-1', granteeRef: 'u-2', role: 'writer' });
  });

  it('refuses a blank grantee', async () => {
    const { actions } = await importMod();
    const result = await actions.updateShareRole(ev({ _kind: 'updateShareRole', granteeRef: '', role: 'writer' }));
    expect(formOf(result)?.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});

describe('revokeShare action', () => {
  it('always sends an explicit granteeRef', async () => {
    mockRequest.mockResolvedValueOnce({ deleteMemoryShare: { memoryId: 'mem-1', granteeId: 'u-2' } });
    const { actions } = await importMod();

    await actions.revokeShare(ev({ _kind: 'revokeShare', granteeRef: 'u-2' }));

    const [, vars] = mockRequest.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(vars).toEqual({ memoryRef: 'mem-1', granteeRef: 'u-2' });
    // The ref must be PRESENT and non-empty. Omitting it is the server's
    // "remove my own share" path, so a revoke that lost its ref would delete
    // the caller's row and report success.
    expect(vars.granteeRef).toBeTruthy();
  });

  it.each(['', '   '])('refuses a blank grantee (%j) before the server sees it', async (blank) => {
    // THE test of this page. `deleteMemoryShare` treats an absent granteeRef as
    // "target myself", so a blank one must never become a request: the failure
    // mode is not an error, it is a successful deletion of the wrong row.
    const { actions } = await importMod();

    const result = await actions.revokeShare(ev({ _kind: 'revokeShare', granteeRef: blank }));

    expect(formOf(result)?.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('rejects a sibling action’s discriminator', async () => {
    const { actions } = await importMod();

    const result = await actions.revokeShare(ev({ _kind: 'createShare', granteeRef: 'u-2' }));

    expect(formOf(result)?.valid).toBe(false);
    expect(mockRequest).not.toHaveBeenCalled();
  });
});
