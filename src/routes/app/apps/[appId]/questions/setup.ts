import type { AppScopedMemory } from '$lib/app-memory-scope';

/**
 * portal#2237 (Questions P4) — what the question-log setup form offers, and what its action accepts. The server decides who may create a
 * log (a manager of the memory, or an owner-role member of its App; hrn:node:hadronmemory.com:specs:cor:dmo:140:01), so nothing here
 * guesses a permission. What it decides is the portal's own product choice of which memories and people to OFFER, and that a submission
 * names only what was offered.
 */
export const LOG_LOC = 'questions';
export const LOG_NAME = 'Questions';
export const MAX_DECIDERS = 20;

export type SetupMemory = { id: string; name: string; urn: string };
export type SetupPerson = { id: string; name: string | null; handle: string | null };
export type DeciderChoices = { people: SetupPerson[]; fixed: boolean };

/** Personal and private memories have one writer, the owner, so nobody else could decide there; a system memory is refused by the server. */
const OFFERED_CLASSES = new Set(['app', 'group', 'knowledge']);

/**
 * The App's memories that can hold a log. Left out: personal, private and system classes, and a memory the App only inherits from its
 * base Agent (it belongs to that Agent, and other Apps read it too). The scope carries no encryption flag, so an encrypted memory is
 * offered and the server's QUESTION_LOG_ENCRYPTED refusal explains. `null` is an unavailable scope, never an empty one.
 */
export function setupMemoryChoices(scope: readonly AppScopedMemory[] | null): SetupMemory[] | null {
  if (scope === null) return null;
  return scope
    .filter((m) => OFFERED_CLASSES.has(m.class) && m.sources.some((s) => s.kind !== 'INHERITED_BASE'))
    .map((m) => ({ id: m.memoryId, name: m.name, urn: m.memoryUrn }));
}

/**
 * Who may be named as a decider: the App's people with the viewer first. With the member list withheld or unreadable the viewer is
 * the only choice, and is fixed (a form that cannot offer anyone else must still offer someone who can decide).
 */
export function setupDeciderChoices(
  people: { people: SetupPerson[]; withheld: boolean; failed: boolean },
  viewer: { id: string; name: string | null },
): DeciderChoices {
  const me: SetupPerson = people.people.find((p) => p.id === viewer.id) ?? { id: viewer.id, name: viewer.name, handle: null };
  if (people.withheld || people.failed) return { people: [me], fixed: true };
  return { people: [me, ...people.people.filter((p) => p.id !== viewer.id)], fixed: false };
}

export type SetupParse = { ok: true; memoryRef: string; deciders: string[] } | { ok: false };

/** A submission is valid only when its memory and every decider are ones the form offered, and there are one to twenty distinct deciders. */
export function parseSetupForm(form: FormData, memories: readonly SetupMemory[], choices: DeciderChoices): SetupParse {
  const memoryId = form.get('memoryId');
  if (typeof memoryId !== 'string' || !memories.some((m) => m.id === memoryId)) return { ok: false };
  const deciders = form.getAll('deciders').filter((v): v is string => typeof v === 'string');
  if (deciders.length < 1 || deciders.length > MAX_DECIDERS) return { ok: false };
  if (new Set(deciders).size !== deciders.length) return { ok: false };
  const offered = new Set(choices.people.map((p) => p.id));
  if (!deciders.every((d) => offered.has(d))) return { ok: false };
  return { ok: true, memoryRef: memoryId, deciders };
}
