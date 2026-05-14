/**
 * Spec 014 T025 — /app/dashboard redirector tests (FR-007 / US4).
 *
 * The dashboard load relies on the layout's resolved activeOrgId. With
 * an active org, it 302s to /app/orgs/<id>/. Without one (defensive),
 * it 303s to /app/orgs/.
 */
import { describe, expect, it } from 'vitest';

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev(activeOrgId: string | null) {
  return {
    parent: async () => ({ activeOrgId }),
  } as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('/app/dashboard redirector', () => {
  it('302s to /app/orgs/<active>/ when an active org resolved', async () => {
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev('org-personal'));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(302);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-personal/');
  });

  it('302s to a visible org when one is resolved as active (matches URL or lastActive resolution)', async () => {
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev('org-visible-A'));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(302);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-visible-A/');
  });

  it('303s to /app/orgs/ when no active org could be resolved (defensive)', async () => {
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev(null));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(303);
    expect((thrown as { location: string }).location).toBe('/app/orgs/');
  });
});
