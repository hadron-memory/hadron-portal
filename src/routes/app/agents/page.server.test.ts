/**
 * Spec 014 T007 — /app/agents redirector tests (FR-008 / R-4).
 *
 * The load throws a SvelteKit redirect; we catch and assert on
 * `.status` and `.location`. Layout `parent()` is mocked to provide
 * `activeOrgId`.
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

describe('/app/agents redirector', () => {
  it('302s to /app/orgs/<active>/agents when an active org resolved', async () => {
    const load = await importLoad();
    let thrown: unknown;
    try {
      await load(ev('org-a'));
    } catch (e) {
      thrown = e;
    }
    expect((thrown as { status: number }).status).toBe(302);
    expect((thrown as { location: string }).location).toBe('/app/orgs/org-a/agents');
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
