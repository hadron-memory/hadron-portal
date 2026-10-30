import { expect, it } from 'vitest';
// Load config at runtime so this test does not pull JS build configuration into svelte-check.
const config = (await import(/* @vite-ignore */ new URL('../../svelte.config.js', import.meta.url).href)).default;
it('#1470 grants only the challenge origin in script and frame CSP', () => {
  const directives = config.kit.csp.directives;
  expect(directives['script-src']).toEqual(['self', 'https://challenges.cloudflare.com']);
  expect(directives['frame-src']).toEqual(['self', 'https://challenges.cloudflare.com']);
  expect(directives['default-src']).toEqual(['self']);
  expect(directives['form-action']).toEqual(['self']);
});
