import { describe, expect, it } from 'vitest';
import { cloneRefusal, eligibleCloneTargets, showCloneEntry } from './clone';

const org = (id: string, members: Array<[string, string]>) => ({
  id, urn: `hrn:org:x:${id}`, name: id,
  members: members.map(([uid, role]) => ({ id: `${id}-${uid}`, role, user: { id: uid } })),
});

describe('eligibleCloneTargets', () => {
  it('keeps only orgs where the caller is OWNER or ADMIN (a hint, the server decides)', () => {
    const orgs = [org('a', [['me', 'OWNER']]), org('b', [['me', 'ADMIN']]), org('c', [['me', 'MEMBER']]), org('d', [['other', 'OWNER']])];
    expect(eligibleCloneTargets(orgs as never, 'me').map((o) => o.id)).toEqual(['a', 'b']);
  });
  it('is empty without a caller id', () => {
    expect(eligibleCloneTargets([org('a', [['me', 'OWNER']])] as never, null)).toEqual([]);
  });
});

describe('showCloneEntry', () => {
  it.each([
    ['PUBLIC', false, 1, true],
    ['PERSONAL', true, 1, true],
    ['PERSONAL', false, 1, false],
    ['PUBLIC', false, 0, false],
    ['PERSONAL', true, 0, false],
  ])('visibility %s managed %s eligible %i -> %s', (visibility, canManage, n, want) => {
    expect(showCloneEntry({ visibility, canManage, eligibleCount: n })).toBe(want);
  });
});

function gql(code: string, extra: Record<string, unknown> = {}) {
  return { response: { errors: [{ message: 'RAW SERVER TEXT', extensions: { code, ...extra } }] } };
}

describe('cloneRefusal', () => {
  it.each([
    'AGENT_NOT_PUBLIC', 'CLONE_LINKED_MEMORY_ENCRYPTED', 'CLONE_LINKED_MEMORY_UNREADABLE',
    'CLONE_BASE_UNUSABLE', 'CLONE_IMPORT_UNUSABLE', 'CLONE_ENCRYPTED_CONTENT', 'CLONE_TARGET_UNSUPPORTED',
  ])('%s maps to its own localized message, never the raw server text', (code) => {
    const r = cloneRefusal(gql(code));
    expect(r.text).toBeTruthy();
    expect(r.text).not.toContain('RAW SERVER TEXT');
    expect(r.field).toBeUndefined();
  });
  it('gives every typed code a distinct message', () => {
    const codes = ['AGENT_NOT_PUBLIC', 'CLONE_LINKED_MEMORY_ENCRYPTED', 'CLONE_LINKED_MEMORY_UNREADABLE', 'CLONE_BASE_UNUSABLE', 'CLONE_IMPORT_UNUSABLE', 'CLONE_ENCRYPTED_CONTENT', 'CLONE_TARGET_UNSUPPORTED'];
    expect(new Set(codes.map((c) => cloneRefusal(gql(c)).text)).size).toBe(codes.length);
  });
  it('AGENT_URN_TAKEN is a slug field error', () => {
    const r = cloneRefusal(gql('AGENT_URN_TAKEN'));
    expect(r.field).toBe('slug');
    expect(r.status).toBe(409);
  });
  it('CONFLICT with AGENT_CLONE_SOURCE_CHANGED says try again; other CONFLICT is generic', () => {
    expect(cloneRefusal(gql('CONFLICT', { reason: 'AGENT_CLONE_SOURCE_CHANGED' })).text).toMatch(/try again/i);
    expect(cloneRefusal(gql('CONFLICT', { reason: 'SOMETHING_ELSE' })).text).not.toMatch(/changed/i);
  });
  it('a not-found source renders as plain not-found (404)', () => {
    expect(cloneRefusal(gql('NOT_FOUND')).status).toBe(404);
  });
  it('blockers carry code, count, position, and a name only when present', () => {
    const r = cloneRefusal(gql('CLONE_IMPORT_UNUSABLE', {
      blockers: [{ code: 'IMPORT_NOT_LICENSED', count: 2, subjects: [{ position: 0, name: 'Shared base' }, { position: 3 }] }],
    }));
    expect(r.blockers).toEqual([{ code: 'IMPORT_NOT_LICENSED', count: 2, subjects: [{ position: 0, name: 'Shared base' }, { position: 3 }] }]);
  });
  it('drops malformed blocker entries and never passes unknown extension keys through', () => {
    const r = cloneRefusal(gql('CLONE_BASE_UNUSABLE', {
      secret: 'tok_123',
      blockers: [{ code: 7, count: 'x' }, null, { code: 'OK', count: 1, subjects: [{ position: 'a' }, { position: 1, name: 5 }] }],
    }));
    expect(JSON.stringify(r)).not.toContain('tok_123');
    expect(r.blockers).toEqual([{ code: 'OK', count: 1, subjects: [{ position: 1 }] }]);
  });
  it('an unknown error and a transport error get one fixed sanitized fallback with no payload', () => {
    const unknown = cloneRefusal(gql('SOMETHING_NEW', { leak: 'tok_123' }));
    const transport = cloneRefusal(new Error('fetch failed: Authorization: Bearer tok_123'));
    expect(unknown.text).toBe(transport.text);
    expect(JSON.stringify([unknown, transport])).not.toContain('tok_123');
    expect(unknown.status).toBe(503);
  });
});
