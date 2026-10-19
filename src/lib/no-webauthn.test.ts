import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * portal#1091 (and cor:dmo:130:08) — the portal never runs a passkey ceremony.
 * Registration, sign-in's second factor and node signing all happen on
 * server-hosted pages; the portal only links to them and resumes after. A
 * source-level pin, because the failure it guards is an addition nobody
 * notices: a WebAuthn call in a component would pass every behavioural test
 * here (jsdom has no authenticator) and quietly make the portal a second
 * ceremony surface.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const WEBAUTHN = /navigator\.credentials|PublicKeyCredential|@simplewebauthn|startAuthentication\s*\(|startRegistration\s*\(/;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(svelte|ts|js)$/.test(name) && path !== SELF ? [path] : [];
  });
}

describe('no WebAuthn in the portal (portal#1091)', () => {
  it('finds the source tree', () => {
    // Guard against a vacuous pass: an empty walk would match nothing.
    expect(sources(SRC).length).toBeGreaterThan(100);
  });

  it('calls no WebAuthn API anywhere under src/', () => {
    const hits = sources(SRC).filter((path) => WEBAUTHN.test(readFileSync(path, 'utf8')));
    expect(hits.map((path) => relative(SRC, path))).toEqual([]);
  });
});
