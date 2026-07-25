/**
 * #647 — /app/agents is the org-less "My agents" list (was a spec-014
 * redirector). The loader returns the caller's own agents and distinguishes a
 * failed fetch from an empty list.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.spyOn(console, 'error').mockImplementation(() => {});

const fetchOwnedAgents = vi.fn();
vi.mock('$lib/server/personal-agents', () => ({
  fetchOwnedAgents: (...args: unknown[]) => fetchOwnedAgents(...args),
}));

async function importLoad() {
  const mod = await import('./+page.server');
  return mod.load;
}

function ev() {
  return { locals: { token: 'tok' } } as unknown as Parameters<Awaited<ReturnType<typeof importLoad>>>[0];
}

describe('/app/agents (My agents)', () => {
  beforeEach(() => fetchOwnedAgents.mockReset());

  it('returns the caller\'s own agents on success', async () => {
    const agents = [{ id: 'a1', urn: 'u', name: 'A', organizationId: null }];
    fetchOwnedAgents.mockResolvedValueOnce(agents);
    const load = await importLoad();
    const res = await load(ev());
    expect(res).toMatchObject({ agents, loadFailed: false });
  });

  it('surfaces a failed fetch as loadFailed (not a silent empty list)', async () => {
    fetchOwnedAgents.mockRejectedValueOnce(new Error('boom'));
    const load = await importLoad();
    const res = (await load(ev())) as { agents: unknown[]; loadFailed: boolean };
    expect(res.loadFailed).toBe(true);
    expect(res.agents).toEqual([]);
  });
});
