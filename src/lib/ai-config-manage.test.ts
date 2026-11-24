import { describe, expect, it } from 'vitest';
import { aiConfigCanManage, orgRoleCanManage } from './ai-config-manage';
import type { OrgMember } from './types';

const member = (id: string, role: string) => ({ user: { id }, role }) as unknown as OrgMember;

describe('orgRoleCanManage (portal#2567)', () => {
  it.each([['OWNER', true], ['ADMIN', true], ['CONTRIBUTOR', false], ['READER', false]])('the viewer as %s: %s', (role, expected) => {
    expect(orgRoleCanManage([member('u1', role)], 'u1')).toBe(expected);
  });
  it('another user\'s ADMIN row, an empty list and no viewer are not a yes', () => {
    expect(orgRoleCanManage([member('u2', 'ADMIN')], 'u1')).toBe(false);
    expect(orgRoleCanManage([], 'u1')).toBe(false);
    expect(orgRoleCanManage(null, 'u1')).toBe(false);
    expect(orgRoleCanManage([member('u1', 'ADMIN')], null)).toBe(false);
  });
});

describe('aiConfigCanManage (portal#2567)', () => {
  const person = { ownerIsPerson: true, userId: 'u1' } as const;
  it('a person\'s App or Agent: only a server-known manage flag, acting as themselves', () => {
    expect(aiConfigCanManage({ ...person, canManageFlag: true })).toBe(true);
    expect(aiConfigCanManage({ ...person, canManageFlag: false })).toBe(false);
    // Unknown is read-only: the flag read failed or has not arrived.
    expect(aiConfigCanManage({ ...person, canManageFlag: null })).toBe(false);
    expect(aiConfigCanManage({ ...person })).toBe(false);
  });
  it('a person\'s thing while impersonating is read-only (cor:acl:100:02)', () => {
    expect(aiConfigCanManage({ ...person, canManageFlag: true, impersonating: true })).toBe(false);
  });
  it('a platform admin on someone\'s personal Agent is read-only even when effectiveAccess says manage', () => {
    expect(aiConfigCanManage({ ...person, canManageFlag: true, platformAdmin: true })).toBe(false);
  });
  it('an organization\'s App or Agent follows the viewer\'s org role whatever the flag says', () => {
    const org = { ownerIsPerson: false, userId: 'u1' } as const;
    expect(aiConfigCanManage({ ...org, orgMembers: [member('u1', 'ADMIN')], canManageFlag: false })).toBe(true);
    expect(aiConfigCanManage({ ...org, orgMembers: [member('u1', 'OWNER')], canManageFlag: null })).toBe(true);
    expect(aiConfigCanManage({ ...org, orgMembers: [member('u1', 'CONTRIBUTOR')], canManageFlag: true })).toBe(false);
    expect(aiConfigCanManage({ ...org, orgMembers: [], canManageFlag: true })).toBe(false);
  });
  it('no signed-in viewer manages nothing', () => {
    expect(aiConfigCanManage({ ownerIsPerson: true, userId: null, canManageFlag: true })).toBe(false);
  });
});
