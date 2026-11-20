/** portal#2106 row 1: the options `asTesterManager` accepts, pinned directly. */
import { describe, expect, it, vi } from 'vitest';
import { ORGANIZATIONS_QUERY, SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';
import { asTesterManager } from './tester-manage';

describe('asTesterManager', () => {
  it('answers a manager by default', async () => {
    const wrapped = asTesterManager(vi.fn());
    expect(await wrapped(SELF_CAN_MANAGE_QUERY)).toEqual({ effectiveAccess: { canManage: true } });
  });

  it('canManage: false answers a non-manager', async () => {
    const wrapped = asTesterManager(vi.fn(), { canManage: false });
    expect(await wrapped(SELF_CAN_MANAGE_QUERY)).toEqual({ effectiveAccess: { canManage: false } });
  });

  it('canManage: null answers a null effectiveAccess', async () => {
    const wrapped = asTesterManager(vi.fn(), { canManage: null });
    expect(await wrapped(SELF_CAN_MANAGE_QUERY)).toEqual({ effectiveAccess: null });
  });

  it("canManage: 'fail' throws upstream 503", async () => {
    const wrapped = asTesterManager(vi.fn(), { canManage: 'fail' });
    await expect(wrapped(SELF_CAN_MANAGE_QUERY)).rejects.toThrow('upstream 503');
  });

  it('never reaches the wrapped request for the manage question', async () => {
    const request = vi.fn();
    await asTesterManager(request, { canManage: false })(SELF_CAN_MANAGE_QUERY);
    expect(request).not.toHaveBeenCalled();
  });

  it('passes the organization list through when visibleAgentIds is empty', async () => {
    const request = vi.fn().mockResolvedValue('passed through');
    expect(await asTesterManager(request)(ORGANIZATIONS_QUERY, { v: 1 })).toBe('passed through');
    expect(await asTesterManager(request, { visibleAgentIds: [] })(ORGANIZATIONS_QUERY, { v: 2 })).toBe('passed through');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith(ORGANIZATIONS_QUERY, { v: 1 });
  });

  it('intercepts the organization list, without delegating, when visibleAgentIds is non-empty', async () => {
    const request = vi.fn();
    const res = (await asTesterManager(request, { visibleAgentIds: ['a1'] })(ORGANIZATIONS_QUERY)) as { organizations: { items: Array<{ agents: Array<{ id: string }> }> } };
    expect(res.organizations.items[0].agents.map((a) => a.id)).toEqual(['a1']);
    expect(request).not.toHaveBeenCalled();
  });

  it('passes every other query through with its variables', async () => {
    const request = vi.fn().mockResolvedValue('x');
    expect(await asTesterManager(request, { canManage: 'fail' })('query Other', { a: 1 })).toBe('x');
    expect(request).toHaveBeenCalledWith('query Other', { a: 1 });
  });
});
