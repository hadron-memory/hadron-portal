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
 * `parent()` first saw the cleared token every time. Cookie disposal applies only to explicit auth refusals (#1120); the
 * mid-request mutation remains forbidden.
 */
import { ClientError } from 'graphql-request';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
});

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
  it('an explicit HTTP 401 drops the session cookie', async () => {
    mockRequest.mockRejectedValueOnce(new ClientError({ status: 401, headers: new Headers(), body: undefined }, { query: 'query Me' }));
    const ev = event();
    expect(await rootLoad(ev)).toEqual({ user: null, sessionCleared: true });
    expect(ev.deleted).toEqual(['hadron_token']);
  });

  it('a `me` of null drops nothing and says so: no sessionCleared (Atilla P2-2)', async () => {
    mockRequest.mockResolvedValueOnce({ me: null });
    const ev = event();
    expect(await rootLoad(ev)).toEqual({ user: null });
    expect(ev.deleted).toEqual([]);
  });

  it('does not clear locals.token or locals.user for the loads still running', async () => {
    mockRequest.mockRejectedValueOnce(new ClientError({ status: 401, headers: new Headers(), body: undefined }, { query: 'query Me' }));
    const ev = event();
    await rootLoad(ev);
    expect(ev.locals.token).toBe('tok');
    expect(ev.locals.user).toEqual({ id: 'u1', roles: ['user'] });
  });

  it('under impersonation, 401 drops the impersonation cookie but not locals.impersonation', async () => {
    mockRequest.mockRejectedValueOnce(new ClientError({ status: 401, headers: new Headers(), body: undefined }, { query: 'query Me' }));
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


describe('#1120: transient Me failures preserve credentials and answer 503', () => {
  const upstream = (status: number, code?: string) => new ClientError(
    { status, headers: new Headers(), body: undefined, ...(code ? { errors: [{ message: 'upstream detail', extensions: { code } }] } : {}) },
    { query: 'query Me', variables: { privateValue: 'must-not-be-returned' } },
  );

  for (const impersonating of [false, true]) {
    it.each([
      ['HTTP 500', () => upstream(500)],
      ['HTTP 502', () => upstream(502)],
      ['network failure', () => new TypeError('fetch failed')],
      ['internal GraphQL error', () => upstream(200, 'INTERNAL_SERVER_ERROR')],
      ['unknown GraphQL error', () => upstream(200, 'UNKNOWN')],
      ['permission refusal', () => upstream(403, 'FORBIDDEN')],
      ['untyped auth-like message', () => new Error('UNAUTHENTICATED')],
    ])('%s (impersonating=' + impersonating + ') retains cookies, then recovers', async (_label, failure) => {
      const ev = event(impersonating);
      const before = structuredClone(ev.locals);
      mockRequest.mockRejectedValueOnce(failure());
      await expect(rootLoad(ev)).rejects.toMatchObject({
        status: 503,
        body: { message: 'Unable to verify your sign-in. Please try again.' },
      });
      expect(ev.deleted).toEqual([]);
      expect(ev.locals).toEqual(before);
      const user = { id: 'u1' };
      mockRequest.mockResolvedValueOnce({ me: user });
      expect(await rootLoad(ev)).toEqual({ user });
      expect(ev.deleted).toEqual([]);
    });

    it('typed UNAUTHENTICATED clears only the active cookie (impersonating=' + impersonating + ')', async () => {
      const ev = event(impersonating);
      const before = structuredClone(ev.locals);
      mockRequest.mockRejectedValueOnce(upstream(200, 'UNAUTHENTICATED'));
      expect(await rootLoad(ev)).toEqual({ user: null, sessionCleared: true });
      expect(ev.deleted).toEqual([impersonating ? 'hadron_impersonation' : 'hadron_token']);
      expect(ev.locals).toEqual(before);
    });
  }
});
