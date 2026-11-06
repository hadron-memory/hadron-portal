// #1732 (Refs #1394): the stand-in layout in redirectWaitsForLayout.test.ts shows
// the ORDERING; this runs the REAL `src/routes/app/+layout.server.ts` load (only
// GraphQL mocked) as parent() of a real entry redirect, in parallel the way
// SvelteKit runs them, and asserts the layout's active-org `cookies.set` has
// happened by the time the redirect is thrown. SvelteKit's respond.js adds the
// cookies set so far to the redirect response (`add_cookies_to_headers(
// response.headers, new_cookies.values())` in the Redirect catch), so "in the
// jar when the redirect settles" is "Set-Cookie on the 3xx".
import { describe, it, expect, vi } from 'vitest';

let releaseGraphql!: () => void;
const graphqlGate = new Promise<void>((resolve) => { releaseGraphql = resolve; });

vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({
    request: async (query: string) => {
      await graphqlGate; // the layout's awaits: the cookie is written only after them
      if (query.includes('organizations(')) {
        const org = {
          id: 'org-1', name: 'Org 1', urn: 'org:org-1', githubInstallationId: null, githubAppId: null,
          hasGithubAppPrivateKey: false, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
          members: [{ id: 'm1', role: 'MEMBER', user: { id: 'user-1' } }],
        };
        return { organizations: { items: [org], total: 1 } };
      }
      return { me: { id: 'user-1', name: 'U', email: 'u@example.com', handle: 'u', avatarUrl: null } };
    },
  }),
}));

type Load = (e: unknown) => unknown;
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('the real app layout writes the active-org cookie before an entry redirect settles (#1732)', () => {
  it('orgs/[id]/ai-configs: Set-Cookie is in place on the 308', async () => {
    const layout = (await import('./+layout.server')).load as Load;
    const { load } = await import('./orgs/[id]/ai-configs/+page.server');
    const jar = new Map<string, string>();
    const cookies = {
      get: (n: string) => jar.get(n),
      set: (n: string, v: string) => { jar.set(n, v); },
      delete: (n: string) => { jar.delete(n); },
      getAll: () => [...jar.entries()].map(([name, value]) => ({ name, value })),
      serialize: (n: string, v: string) => `${n}=${v}`,
    };
    const locals = { user: { id: 'user-1', roles: ['user'], githubUsername: 'gh' }, token: 't' };
    const params = { id: 'org-1' };
    const url = new URL('http://localhost/app/orgs/org-1/ai-configs');
    // SvelteKit starts layout and page loads together; the page's parent() is the layout's promise.
    const layoutRun = (async () => layout({ locals, url, params, cookies, parent: async () => ({ user: { id: 'user-1' } }) }))();
    let cookieAtRedirect: string | undefined;
    let thrown: unknown;
    const pageRun = (async () => (load as Load)({ params, url, locals, parent: () => layoutRun }))()
      .catch((e) => { thrown = e; cookieAtRedirect = jar.get('hadron_active_org_user-1'); });
    await flush();
    expect(thrown).toBeUndefined(); // still waiting: the layout's GraphQL has not answered
    releaseGraphql();
    await pageRun;
    expect(thrown).toMatchObject({ status: 308, location: '/app/orgs/org-1/integrations' });
    expect(cookieAtRedirect).toBe('org-1');
  });
});
