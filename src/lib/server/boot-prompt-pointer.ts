import { fail } from '@sveltejs/kit';
import type { GraphQLClient } from 'graphql-request';
import { t } from '$lib/i18n/t';
import { pointerRefusalLead, type AppPointers, type PointerOwner, type PointerRead, type PointerRefusal } from '$lib/boot-prompt-pointer';
import { extractGqlErrorCode } from './gqlError';
import { APP_BOOT_POINTERS_QUERY, SELF_CAN_MANAGE_QUERY } from './queries';

/**
 * portal#1142 S8 — reading and writing a boot-prompt pointer on the server
 * side of a page (hadron-server#2219; Xylon's stamp 6330444824).
 */

/** A pointer read that fails is `{ ok: false }`, never a null pointer. */
export async function readPointer<T>(
  run: () => Promise<T>,
  pick: (r: T) => { bootPromptRef?: string | null; bootPromptTargetDeleted?: boolean | null } | null | undefined,
  label: string,
): Promise<PointerRead> {
  try {
    const owner = pick(await run());
    if (!owner) return { ok: false };
    return { ok: true, ref: owner.bootPromptRef ?? null, deleted: owner.bootPromptTargetDeleted ?? null };
  } catch (e) {
    console.warn(`[boot-pointer] ${label} read failed:`, e);
    return { ok: false };
  }
}

/** An App's install pointers, keyed by agent id (see AppPointers). */
export async function readAppPointers(client: Pick<GraphQLClient, 'request'>, appRef: string): Promise<AppPointers> {
  type Row = { agent: { id: string } | null; bootPromptRef: string | null; bootPromptTargetDeleted: boolean | null };
  try {
    const r = await client.request<{ app: { appAgents: Row[] } | null }>(APP_BOOT_POINTERS_QUERY, { ref: appRef });
    if (!r.app) return { ok: false };
    const byAgent: Record<string, { ref: string | null; deleted: boolean | null }> = {};
    for (const row of r.app.appAgents ?? []) {
      if (row.agent?.id) byAgent[row.agent.id] = { ref: row.bootPromptRef ?? null, deleted: row.bootPromptTargetDeleted ?? null };
    }
    return { ok: true, byAgent };
  } catch (e) {
    console.warn(`[boot-pointer] app ${appRef} read failed:`, e);
    return { ok: false };
  }
}

/**
 * May the viewer manage `resource` (a URN)? A self-audit used ONLY to decide
 * whether the form is offered; the server's setter is the authority either way.
 * null means unknown (no user, a refused or failed audit): the form is then
 * offered and the server answers.
 *
 * Known drift, for the record (Victor's FIT 6330317549): for an App,
 * `effectiveAccess` does not lift an owner-role AppMember to `canManage` while
 * `managesApp` counts them, so a real manager can read `false`; for an Agent
 * it can report `true` to a platform admin the setter then refuses.
 */
export async function selfCanManage(client: Pick<GraphQLClient, 'request'>, userId: string | null | undefined, resource: string | null | undefined): Promise<boolean | null> {
  if (!userId || !resource) return null;
  try {
    const r = await client.request<{ effectiveAccess: { canManage: boolean } }>(SELF_CAN_MANAGE_QUERY, { user: userId, resource });
    return typeof r.effectiveAccess?.canManage === 'boolean' ? r.effectiveAccess.canManage : null;
  } catch {
    return null;
  }
}

/**
 * The form's value as the setter's `nodeRef`: the Clear button sends an
 * explicit null; Set sends the typed text, trimmed. An empty Set is invalid
 * and sends nothing: an omitted or empty ref is never a clear.
 */
export function pointerNodeRef(fd: FormData): { nodeRef: string | null } | { invalid: true; typed: string } {
  if (fd.get('intent') === 'clear') return { nodeRef: null };
  const typed = String(fd.get('nodeRef') ?? '');
  const nodeRef = typed.trim();
  return nodeRef ? { nodeRef } : { invalid: true, typed };
}

/**
 * A refused write. The message is only the server's own error text, never the
 * thrown error's message (a ClientError's carries the query and variables);
 * without one, a fixed line.
 */
export function pointerRefusal(e: unknown, owner: PointerOwner): PointerRefusal {
  const code = extractGqlErrorCode(e);
  const serverMessage = (e as { response?: { errors?: { message?: unknown }[] } } | null)?.response?.errors?.[0]?.message;
  const message = typeof serverMessage === 'string' && serverMessage
    ? serverMessage
    : t('boot-pointer.refusal.unknown', 'The pointer couldn’t be changed. Reload the page and try again.');
  return { code, lead: pointerRefusalLead(code, owner), message };
}

/** The HTTP status a refusal answers with. */
function refusalStatus(code: string | null): number {
  switch (code) {
    case 'FORBIDDEN':
    case 'BOOT_PROMPT_POINTER_SESSION_REFUSED':
      return 403;
    case 'AGENT_NOT_FOUND':
    case 'APP_NOT_FOUND':
    case 'WORKER_NOT_FOUND':
      return 404;
    case null:
      return 502;
    default:
      return 400;
  }
}

/**
 * One pointer write as a form action. `key` names the surface (an agent id on
 * the App page's rows), so a result is shown only where it was written.
 */
export async function pointerAction(
  fd: FormData,
  owner: PointerOwner,
  key: string,
  write: (nodeRef: string | null) => Promise<unknown>,
) {
  const ref = pointerNodeRef(fd);
  if ('invalid' in ref) {
    return fail(400, {
      pointer: {
        key,
        nodeRef: ref.typed,
        refusal: { code: null, lead: null, message: t('boot-pointer.refusal.empty', 'Enter a node id or a fully-qualified node URN, or use Clear.') },
      },
    });
  }
  try {
    await write(ref.nodeRef);
    return { pointer: { key, ok: true as const, cleared: ref.nodeRef === null } };
  } catch (e) {
    const refusal = pointerRefusal(e, owner);
    // A refused Clear keeps whatever was in the field, as a refused Set does.
    const typed = ref.nodeRef ?? String(fd.get('nodeRef') ?? '');
    return fail(refusalStatus(refusal.code), { pointer: { key, nodeRef: typed, refusal } });
  }
}
