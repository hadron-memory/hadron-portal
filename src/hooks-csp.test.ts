import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('$app/environment', () => import('$lib/test/stubs/app-environment-ssr'));
// Kit's `sequence` reads a request store that only exists inside a running
// app. Compose the handles the same way (first wraps the rest) so the real
// exported `handle` still runs every hook in order.
vi.mock('@sveltejs/kit/hooks', () => ({
  sequence:
    (...hs: Array<(i: any) => Promise<Response>>) =>
    ({ event, resolve }: { event: unknown; resolve: (e: unknown) => Promise<Response> }) =>
      hs.reduceRight<(e: unknown) => Promise<Response>>(
        (next, h) => (e) => h({ event: e, resolve: next }),
        resolve,
      )(event),
}));

import { env } from '$env/dynamic/public';
import { handle } from './hooks.server';

// The pure helper is pinned in $lib/server/csp-handoff.test.ts. What those
// tests cannot see is whether the handle sequence CALLS it: replacing the
// append in runtimeCsp with a pass-through left 158 tests green (#2084,
// Gemma's mutant on #2081). So these drive the real exported `handle`.
const BASE = "default-src 'self'; form-action 'self'; frame-ancestors 'none'";

function event(): RequestEvent {
  const url = new URL('https://portal.synthetic.test/app/apps/a/grants');
  return {
    url,
    request: new Request(url, { method: 'GET' }),
    cookies: { get: () => undefined, delete: () => {}, serialize: () => '' },
    locals: {},
  } as unknown as RequestEvent;
}

async function cspFor(base: string | null): Promise<string | null> {
  const res = await handle({
    event: event(),
    resolve: async () => {
      const headers = new Headers();
      if (base) headers.set('content-security-policy', base);
      return new Response('ok', { headers });
    },
  });
  return res.headers.get('content-security-policy');
}

describe('runtime CSP wiring in the handle sequence (#2084)', () => {
  beforeEach(() => {
    delete env.PUBLIC_SERVER_URL;
  });

  it('adds the public server origin to form-action on a document response', async () => {
    env.PUBLIC_SERVER_URL = 'https://ceremony.synthetic.test/some/path';
    expect(await cspFor(BASE)).toBe(
      "default-src 'self'; form-action 'self' https://ceremony.synthetic.test; frame-ancestors 'none'",
    );
  });

  it('leaves the policy as emitted when no public server origin is configured', async () => {
    expect(await cspFor(BASE)).toBe(BASE);
  });

  it('adds no policy header to a response that had none', async () => {
    env.PUBLIC_SERVER_URL = 'https://ceremony.synthetic.test';
    expect(await cspFor(null)).toBeNull();
  });
});
