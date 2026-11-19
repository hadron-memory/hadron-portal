import { error } from '@sveltejs/kit';
import { gqlClient } from '$lib/server/api';
import { PUBLIC_ORGANIZATION_AGENTS_QUERY, PUBLIC_ORGANIZATION_MEMORIES_QUERY } from '$lib/server/queries';
import type { PublicOrganization, PublicResourceRefsPage } from '$lib/types';
import { parsePublicOrgLimit, parsePublicOrgOffset } from './paging';
import type { PageServerLoad } from './$types';

type PublicOrganizationScalars = Pick<PublicOrganization, 'id' | 'name' | 'urn' | 'listedOnMarketplace'>;
type ProfileResponse<PageKey extends 'publicMemoriesPage' | 'publicAgentsPage'> = {
  publicOrganization: (PublicOrganizationScalars & Record<PageKey, PublicResourceRefsPage>) | null;
};

/**
 * #1846 slice B — a signed-in non-member's sanitized organization profile.
 * `params.id` is a server ref (id or URN). The server's discoverability gate
 * returns null for missing and non-discoverable organizations alike. Transport
 * and GraphQL failures deliberately propagate as 500s, never false 404s.
 *
 * Each kind has one independent bounded request; there is no full-array
 * auto-drain, count-only follow-up, or cross-kind snapshot claim. Promise.all
 * preserves either failure for the route's error/Retry surface.
 */
export const load: PageServerLoad = async ({ params, locals, url }) => {
  const paging = {
    memories: {
      limit: parsePublicOrgLimit(url.searchParams.get('memoriesLimit')),
      offset: parsePublicOrgOffset(url.searchParams.get('memoriesOffset')),
    },
    agents: {
      limit: parsePublicOrgLimit(url.searchParams.get('agentsLimit')),
      offset: parsePublicOrgOffset(url.searchParams.get('agentsOffset')),
    },
  };
  const client = gqlClient(locals.token);
  const [memoryResult, agentResult] = await Promise.all([
    client.request<ProfileResponse<'publicMemoriesPage'>>(PUBLIC_ORGANIZATION_MEMORIES_QUERY, {
      ref: params.id,
      limit: paging.memories.limit,
      offset: paging.memories.offset,
    }),
    client.request<ProfileResponse<'publicAgentsPage'>>(PUBLIC_ORGANIZATION_AGENTS_QUERY, {
      ref: params.id,
      limit: paging.agents.limit,
      offset: paging.agents.offset,
    }),
  ]);

  const memoryOrganization = memoryResult.publicOrganization;
  const agentOrganization = agentResult.publicOrganization;
  if (!memoryOrganization || !agentOrganization) {
    throw error(404, 'Organization not found');
  }

  const organization: PublicOrganization = {
    id: memoryOrganization.id,
    name: memoryOrganization.name,
    urn: memoryOrganization.urn,
    listedOnMarketplace: memoryOrganization.listedOnMarketplace,
    publicMemoriesPage: memoryOrganization.publicMemoriesPage,
    publicAgentsPage: agentOrganization.publicAgentsPage,
  };
  return { organization, paging, path: url.pathname, search: url.search };
};
