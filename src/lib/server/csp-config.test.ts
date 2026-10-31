/**
 * #1470 — the CSP in svelte.config.js lets Cloudflare Turnstile in and widens
 * nothing else. Reads the real config, so loosening it elsewhere fails here.
 */
import { describe, expect, it } from 'vitest';

// Loaded by a computed path so svelte-check does not pull the JS config into
// its type pass (it types `['ws:', 'wss:']` too loosely for `Source`).
const CONFIG_PATH = '../../../svelte.config.js';
const { default: config } = (await import(/* @vite-ignore */ CONFIG_PATH)) as {
  default: { kit?: { csp?: { mode?: string; directives?: Record<string, string[]> } } };
};

const directives = config.kit?.csp?.directives ?? {};
const CF = 'https://challenges.cloudflare.com';

describe('svelte.config.js CSP (#1470)', () => {
  it('adds exactly the Turnstile origin to script-src and frame-src', () => {
    expect(directives['script-src']).toEqual(['self', CF]);
    expect(directives['frame-src']).toEqual([CF]);
  });

  it('keeps nonces on (mode auto) and never allows unsafe-inline scripts', () => {
    expect(config.kit?.csp?.mode).toBe('auto');
    expect(directives['script-src']).not.toContain('unsafe-inline');
  });

  it('does not name the Turnstile origin in any other directive', () => {
    for (const [name, sources] of Object.entries(directives)) {
      if (name === 'script-src' || name === 'frame-src') continue;
      expect(sources, name).not.toContain(CF);
    }
  });
});
