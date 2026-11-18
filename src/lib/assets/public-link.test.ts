/**
 * #1131 — what the portal does with the server's public-link signals, and the
 * fixed copy for a refused switch.
 */
import { describe, expect, it } from 'vitest';
import { canSwitchPublicLink } from './public-link';
import { publicLinkErrorMessage } from './error-messages';

describe('canSwitchPublicLink', () => {
  it('needs the server to say the reader may manage it AND the deployment to serve links', () => {
    expect(canSwitchPublicLink({ canManagePublicLink: true, publicLinkAvailable: true })).toBe(true);
    // A manager on a deployment with the outer gate off: no control, whatever the flag says.
    expect(canSwitchPublicLink({ canManagePublicLink: true, publicLinkAvailable: false, publicLinkEnabled: true })).toBe(false);
    // A deployment that serves links, for a reader the server does not let manage it.
    expect(canSwitchPublicLink({ canManagePublicLink: false, publicLinkAvailable: true })).toBe(false);
  });

  it('hides the control when a signal is absent, never offering one nobody vouched for', () => {
    expect(canSwitchPublicLink({})).toBe(false);
    expect(canSwitchPublicLink({ canManagePublicLink: true })).toBe(false);
    expect(canSwitchPublicLink({ publicLinkAvailable: true })).toBe(false);
    expect(canSwitchPublicLink({ canManagePublicLink: 'true', publicLinkAvailable: 1 } as never)).toBe(false);
  });
});

describe('publicLinkErrorMessage', () => {
  it('gives one fixed sentence for NOT_FOUND and PERMISSION_DENIED, so a refusal cannot tell them apart', () => {
    const denied = publicLinkErrorMessage('PERMISSION_DENIED');
    expect(publicLinkErrorMessage('NOT_FOUND')).toBe(denied);
    expect(publicLinkErrorMessage('FORBIDDEN')).toBe(denied);
    expect(denied).toMatch(/was not changed/i);
  });

  it('asks a signed-out reader to sign in', () => {
    expect(publicLinkErrorMessage('UNAUTHENTICATED')).toMatch(/sign in/i);
    expect(publicLinkErrorMessage('SESSION_EXPIRED')).toMatch(/sign in/i);
  });

  it('answers an unknown or missing code with the generic failure, and says the link may not have changed', () => {
    for (const code of [undefined, 'INTERNAL', 'SOMETHING_NEW']) {
      expect(publicLinkErrorMessage(code)).toMatch(/may not have changed/i);
    }
  });

  it('does not treat an inherited Object.prototype key as a known code', () => {
    for (const code of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(typeof publicLinkErrorMessage(code)).toBe('string');
      expect(publicLinkErrorMessage(code)).toMatch(/may not have changed/i);
    }
  });
});
