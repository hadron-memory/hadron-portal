/**
 * portal#1474 item 4: the two bot-check sentences a person sees go through the
 * `t()` boundary (hrn:node:hadronmemory.com:hadron-portal:review:user-strings-through-t-helper),
 * with the English text unchanged.
 */
import { describe, expect, it, vi } from 'vitest';

const t = vi.fn((id: string, text: string) => `${id}|${text}`);
vi.mock('$lib/i18n/t', () => ({ t: (id: string, text: string) => t(id, text) }));
const { botCheckMessage } = await import('./turnstile');

describe('botCheckMessage goes through t()', () => {
  it.each(['missing_token', 'invalid_token'])('%s asks for the check again', (reason) => {
    expect(botCheckMessage(reason)).toBe('auth.bot-check.retry|Complete the check and try again.');
  });
  it.each(['provider_unavailable', 'not_configured', undefined, 42])('anything else (%s) says sign-in is unavailable', (reason) => {
    expect(botCheckMessage(reason)).toBe('auth.bot-check.unavailable|Sign-in is temporarily unavailable. Please try again later.');
  });
});
