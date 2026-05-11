/**
 * Spec 014 T008 — /app/apps redirector tests (FR-008 / R-4).
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

describe('/app/apps redirector', () => {
  it('302s to /app/orgs/<active>/apps when an active org resolved', async () => {
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev('org-b'));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(302);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-b/apps');
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
