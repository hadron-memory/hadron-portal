import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import { fetchAllItems } from '$lib/server/paginate';
import { t } from '$lib/i18n/t';
import { createAppMemorySchema } from './schema';

export interface AppMemoryRow { id: string; urn: string; name: string; description: string | null; appId: string | null }
export const CREATE_APP_MEMORY_MUTATION = /* GraphQL */ `
  mutation CreateAppMemory($appRef: ID!, $name: String!, $description: String) {
    createAppMemory(appRef: $appRef, name: $name, description: $description) { id urn name }
  }
`;
// No App memory projection exists yet (#2190). Ask for the caller-readable
// app-class slice of THIS org, drain every page before filtering by App id.
// This is not the Agent's memoryItems list or a claim about write permission.
export const APP_MEMORIES_QUERY = /* GraphQL */ `
  query AppMemories($orgId: ID!, $limit: Int, $offset: Int) {
    memories(orgId: $orgId, filter: { memoryClasses: [app] }, limit: $limit, offset: $offset) {
      items { id urn name description appId }
      total
    }
  }
`;
export async function readAppMemories(client: ReturnType<typeof gqlClient>, orgId: string | null, appId: string): Promise<AppMemoryRow[] | null> {
  if (!orgId) return [];
  try {
    const memories = await withTimeout(fetchAllItems<AppMemoryRow>(client, APP_MEMORIES_QUERY, 'memories', { orgId }), OPTIONAL_LIST_TIMEOUT_MS, null);
    return memories === null ? null : memories.filter(m => m.appId === appId);
  } catch { return null; }
}

export function canCreateAppMemory(org: { members?: { role: string; user: { id: string } }[] } | null, userId: string | null): boolean {
  return !!userId && !!org?.members?.some(m => m.user.id === userId && (m.role === 'OWNER' || m.role === 'ADMIN'));
}

export async function createMemory({ request, params, locals }: { request: Request; params: { appId: string }; locals: { token?: string | null } }) {
  const form = await superValidate(await request.formData(), zod4(createAppMemorySchema), { id: `createAppMemory:${params.appId}` });
  if (!form.valid) return fail(400, { form });
  try {
    await gqlClient(locals.token).request(CREATE_APP_MEMORY_MUTATION, { appRef: params.appId, name: form.data.name, description: form.data.description });
    return message(form, { type: 'success', text: t('app.memory.created', 'Memory created.') });
  } catch (e: unknown) {
    // Only known codes select fixed copy; no raw GraphQL or transport text.
    const code = extractGqlErrorCode(e);
    const refusal = code === 'FORBIDDEN' ? [403, t('app.memory.forbidden', 'Adding a memory needs an owner or admin of this organization, acting as themselves.')] as const
      : code === 'UNAUTHENTICATED' ? [401, t('app.memory.sign-in', 'Sign in again to add a memory.')] as const
      : code === 'AGENT_NOT_INSTALLED' ? [409, t('app.memory.no-agent', 'Install an Agent in this App before adding a memory.')] as const
      : code === 'USER_OWNED_APP_UNSUPPORTED' ? [400, t('app.memory.org-only', 'New App memories are supported for organization Apps.')] as const
      : code === 'BAD_USER_INPUT' ? [400, t('app.memory.invalid', 'Check the memory name and try again.')] as const
      : [500, t('app.memory.failed', 'Could not create the memory. Please try again.')] as const;
    return message(form, { type: 'error', text: refusal[1] }, { status: refusal[0] });
  }
}
