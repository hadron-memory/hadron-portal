import { describe, it, expect } from 'vitest';
import { shouldOfferSharedScope } from './agent-chat-scope.js';

describe('shouldOfferSharedScope', () => {
  it('returns false when the user has no AppMember rows', () => {
    expect(
      shouldOfferSharedScope({ agentId: 'agent-1', appMemberships: [] }),
    ).toBe(false);
  });

  it('returns false when no AppMember row matches the agent', () => {
    expect(
      shouldOfferSharedScope({
        agentId: 'agent-1',
        appMemberships: [
          { appId: 'app-X', agentId: 'agent-2' },
          { appId: 'app-Y', agentId: 'agent-3' },
        ],
      }),
    ).toBe(false);
  });

  it('returns true when at least one AppMember row matches the agent', () => {
    expect(
      shouldOfferSharedScope({
        agentId: 'agent-1',
        appMemberships: [
          { appId: 'app-X', agentId: 'agent-2' },
          { appId: 'app-Y', agentId: 'agent-1' },
        ],
      }),
    ).toBe(true);
  });

  it('ignores AppMember rows whose agentId is null (App has no linked agent yet)', () => {
    expect(
      shouldOfferSharedScope({
        agentId: 'agent-1',
        appMemberships: [{ appId: 'app-X', agentId: null }],
      }),
    ).toBe(false);
  });

  it('handles a single matching AppMember row', () => {
    expect(
      shouldOfferSharedScope({
        agentId: 'agent-1',
        appMemberships: [{ appId: 'app-X', agentId: 'agent-1' }],
      }),
    ).toBe(true);
  });
});
