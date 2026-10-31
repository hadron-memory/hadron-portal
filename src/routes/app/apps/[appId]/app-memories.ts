import type { Infer } from 'sveltekit-superforms';
import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import { fetchAllItems } from '$lib/server/paginate';
import { t } from '$lib/i18n/t';
import { createAppMemorySchema } from './schema';

export interface CreatedAppMemory { id: string; urn: string; name: string }
export type AppMemoryMessage = App.Superforms.Message & { created?: CreatedAppMemory };

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
// A user-owned App has no org to list through. hadron-server#2861 lists its
// free-standing app memories as the APP_MEMORY source of appMemoryScope, for App
// participants only. The row is a leaf with no description, so it is null here.
export const APP_MEMORY_SCOPE_QUERY = /* GraphQL */ `
  query AppMemoryScope($appRef: ID!, $limit: Int, $offset: Int) {
    appMemoryScope(appRef: $appRef, limit: $limit, offset: $offset) {
      items { memoryId memoryUrn name sources { kind } }
      total
    }
  }
`;
interface ScopedMemoryRow { memoryId: string; memoryUrn: string; name: string; sources: { kind: string }[] }
async function readUserOwnedAppMemories(client: ReturnType<typeof gqlClient>, appId: string): Promise<AppMemoryRow[] | null> {
  try {
    const scope = await withTimeout(fetchAllItems<ScopedMemoryRow>(client, APP_MEMORY_SCOPE_QUERY, 'appMemoryScope', { appRef: appId }), OPTIONAL_LIST_TIMEOUT_MS, null);
    return scope === null ? null : scope
      .filter(m => m.sources.some(s => s.kind === 'APP_MEMORY'))
      .map(m => ({ id: m.memoryId, urn: m.memoryUrn, name: m.name, description: null, appId }));
  } catch { return null; }
}
export async function readAppMemories(client: ReturnType<typeof gqlClient>, orgId: string | null, appId: string): Promise<AppMemoryRow[] | null> {
  if (!orgId) return readUserOwnedAppMemories(client, appId);
  try {
    const memories = await withTimeout(fetchAllItems<AppMemoryRow>(client, APP_MEMORIES_QUERY, 'memories', { orgId }), OPTIONAL_LIST_TIMEOUT_MS, null);
    return memories === null ? null : memories.filter(m => m.appId === appId);
  } catch { return null; }
}

// Whether to OFFER the form; the server's createAppMemory gate stays the
// authority. An org App follows the viewer's org role. A user-owned App has no
// org, so it follows the viewer's manage right on the App (effectiveAccess
// grants it to the owner); unknown (null) hides it, since the server would
// refuse a non-owner anyway.
export function canCreateAppMemory(
  org: { members?: { role: string; user: { id: string } }[] } | null,
  userId: string | null,
  app: { userOwned: boolean; canManageApp: boolean | null } = { userOwned: false, canManageApp: null },
): boolean {
  if (!userId) return false;
  if (app.userOwned) return app.canManageApp === true;
  return !!org?.members?.some(m => m.user.id === userId && (m.role === 'OWNER' || m.role === 'ADMIN'));
}

export async function createMemory({ request, params, locals }: { request: Request; params: { appId: string }; locals: { token?: string | null } }) {
  const form = await superValidate<Infer<typeof createAppMemorySchema, 'zod4'>, AppMemoryMessage>(await request.formData(), zod4(createAppMemorySchema), { id: `createAppMemory:${params.appId}` });
  if (!form.valid) return fail(400, { form });
  try {
    const { createAppMemory: created } = await gqlClient(locals.token).request<{ createAppMemory: CreatedAppMemory }>(CREATE_APP_MEMORY_MUTATION, { appRef: params.appId, name: form.data.name, description: form.data.description });
    return message(form, { type: 'success', text: t('app.memory.created', 'Memory created.'), created });
  } catch (e: unknown) {
    // Only known codes select fixed copy; no raw GraphQL or transport text.
    const code = extractGqlErrorCode(e);
    const refusal = code === 'FORBIDDEN' ? [403, t('app.memory.forbidden', 'Adding a memory needs the App’s owner, or an owner or admin of its organization, acting as themselves.')] as const
      : code === 'UNAUTHENTICATED' ? [401, t('app.memory.sign-in', 'Sign in again to add a memory.')] as const
      : code === 'AGENT_NOT_INSTALLED' ? [409, t('app.memory.no-agent', 'Install an Agent in this App before adding a memory.')] as const
      : code === 'BAD_USER_INPUT' ? [400, t('app.memory.invalid', 'Check the memory name and try again.')] as const
      : [500, t('app.memory.failed', 'Could not create the memory. Please try again.')] as const;
    return message(form, { type: 'error', text: refusal[1] }, { status: refusal[0] });
  }
}
