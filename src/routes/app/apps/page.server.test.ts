/**
 * #647 — /app/apps is the org-less "My apps" list (was a spec-014 redirector).
 * The loader returns the caller's own apps and distinguishes a failed fetch from
 * an empty list.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'error').mockImplementation(() => {});

const fetchOwnedApps = vi.fn();
vi.mock('$lib/server/personal-apps', () => ({
  fetchOwnedApps: (...args: unknown[]) => fetchOwnedApps(...args),
}));

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev() {
  return { locals: { token: 'tok' } } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('/app/apps (My apps)', () => {
  beforeEach(() => fetchOwnedApps.mockReset());

  it('returns the caller\'s own apps on success', async () => {
    const apps = [{ id: 'p1', urn: 'u', name: 'P', organizationId: null }];
    fetchOwnedApps.mockResolvedValueOnce(apps);
    const load = await importLoad();
    const res = await load(ev());
    expect(res).toMatchObject({ apps, loadFailed: false });
  });

  it('surfaces a failed fetch as loadFailed (not a silent empty list)', async () => {
    fetchOwnedApps.mockRejectedValueOnce(new Error('boom'));
    const load = await importLoad();
    const res = (await load(ev())) as { apps: unknown[]; loadFailed: boolean };
    expect(res.loadFailed).toBe(true);
    expect(res.apps).toEqual([]);
  });
});
