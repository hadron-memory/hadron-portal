import { t } from '$lib/i18n/t';

/**
 * portal#1142 S8 — a boot-prompt pointer as the page shows it
 * (hadron-server#2219, R23–R27; Xylon's stamp 6330444824).
 *
 * `bootPromptRef` and `bootPromptTargetDeleted` are both null when no pointer
 * is set AND when the reader may not see it, so a null pair is "not shown",
 * never "no pointer". A read that failed is its own state, never folded into
 * either. Pointers are stored and read back only: serving them is S10
 * (hadron-server#2047), not built yet.
 */
export type PointerRead =
  | { ok: true; ref: string | null; deleted: boolean | null }
  | { ok: false };

export type PointerView =
  | { kind: 'set'; ref: string }
  | { kind: 'deleted'; ref: string }
  | { kind: 'not-shown' }
  | { kind: 'unavailable' };

export function pointerView(read: PointerRead | undefined): PointerView {
  if (!read || !read.ok) return { kind: 'unavailable' };
  if (!read.ref) return { kind: 'not-shown' };
  return read.deleted === true ? { kind: 'deleted', ref: read.ref } : { kind: 'set', ref: read.ref };
}

/**
 * An App's install pointers, keyed by agent id for the Agents tab's rows. An
 * install row whose agent is withheld can't be keyed and is left out; the page
 * shows a row it has no entry for as "not shown", never borrowing another's.
 */
export type AppPointers = { ok: true; byAgent: Record<string, { ref: string | null; deleted: boolean | null }> } | { ok: false };

/** One Agents-tab row's pointer: the read failed, or this row's own entry, or none (not shown). */
export function appRowPointer(pointers: AppPointers | undefined, agentId: string): PointerRead {
  if (!pointers?.ok) return { ok: false };
  const row = pointers.byAgent[agentId];
  return row ? { ok: true, ref: row.ref, deleted: row.deleted } : { ok: true, ref: null, deleted: null };
}

/** What a pointer cell says, as plain text: the grid's search reads exactly what the cell shows. */
export function pointerText(read: PointerRead | undefined): string {
  const v = pointerView(read);
  switch (v.kind) {
    case 'set':
      return v.ref;
    case 'deleted':
      return `${v.ref} ${t('boot-pointer.deleted-short', 'target deleted')}`;
    case 'not-shown':
      return t('boot-pointer.not-shown', 'Not shown');
    case 'unavailable':
      return t('boot-pointer.unavailable', 'Couldn’t load the pointer.');
  }
}

/** Whose pointer: the Agent's own (its manager), or an App's or worker's (the App's manager). */
export type PointerOwner = 'agent' | 'app';

/** A refused pointer write, as the form shows it: a fixed lead (when the code is known) and the server's message. */
export interface PointerRefusal {
  code: string | null;
  lead: string | null;
  message: string;
}

/** A pointer action's result, as a page receives it: `key` names the surface it was written for. */
export interface PointerResult {
  key?: string;
  ok?: boolean;
  cleared?: boolean;
  refusal?: PointerRefusal;
  nodeRef?: string;
}

/** An App install's pointer key: the route's App ref and the agent id, so a result never crosses Apps. */
export function appAgentPointerKey(appKey: string, agentId: string): string {
  return `${appKey}\u0000${agentId}`;
}

/** A pointer result only for the surface it was written for (George's P2 on #1246). */
export function pointerResultFor(result: PointerResult | null | undefined, key: string): PointerResult | null {
  return result && result.key === key ? result : null;
}

/** The fixed line every control carries (Victor's FIT delta 2): what is built, no capability claimed. */
export const POINTER_NOT_SERVED = () => t('boot-pointer.not-served', 'Pointers are recorded but not used to start agents yet.');

export function pointerRefusalLead(code: string | null, owner: PointerOwner): string | null {
  switch (code) {
    case 'BAD_USER_INPUT':
      return t('boot-pointer.refusal.input', 'That isn’t a node id or a fully-qualified node URN.');
    case 'AGENT_NOT_FOUND':
    case 'APP_NOT_FOUND':
    case 'WORKER_NOT_FOUND':
      return t('boot-pointer.refusal.owner-gone', 'It may have been removed. Reload the page.');
    case 'FORBIDDEN':
      return owner === 'agent'
        ? t('boot-pointer.refusal.forbidden-agent', 'Only this Agent’s manager can change its pointer.')
        : t('boot-pointer.refusal.forbidden-app', 'Only this App’s manager can change this pointer.');
    case 'BOOT_PROMPT_POINTER_SESSION_REFUSED':
      return t('boot-pointer.refusal.session', 'Set it as yourself, not from a worker session.');
    case 'BOOT_PROMPT_POINTER_NOT_FOUND':
      return t('boot-pointer.refusal.not-found', 'That node wasn’t found, or you can’t read it.');
    case 'BOOT_PROMPT_POINTER_NOT_COMPILED':
      return t('boot-pointer.refusal.not-compiled', 'That node isn’t a compiled boot prompt.');
    case 'BOOT_PROMPT_POINTER_WRONG_ROLE':
    case 'BOOT_PROMPT_POINTER_WRONG_MEMORY':
      return t('boot-pointer.refusal.wrong-target', 'That node isn’t a boot prompt for this target.');
    default:
      return null;
  }
}
