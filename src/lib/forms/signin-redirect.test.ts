import { describe, expect, it } from 'vitest';
import { signinRedirectLocation } from './signin-redirect';

describe('signinRedirectLocation (#974)', () => {
  it('names the guard’s sign-in redirect', () => {
    expect(signinRedirectLocation({ type: 'redirect', status: 303, location: '/signin?redirect=%2Fapp' })).toBe('/signin?redirect=%2Fapp');
  });
  it('ignores any other redirect and every non-redirect result', () => {
    expect(signinRedirectLocation({ type: 'redirect', status: 303, location: '/app/x' })).toBeNull();
    expect(signinRedirectLocation({ type: 'success', status: 200 })).toBeNull();
    expect(signinRedirectLocation({ type: 'failure', status: 400 })).toBeNull();
  });
});
