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
import { attachAppMemorySchema, createAppMemorySchema, createOwnAppMemorySchema, detachAppMemorySchema } from './schema';

export interface CreatedAppMemory { id: string; urn: string; name: string }
// code: set only when the refusal's reason is something the page already says (AGENT_NOT_INSTALLED), so the
// page can show that reason once. Never carries server text.
export type AppMemoryMessage = App.Superforms.Message & { created?: CreatedAppMemory; code?: 'AGENT_NOT_INSTALLED' };
// The attach result carries no extra fields: the list refreshes and shows the memory.
export type AttachMemoryMessage = App.Superforms.Message;

// One row per memory the App reads from for this viewer (hrn:node:hadronmemory.com:specs:cor:dmo:050:17): its own app memories, the team
// space, Agent-linked memories, and the viewer's own. `class` is the memory's class, shown as-is.
// `link` is set when the App reaches the memory through an attachment (hrn:node:hadronmemory.com:specs:cor:dmo:060:20); `active` is
// whether that attachment counts right now. An inactive one is still an attachment (hrn:node:hadronmemory.com:specs:cor:dmo:060:22, Proposed): listed, marked, detachable.
export interface AppMemoryRow { id: string; urn: string; name: string; class: string; appId: string | null; link?: { active: boolean } }
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

// The memories linked to this App with attachMemoryToApp: the scope has no row kind for them, so they are read from the App.
export const APP_ATTACHED_MEMORIES_QUERY = /* GraphQL */ `
  query AppAttachedMemories($ref: ID!) {
    app(ref: $ref) { attachedMemories { active memory { id urn name class } } }
  }
`;
/** Null means unavailable, never "none linked". */
export async function readAttachedMemories(client: ReturnType<typeof gqlClient>, appId: string): Promise<AppMemoryRow[] | null> {
  try {
    const data = await withTimeout(client.request<{ app: { attachedMemories: { active: boolean; memory: { id: string; urn: string; name: string; class: string } }[] } | null }>(APP_ATTACHED_MEMORIES_QUERY, { ref: appId }), OPTIONAL_LIST_TIMEOUT_MS, null);
    if (!data?.app) return null;
    return data.app.attachedMemories.map(({ active, memory: m }) => ({ id: m.id, urn: m.urn, name: m.name, class: m.class, appId: null, link: { active } }));
  } catch { return null; }
}
/**
 * The scope's rows, then each linked memory the scope does not already hold. A scope row that is also a link is marked as
 * one, so it can be detached and an inactive link is never shown as a plain row. An unavailable link read leaves the scope as it is.
 */
export function withLinkedMemories(rows: AppMemoryRow[] | null, linked: AppMemoryRow[] | null): AppMemoryRow[] | null {
  if (rows === null || linked === null) return rows;
  const links = new Map(linked.map(m => [m.id, m.link]));
  const held = new Set(rows.map(r => r.id));
  return [...rows.map(r => (links.get(r.id) ? { ...r, link: links.get(r.id) } : r)), ...linked.filter(m => !held.has(m.id))];
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
    return message(form, { type: 'success', text: t('app.memory.attached', 'Memory linked to this App.') });
  } catch (e: unknown) {
    // Only known codes select fixed copy; no raw GraphQL or transport text.
    const code = extractGqlErrorCode(e);
    // The server answers FORBIDDEN and MEMORY_NOT_FOUND identically for every reason it has, so the copy names none.
    const refusal = code === 'FORBIDDEN' ? [403, t('app.memory.attach-forbidden', 'Only a member of this App, signed in as themselves, can add a memory.')] as const
      : code === 'UNAUTHENTICATED' ? [401, t('app.memory.sign-in', 'Sign in again to add a memory.')] as const
      : code === 'APP_UNINSTALLED' ? [409, t('app.memory.app-uninstalled', 'This App is uninstalled. Reinstall it to add a memory.')] as const
      : code === 'MEMORY_NOT_FOUND' ? [404, t('app.memory.attach-not-found', 'That memory couldn’t be found, or you can’t read it.')] as const
      : code === 'UNSUPPORTED_MEMORY_CLASS' ? [400, t('app.memory.attach-class', 'A system memory cannot be attached to an App.')] as const
      : [500, t('app.memory.attach-failed', 'Could not add the memory. Please try again.')] as const;
    return message(form, { type: 'error', text: refusal[1] }, { status: refusal[0] });
  }
}

export const DETACH_MEMORY_FROM_APP_MUTATION = /* GraphQL */ `
  mutation DetachMemoryFromApp($memoryRef: ID!, $appRef: ID!) {
    detachMemoryFromApp(memoryRef: $memoryRef, appRef: $appRef)
  }
`;

/**
 * Remove a link (hrn:node:hadronmemory.com:specs:cor:dmo:060:20): the attachment only, never the memory. The server decides who may
 * (whoever made the link, the memory's strict owner, whoever manages the App) and answers a link that is already gone with
 * success, so the portal adds no check and speaks only fixed copy.
 */
export async function detachMemory({ request, params, locals }: { request: Request; params: { appId: string }; locals: { token?: string | null } }) {
  const form = await superValidate<Infer<typeof detachAppMemorySchema, 'zod4'>, AttachMemoryMessage>(await request.formData(), zod4(detachAppMemorySchema), { id: `detachAppMemory:${params.appId}` });
  // The hidden form has no field to show an error in, so a request with no memory says so in the outcome region.
  if (!form.valid) return message(form, { type: 'error', text: t('app.memory.detach-invalid', 'Choose a memory to detach and try again.') }, { status: 400 });
  try {
    await gqlClient(locals.token).request(DETACH_MEMORY_FROM_APP_MUTATION, { memoryRef: form.data.memoryId, appRef: params.appId });
    return message(form, { type: 'success', text: t('app.memory.detached', 'Link removed. The memory itself is unchanged.') });
  } catch (e: unknown) {
    // Only known codes select fixed copy; no raw GraphQL or transport text.
    const code = extractGqlErrorCode(e);
    const refusal = code === 'FORBIDDEN' ? [403, t('app.memory.detach-forbidden', 'Only whoever made the link, the memory’s owner, or whoever manages this App can remove it.')] as const
      : code === 'UNAUTHENTICATED' ? [401, t('app.memory.sign-in-detach', 'Sign in again to remove a link.')] as const
      : code === 'MEMORY_NOT_FOUND' ? [404, t('app.memory.detach-not-found', 'That memory couldn’t be found, or you can’t read it.')] as const
      : [500, t('app.memory.detach-failed', 'Could not remove the link. Please try again.')] as const;
    return message(form, { type: 'error', text: refusal[1] }, { status: refusal[0] });
  }
}

// The memories a link could take, for the picker: every memory the caller can read except `system`, whoever owns it,
// whichever organization it is in and whichever App already links it (the link law, hrn:node:hadronmemory.com:specs:cor:dmo:060:20). The server's
// attach stays the authority on what links.
export const ATTACHABLE_MEMORIES_QUERY = /* GraphQL */ `
  query AttachableMemories($limit: Int, $offset: Int, $sharedWithMe: Boolean) {
    memories(filter: { memoryClasses: [app, group, knowledge, personal, private], sharedWithMe: $sharedWithMe }, limit: $limit, offset: $offset) {
      items { id urn name visibility }
      total
    }
  }
`;
export interface AttachableMemory { id: string; urn: string; name: string; visibility: string | null }
/**
 * Null means the read failed, never "none to add". The default list leaves out a memory reached only through a share, so
 * the shared-with-me slice is read as well and the two are joined, one row per memory.
 */
export async function readAttachableMemories(client: ReturnType<typeof gqlClient>): Promise<AttachableMemory[] | null> {
  try {
    const read = (sharedWithMe: boolean) => fetchAllItems<AttachableMemory>(client, ATTACHABLE_MEMORIES_QUERY, 'memories', { sharedWithMe: sharedWithMe || null });
    const both = await withTimeout(Promise.all([read(false), read(true)]), OPTIONAL_LIST_TIMEOUT_MS, null);
    if (!both) return null;
    const seen = new Set<string>();
    return both.flat().filter(m => !seen.has(m.id) && !!seen.add(m.id));
  } catch { return null; }
}

// portal#2634 — a member's own personal or private memory (hrn:node:hadronmemory.com:specs:cor:dmo:060:20). The class
// is the member's only choice; the server derives the name and the URN (under the member's own root) and decides every
// outcome. `name` is a required argument of the mutation that the server ignores for these two classes, so a fixed
// label goes there and no user text does.
export const CREATE_MEMORY_IN_APP_MUTATION = /* GraphQL */ `
  mutation CreateMemoryInApp($appRef: ID!, $agentRef: ID!, $memoryClass: MemoryClass!, $name: String!) {
    createMemoryInApp(appRef: $appRef, agentRef: $agentRef, memoryClass: $memoryClass, name: $name) { id urn name }
  }
`;
export const APP_USER_MEMORY_CLASSES_QUERY = /* GraphQL */ `query AppUserMemoryClasses($ref: ID!) { app(ref: $ref) { viewerAppUserMemoryClasses } }`;
export type OwnMemoryClass = 'personal' | 'private';
export type OwnMemoryMessage = App.Superforms.Message & { created?: CreatedAppMemory };

/**
 * The classes the server says this viewer may still create (App.viewerAppUserMemoryClasses), exactly: the portal
 * adds no rule of its own, so a member who holds a private memory is offered `personal` only and an empty list offers
 * nothing. Null means the read failed, which offers nothing too. A class this form cannot create is dropped, never offered.
 */
export async function readViewerMemoryClasses(client: ReturnType<typeof gqlClient>, appId: string): Promise<OwnMemoryClass[] | null> {
  try {
    const res = await withTimeout(client.request<{ app: { viewerAppUserMemoryClasses: string[] } | null }>(APP_USER_MEMORY_CLASSES_QUERY, { ref: appId }), OPTIONAL_LIST_TIMEOUT_MS, null);
    const classes = res?.app?.viewerAppUserMemoryClasses;
    return classes ? classes.filter((c): c is OwnMemoryClass => c === 'personal' || c === 'private') : null;
  } catch { return null; }
}

export async function createOwnMemory({ request, params, locals }: { request: Request; params: { appId: string }; locals: { token?: string | null } }) {
  const form = await superValidate<Infer<typeof createOwnAppMemorySchema, 'zod4'>, OwnMemoryMessage>(await request.formData(), zod4(createOwnAppMemorySchema), { id: `createOwnAppMemory:${params.appId}` });
  if (!form.valid) return fail(400, { form });
  const label = form.data.memoryClass === 'personal' ? 'Personal memory' : 'Private memory';
  try {
    const { createMemoryInApp: created } = await gqlClient(locals.token).request<{ createMemoryInApp: CreatedAppMemory }>(CREATE_MEMORY_IN_APP_MUTATION, { appRef: params.appId, agentRef: form.data.agentId, memoryClass: form.data.memoryClass, name: label });
    return message(form, { type: 'success', text: t('app.memory.own-created', 'Memory created.'), created });
  } catch (e: unknown) {
    // The code selects fixed copy, never the message text (Tunable wording, hrn:node:hadronmemory.com:specs:cor:api:140:01); no raw GraphQL or transport text.
    const code = extractGqlErrorCode(e);
    const refusal = code === 'APP_USER_MEMORY_ALREADY_EXISTS' ? [409, t('app.memory.own-exists', 'You already have a memory of this kind in this App.')] as const
      : code === 'FORBIDDEN' ? [403, t('app.memory.own-forbidden', 'Only a member of this App, signed in as themselves, can create their own memory here.')] as const
      : code === 'UNAUTHENTICATED' ? [401, t('app.memory.sign-in-own', 'Sign in again to create your memory.')] as const
      : code === 'AGENT_NOT_INSTALLED' || code === 'APP_UNINSTALLED' ? [409, t('app.memory.no-agent', 'Install an Agent in this App before adding a memory.')] as const
      : code === 'UNSUPPORTED_MEMORY_CLASS' ? [400, t('app.memory.own-unsupported', 'Creating your own memory isn’t available in this App.')] as const
      : [500, t('app.memory.own-failed', 'Could not create your memory. Please try again.')] as const;
    return message(form, { type: 'error', text: refusal[1] }, { status: refusal[0] });
  }
}
