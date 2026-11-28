/**
 * #2653 — whether a memory's URN slug can never change. The server's rule (hrn:node:hadronmemory.com:specs:cor:dmo:060:20,
 * `assertMemorySlugMayChange`): a personal or private memory that has an App keeps its slug for good, attached
 * memories included. Presentation only: the server stays the gate, and this must follow its predicate, not widen it.
 */
export function memorySlugIsFixed(memory: { class?: string | null; appId?: string | null }): boolean {
  return (memory.class === 'personal' || memory.class === 'private') && !!memory.appId;
}
