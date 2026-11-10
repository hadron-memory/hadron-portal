import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parse, visit } from 'graphql';
import { PUBLIC_ORGANIZATION_PROFILE_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
const mockToken = vi.fn();

vi.mock('$lib/server/api', () => ({
  gqlClient: (token: string) => {
    mockToken(token);
    return { request: (...args: unknown[]) => mockRequest(...args) };
  },
}));

import { load } from './+page.server';

const organization = {
  id: 'org-1',
  name: 'Public Org',
  urn: 'hrn:org:public.test',
  listedOnMarketplace: true,
  publicMemories: [
    { id: 'mem-1', name: 'Public Docs', urn: 'hrn:mem:public.test:docs', description: 'Read me' },
  ],
  publicAgents: [
    { id: 'agent-1', name: 'Public Helper', urn: 'hrn:agent:public.test:helper', description: null },
  ],
};

beforeEach(() => {
  mockRequest.mockReset();
  mockToken.mockReset();
});

function ev(id: string) {
  return {
    params: { id },
    locals: { user: { id: 'u1', roles: ['user'] }, token: 'test-token' },
  } as unknown as Parameters<typeof load>[0];
}

describe('/app/org/[id] sanitized public organization loader (#1846 slice B)', () => {
  it('returns only PublicOrganization and forwards an id or URN ref with the caller token', async () => {
    mockRequest.mockResolvedValueOnce({ publicOrganization: organization });
    await expect(load(ev('hrn:org:public.test'))).resolves.toEqual({ organization });
    expect(mockToken).toHaveBeenCalledExactlyOnceWith('test-token');
    expect(mockRequest).toHaveBeenCalledExactlyOnceWith(PUBLIC_ORGANIZATION_PROFILE_QUERY, {
      ref: 'hrn:org:public.test',
    });
  });

  it('gives missing and non-discoverable organizations the same neutral 404', async () => {
    const errors: Array<{ status: number; body?: { message?: string } }> = [];
    for (const ref of ['missing-org', 'private-org']) {
      mockRequest.mockResolvedValueOnce({ publicOrganization: null });
      try {
        await load(ev(ref));
        throw new Error('expected a 404');
      } catch (e) {
        errors.push(e as (typeof errors)[number]);
      }
    }
    expect(errors.map((e) => e.status)).toEqual([404, 404]);
    expect(errors[0].body?.message).toBe('Organization not found');
    expect(errors[1].body?.message).toBe(errors[0].body?.message);
  });

  it('does not turn a transient public-profile failure into a false 404', async () => {
    mockRequest.mockRejectedValueOnce(new Error('temporary outage'));
    await expect(load(ev('org-1'))).rejects.toThrow('temporary outage');
  });

  it('selects exactly the closed PublicOrganization and PublicResourceRef fields', () => {
    const selections: Record<string, string[]> = {};
    visit(parse(PUBLIC_ORGANIZATION_PROFILE_QUERY), {
      Field(node) {
        if (node.name.value === 'publicOrganization') {
          selections.organization = node.selectionSet?.selections.map((s) => s.kind === 'Field' ? s.name.value : '<non-field>') ?? [];
        }
        if (node.name.value === 'publicMemories' || node.name.value === 'publicAgents') {
          selections[node.name.value] = node.selectionSet?.selections.map((s) => s.kind === 'Field' ? s.name.value : '<non-field>') ?? [];
        }
      },
    });
    expect(selections).toEqual({
      organization: ['id', 'name', 'urn', 'listedOnMarketplace', 'publicMemories', 'publicAgents'],
      publicMemories: ['id', 'name', 'urn', 'description'],
      publicAgents: ['id', 'name', 'urn', 'description'],
    });
    expect(PUBLIC_ORGANIZATION_PROFILE_QUERY).not.toMatch(/\borganization\s*\(/);
    for (const forbidden of ['members', 'apps', 'billing', 'credentials', 'subscriptions', 'exchangeConnections']) {
      expect(PUBLIC_ORGANIZATION_PROFILE_QUERY).not.toMatch(new RegExp(`\\b${forbidden}\\b`));
    }
  });
});
