import { gqlClient } from '$lib/server/api';
import { loadRulebook, loadTemplates } from './service';
import { fetchAllItems } from '$lib/server/paginate';
import type { OwnerType } from '$lib/memory-config/types';
import { extractGqlErrorCode } from '$lib/gql-error';
import { APP_VIEWER_MANAGES_QUERY, SELF_CAN_MANAGE_QUERY } from '$lib/server/queries';
const TEMPLATE_OWNER_ADDRESS = /* GraphQL */ `
query TemplateOwnerAddress($ref: ID!) {
  organization(ref: $ref) {
    urn
  }
}
`;
const CHOICES = /* GraphQL */ `
query ConfigMemoryChoices($limit: Int, $offset: Int) {
  memories(limit: $limit, offset: $offset) {
    total
    items {
      id
      name
      urn
    }
  }
}
`;
export async function memoryChoices(token: string | null) {
  try {
    const items = await fetchAllItems<{ id: string; name: string; urn: string | null }>(gqlClient(token), CHOICES, 'memories');
    return { memories: items.filter((m): m is typeof m & { urn: string } => !!m.urn), memoriesFailed: false };
  } catch { return { memories: [], memoriesFailed: true }; }
}
export function principalScope(locals: App.Locals) {
  return `${locals.user?.id ?? 'none'}:${locals.impersonation?.sessionId ?? 'self'}`;
}
export async function rulesPageData(locals: App.Locals, memoryRef: string) {
  const config = await loadRulebook(gqlClient(locals.token), memoryRef);
  return { config, ...(config ? await memoryChoices(locals.token) : { memories: [], memoriesFailed: false }), readOnly: !!locals.impersonation, principalScope: principalScope(locals) };
}
export async function templatesPageData(locals: App.Locals, ownerType: OwnerType, ownerRef: string) {
  const templates = await loadTemplates(gqlClient(locals.token), ownerType, ownerRef);
  let canManage = ownerType === 'USER' && ownerRef === locals.user?.id;
  if (ownerType === 'APP') {
    const result = await gqlClient(locals.token).request<{ app: { viewerManages: boolean } | null }>(APP_VIEWER_MANAGES_QUERY, { ref: ownerRef }).catch((e: unknown) => {
      if (['FORBIDDEN', 'APP_NOT_FOUND', 'NOT_FOUND'].includes(extractGqlErrorCode(e) ?? '')) return { app: null };
      throw e;
    });
    canManage = result.app?.viewerManages ?? false;
  }
  if (ownerType === 'ORGANIZATION' && locals.user) {
    const result = await gqlClient(locals.token).request<{ organization: { urn: string } | null }>(TEMPLATE_OWNER_ADDRESS, { ref: ownerRef });
    if (result.organization) canManage = (await gqlClient(locals.token).request<{ effectiveAccess: { canManage: boolean } }>(SELF_CAN_MANAGE_QUERY, { user: locals.user.id, resource: result.organization.urn })).effectiveAccess.canManage;
  }
  return { templates, ownerType, ownerRef, canManage, readOnly: !!locals.impersonation, principalScope: principalScope(locals), ...await memoryChoices(locals.token) };
}
