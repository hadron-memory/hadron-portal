import type { AppMemoryRow, AttachableMemory } from './app-memories';

// Client-safe on purpose: the picker component filters with this, and app-memories.ts pulls in server-only modules.
/** A memory already in this App's scope is left out: linking it again does nothing. An unavailable scope leaves the list whole. */
export function notYetInScope(candidates: AttachableMemory[], scope: AppMemoryRow[] | null): AttachableMemory[] {
  if (!scope) return candidates;
  const held = new Set(scope.map(m => m.id));
  return candidates.filter(m => !held.has(m.id));
}
