import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MEMORY_BY_ID_QUERY, MEMORY_FIELDS, MEMORY_OWNER_PUBLIC_ORG_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({
  gqlClient: () => ({ request: mockRequest }),
}));

import { load, type MemoryOwnerAttribution } from './+page.server';

const member = {
  id: 'org-1',
  name: 'Member Org',
  urn: 'hrn:org:member.test',
  members: [{ id: 'membership', role: 'ADMIN', user: { id: 'u1' } }],
};
const publicOrg = { id: 'org-1', name: 'Public Org', urn: 'hrn:org:public.test' };

beforeEach(() => {
  mockRequest.mockReset();
});

function ev(opts: {
  organizationId?: string | null;
  memoryUrn?: string | null;
  memoryClass?: string;
  agent?: { id: string; name: string } | null;
  org?: typeof member | null;
  organization?: { id: string; name: string; urn: string } | null;
  orgReadFailed?: boolean;
} = {}) {
  const organizationId = opts.organizationId === undefined ? 'org-1' : opts.organizationId;
  return {
    parent: async () => ({
      graph: {
        id: 'mem-1',
        urn: opts.memoryUrn === undefined ? 'hrn:mem:acme.com:docs' : opts.memoryUrn,
        name: 'Docs',
        class: opts.memoryClass ?? 'org',
        agent: opts.agent ?? null,
        organizationId,
        organization: opts.organization,
      },
      org: opts.org ?? null,
      orgReadFailed: opts.orgReadFailed ?? false,
    }),
    locals: { token: 'test-token' },
  } as unknown as Parameters<typeof load>[0];
}

async function infoData(event: Parameters<typeof load>[0]): Promise<{
  ownerAttribution: MemoryOwnerAttribution | null;
}> {
  return (await load(event)) as { ownerAttribution: MemoryOwnerAttribution | null };
}

describe('memory Info owner attribution (#1846 slice A)', () => {
  it('uses the member identity without another organization lookup', async () => {
    const data = await infoData(ev({ org: member }));
    expect(data.ownerAttribution).toEqual({
      id: 'org-1', name: 'Member Org', urn: 'hrn:org:member.test', source: 'member',
    });
    expect(data.ownerAttribution).not.toBe(member);
    expect(data.ownerAttribution).not.toHaveProperty('members');
    expect(data).not.toHaveProperty('org');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('keeps member attribution for a legacy memory URN', async () => {
    const data = await infoData(ev({ org: member, memoryUrn: 'acme.com::docs' }));
    expect(data.ownerAttribution).toEqual({
      id: 'org-1', name: 'Member Org', urn: 'hrn:org:member.test', source: 'member',
    });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('uses the known organization id for public attribution when a legacy URN has no v2 fallback', async () => {
    mockRequest.mockResolvedValue({ publicOrganization: publicOrg });
    const data = await infoData(ev({ memoryUrn: 'hrn:memory:acme.com::docs' }));
    expect(data.ownerAttribution).toEqual({ ...publicOrg, source: 'public' });
    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(MEMORY_OWNER_PUBLIC_ORG_QUERY, { ref: 'org-1' });
  });

  it('preserves disclosed member attribution when member hydration fails', async () => {
    const organization = { id: 'org-1', name: 'Member Org', urn: 'hrn:org:member.test' };
    const data = await infoData(ev({ organization, orgReadFailed: true }));
    expect(data.ownerAttribution).toEqual({ ...organization, source: 'member' });
    expect(MEMORY_FIELDS).toContain('organization { id name }');
    expect(MEMORY_BY_ID_QUERY).toContain('organization { urn }');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('uses only the sanitized public projection for a discoverable non-member', async () => {
    mockRequest.mockResolvedValue({
      publicOrganization: { ...publicOrg, listedOnMarketplace: true, publicMemories: [{ id: 'private-projection' }] },
    });
    const data = await infoData(ev());
    expect(data.ownerAttribution).toEqual({ ...publicOrg, source: 'public' });
    expect(data.ownerAttribution).not.toHaveProperty('members');
    expect(data.ownerAttribution).not.toHaveProperty('listedOnMarketplace');
    expect(data.ownerAttribution).not.toHaveProperty('publicMemories');
    expect(data).not.toHaveProperty('org');
    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(MEMORY_OWNER_PUBLIC_ORG_QUERY, { ref: 'org-1' });
  });

  it.each([{ publicThrows: false }, { publicThrows: true }])(
    'falls back to the canonical memory-root URN when public attribution is unavailable (%s)',
    async ({ publicThrows }) => {
      if (publicThrows) mockRequest.mockImplementation(async () => { throw new Error('denied'); });
      else mockRequest.mockResolvedValue({ publicOrganization: null });
      const data = await infoData(ev());
      expect(data.ownerAttribution).toEqual({ urn: 'hrn:org:acme.com', source: 'memory-urn' });
      expect(data.ownerAttribution).not.toHaveProperty('name');
    },
  );

  it('fails closed to no attribution for malformed or missing memory identity', async () => {
    mockRequest.mockResolvedValue({ publicOrganization: null });
    expect((await infoData(ev({ memoryUrn: 'hrn:node:acme.com:docs:tasks:one' }))).ownerAttribution).toBeNull();
    expect((await infoData(ev({ memoryUrn: 'not-a-memory-urn' }))).ownerAttribution).toBeNull();
    expect((await infoData(ev({ memoryUrn: null }))).ownerAttribution).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('makes no organization call and returns no company attribution for a null owner id', async () => {
    const data = await infoData(ev({ organizationId: null, org: member }));
    expect(data.ownerAttribution).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('does not fetch company attribution that a system-agent Owner row ignores', async () => {
    const data = await infoData(ev({ memoryClass: 'system', agent: { id: 'agent-1', name: 'Agent' } }));
    expect(data.ownerAttribution).toBeNull();
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it.each(['personal', 'private'])('attributes an org-anchored %s memory to its company', async (memoryClass) => {
    mockRequest.mockResolvedValue({ publicOrganization: publicOrg });
    const data = await infoData(ev({ memoryClass }));
    expect(data.ownerAttribution).toEqual({ ...publicOrg, source: 'public' });
    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(MEMORY_OWNER_PUBLIC_ORG_QUERY, { ref: 'org-1' });
  });

  it('keeps attribution for a system-class memory whose agent link is detached', async () => {
    mockRequest.mockResolvedValue({ publicOrganization: publicOrg });
    const data = await infoData(ev({ memoryClass: 'system', agent: null }));
    expect(data.ownerAttribution).toEqual({ ...publicOrg, source: 'public' });
  });

  it('selects exactly id, name and URN from the sanitized public organization', () => {
    expect(MEMORY_OWNER_PUBLIC_ORG_QUERY).toContain('publicOrganization(ref: $ref)');
    for (const field of ['id', 'name', 'urn']) {
      expect(MEMORY_OWNER_PUBLIC_ORG_QUERY).toMatch(new RegExp(`\\b${field}\\b`));
    }
    for (const field of ['members', 'role', 'publicMemories', 'publicAgents', 'listedOnMarketplace', 'apps', 'billing']) {
      expect(MEMORY_OWNER_PUBLIC_ORG_QUERY).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});
