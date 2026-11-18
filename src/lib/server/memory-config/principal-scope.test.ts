import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/api', () => ({ gqlClient: vi.fn() }));

import { principalScope } from './page-data';

describe('memory-config principal scope derivation (#1749 B1)', () => {
  it('changes when the signed-in user changes', () => {
    const first = principalScope({ user: { id: 'user-1' }, impersonation: null } as never);
    const second = principalScope({ user: { id: 'user-2' }, impersonation: null } as never);
    expect(first).toBe('user-1:self');
    expect(second).toBe('user-2:self');
    expect(second).not.toBe(first);
  });

  it('changes when the impersonation session changes', () => {
    const first = principalScope({ user: { id: 'user-1' }, impersonation: { sessionId: 'session-1' } } as never);
    const second = principalScope({ user: { id: 'user-1' }, impersonation: { sessionId: 'session-2' } } as never);
    expect(first).toBe('user-1:session-1');
    expect(second).toBe('user-1:session-2');
    expect(second).not.toBe(first);
  });
});
