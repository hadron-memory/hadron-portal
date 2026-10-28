import { readTaskWarnings } from '$lib/agent-tasks/warnings';

/** Fixed public advisory from the node-write response contract (portal#1363). */
export const INCLUDE_PIN_UNKEPT = 'include.pin.unkept';
export const INCLUDE_PIN_UNKEPT_TEXT = 'A pinned include revision carries no recorded approval or signature and may be automatically pruned, breaking the include.';

/** Decode only the public fixed advisory, bound to a successful root response key.
 * No history/target read and no inference from the content being submitted. */
export function readNodeAdvice(response: unknown): string[] {
  if (!response || typeof response !== 'object' || response instanceof Error) return [];
  const r = response as { data?: unknown; extensions?: unknown; errors?: unknown };
  if (!r.data || typeof r.data !== 'object' || Array.isArray(r.data)) return [];
  const errors = Array.isArray(r.errors) ? r.errors : [];
  // An unpathed error cannot safely be attributed to a different operation.
  if (errors.some((e) => !e || typeof e !== 'object' || !Array.isArray(e.path) || !e.path.length || typeof e.path[0] !== 'string')) return [];
  for (const [path, value] of Object.entries(r.data)) {
    if (value == null || errors.some((e) => e.path[0] === path)) continue;
    if (readTaskWarnings(r.extensions, path).warnings.some((w) => w.code === INCLUDE_PIN_UNKEPT && w.text === INCLUDE_PIN_UNKEPT_TEXT)) {
      return [INCLUDE_PIN_UNKEPT_TEXT]; // coalesce bulk/duplicate warnings; bounded flash
    }
  }
  return [];
}
