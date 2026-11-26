import type { AppScopedMemory } from '$lib/app-memory-scope';
import type { Infer } from 'sveltekit-superforms';
import { fail } from '@sveltejs/kit';
import { message, superValidate } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';
import { gqlClient } from '$lib/server/api';
import { extractGqlErrorCode } from '$lib/server/gqlError';
import { OPTIONAL_LIST_TIMEOUT_MS, withTimeout } from '$lib/server/with-timeout';
import { fetchAllItems } from '$lib/server/paginate';
import { t } from '$lib/i18n/t';
import { attachAppMemorySchema, createAppMemorySchema } from './schema';

export interface CreatedAppMemory { id: string; urn: string; name: string }
// code: set only when the refusal's reason is something the page already says (AGENT_NOT_INSTALLED), so the
// page can show that reason once. Never carries server text.
export type AppMemoryMessage = App.Superforms.Message & { created?: CreatedAppMemory; code?: 'AGENT_NOT_INSTALLED' };
// The attach result carries no extra fields: the list refreshes and shows the memory.
export type AttachMemoryMessage = App.Superforms.Message;

// One row per memory the App reads from for this viewer (hrn:node:hadronmemory.com:specs:cor:dmo:050:17): its own app memories, the team
// space, Agent-linked memories, and the viewer's own. `class` is the memory's class, shown as-is.
export interface AppMemoryRow { id: string; urn: string; name: string; class: string; appId: string | null }
export const CREATE_APP_MEMORY_MUTATION = /* GraphQL */ `
  mutation CreateAppMemory($appRef: ID!, $name: String!, $description: String) {
    createAppMemory(appRef: $appRef, name: $name, description: $description) { id urn name }
  }
`;
// The complete caller-specific App node scope. Its leaf rows do not open
// nested Memory or Agent gates. The App page's memory list is this scope, in full.
export const APP_MEMORY_SCOPE_QUERY = /* GraphQL */ `
  query AppMemoryScope($appRef: ID!, $limit: Int, $offset: Int) {
    appMemoryScope(appRef: $appRef, limit: $limit, offset: $offset) {
      items { memoryId memoryUrn name class viewerCanWrite sources { kind agentId } }
      total
    }
  }
`;
/** Null means unavailable/refused, never a successfully empty scope. */
export async function readAppMemoryScope(client: ReturnType<typeof gqlClient>, appId: string): Promise<AppScopedMemory[] | null> {
  try {
    return await withTimeout(fetchAllItems<AppScopedMemory>(client, APP_MEMORY_SCOPE_QUERY, 'appMemoryScope', { appRef: appId }), OPTIONAL_LIST_TIMEOUT_MS, null);
  } catch { return null; }
}
/** Every memory in the viewer's scope, one row each. Null means the scope was unavailable, not empty. */
export function appMemoriesFromScope(scope: AppScopedMemory[] | null, appId: string): AppMemoryRow[] | null {
  return scope === null ? null : scope.map(m => ({ id: m.memoryId, urn: m.memoryUrn, name: m.name, class: m.class, appId }));
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
    return message(form, { type: 'error', text: refusal[1], ...(code === 'AGENT_NOT_INSTALLED' ? { code } : {}) }, { status: refusal[0] });
  }
}

export const ATTACH_MEMORY_TO_APP_MUTATION = /* GraphQL */ `
  mutation AttachMemoryToApp($memoryRef: ID!, $appRef: ID!) {
    attachMemoryToApp(memoryRef: $memoryRef, appRef: $appRef) { id urn name }
  }
`;

/**
 * Link a memory the caller can read into this App (hrn:node:hadronmemory.com:specs:cor:dmo:060:20). The memory is
 * unchanged: same owner, class, URN and name, and it does not count toward a class limit. Authorization is the server's alone.
 */
export async function attachMemory({ request, params, locals }: { request: Request; params: { appId: string }; locals: { token?: string | null } }) {
  const form = await superValidate<Infer<typeof attachAppMemorySchema, 'zod4'>, AttachMemoryMessage>(await request.formData(), zod4(attachAppMemorySchema), { id: `attachAppMemory:${params.appId}` });
  if (!form.valid) return fail(400, { form });
  try {
    await gqlClient(locals.token).request(ATTACH_MEMORY_TO_APP_MUTATION, { memoryRef: form.data.memoryId, appRef: params.appId });
    return message(form, { type: 'success', text: t('app.memory.attached', 'Memory added to this App.') });
  } catch (e: unknown) {
    // Only known codes select fixed copy; no raw GraphQL or transport text.
    const code = extractGqlErrorCode(e);
    // The server answers FORBIDDEN and MEMORY_NOT_FOUND identically for every reason it has, so the copy names none.
    const refusal = code === 'FORBIDDEN' ? [403, t('app.memory.attach-forbidden', 'Only a member of this App, signed in as themselves, can add a memory.')] as const
      : code === 'UNAUTHENTICATED' ? [401, t('app.memory.sign-in', 'Sign in again to add a memory.')] as const
      : code === 'APP_UNINSTALLED' ? [409, t('app.memory.no-agent', 'Install an Agent in this App before adding a memory.')] as const
      : code === 'MEMORY_NOT_FOUND' ? [404, t('app.memory.attach-not-found', 'That memory couldn’t be found, or you can’t read it.')] as const
      : code === 'UNSUPPORTED_MEMORY_CLASS' ? [400, t('app.memory.attach-class', 'A system memory cannot be attached to an App.')] as const
      : [500, t('app.memory.attach-failed', 'Could not add the memory. Please try again.')] as const;
    return message(form, { type: 'error', text: refusal[1] }, { status: refusal[0] });
  }
}

// The memories a link could take, for the picker: every memory the caller can read except `system`, whoever owns it,
// whichever organization it is in and whichever App already links it (the link law, cor:dmo:060:20). The server's
// attach stays the authority on what links.
export const ATTACHABLE_MEMORIES_QUERY = /* GraphQL */ `
  query AttachableMemories($limit: Int, $offset: Int) {
    memories(filter: { memoryClasses: [app, group, knowledge, personal, private] }, limit: $limit, offset: $offset) {
      items { id urn name visibility }
      total
    }
  }
`;
export interface AttachableMemory { id: string; urn: string; name: string; visibility: string | null }
/** Null means the read failed, never "none to add". */
export async function readAttachableMemories(client: ReturnType<typeof gqlClient>): Promise<AttachableMemory[] | null> {
  try {
    return await withTimeout(fetchAllItems<AttachableMemory>(client, ATTACHABLE_MEMORIES_QUERY, 'memories'), OPTIONAL_LIST_TIMEOUT_MS, null);
  } catch { return null; }
}
