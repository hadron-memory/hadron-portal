/**
 * #1117 (Colin's WAIT FIX on #1119): the root layout must not change the
 * request's shared `locals`.
 *
 * SvelteKit runs this load in parallel with every other layout and page load
 * of the request, and they all read `locals`. When `me` failed, this load's
 * catch set `locals.token`, `locals.user` and `locals.impersonation` to null,
 * so whichever loader read them next saw a different request: the App layout
 * threw on `locals.user.id`, and the App detail loader asked for its org with
 * no token and answered 404 "Organization not found". A loader that awaits
 * `parent()` first saw the cleared token every time. The cookie disposal
 * stays (whether a 5xx should end the session is #1120's question); only the
 * mid-request mutation goes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => mockRequest.mockReset());

function event(impersonating = false) {
  const deleted: string[] = [];
  const locals = {
    token: 'tok',
    user: { id: 'u1', roles: ['user'] },
    impersonation: impersonating ? { adminId: 'admin-1' } : null,
  };
  return { locals, deleted, cookies: { delete: (name: string) => deleted.push(name) } };
}

async function rootLoad(ev: ReturnType<typeof event>) {
  const { load } = await import('./+layout.server');
  return load(ev as never);
}

describe('root layout: a failed `me` leaves the shared locals alone (#1117)', () => {
  it('returns no user and drops the session cookie, as before', async () => {
    mockRequest.mockRejectedValueOnce(new Error('HTTP 500'));
    const ev = event();
    expect(await rootLoad(ev)).toEqual({ user: null });
    expect(ev.deleted).toEqual(['hadron_token']);
  });

  it('does not clear locals.token or locals.user for the loads still running', async () => {
    mockRequest.mockRejectedValueOnce(new Error('HTTP 500'));
    const ev = event();
    await rootLoad(ev);
    expect(ev.locals.token).toBe('tok');
    expect(ev.locals.user).toEqual({ id: 'u1', roles: ['user'] });
  });

  it('under impersonation, drops the impersonation cookie but not locals.impersonation', async () => {
    mockRequest.mockRejectedValueOnce(new Error('HTTP 500'));
    const ev = event(true);
    await rootLoad(ev);
    expect(ev.deleted).toEqual(['hadron_impersonation']);
    expect(ev.locals.impersonation).toEqual({ adminId: 'admin-1' });
    expect(ev.locals.token).toBe('tok');
  });
});

describe('no route loader or action writes the auth locals (#1117)', () => {
  // hooks.server.ts sets them once per request, before any load runs. A write
  // from a route races every loader reading them, which is this bug's class.
  function* serverFiles(dir: string): Generator<string> {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) yield* serverFiles(path);
      else if (/\.server\.ts$/.test(name)) yield path;
    }
  }

  it('finds no assignment to locals.token, locals.user or locals.impersonation under src/routes', () => {
    const writes: string[] = [];
    for (const file of serverFiles('src/routes')) {
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (/\blocals\.(token|user|impersonation)\s*=(?!=)/.test(line)) writes.push(`${file}:${i + 1}`);
      });
    }
    expect(writes).toEqual([]);
  });
});
