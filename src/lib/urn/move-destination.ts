import { composeNodeUrn } from './compose-node-urn';

/**
 * #1164 — the Move dialog's Location mode. The destination `target` URN stays
 * the single authoritative value (it is what the form submits); Location is
 * just a view of its loc segment while the target is in the node's own memory.
 * Both directions go through composeNodeUrn, so a legacy ownership-chain
 * memory keeps its `::` form instead of being flattened.
 */

/** Everything composeNodeUrn puts before the loc for this memory. */
function memoryPrefix(memoryUrn: string): string {
  return composeNodeUrn(memoryUrn, 'x').slice(0, -1);
}

/** The loc of `target` when it lives in `memoryUrn`; null for any other memory. */
export function locOfSameMemoryTarget(memoryUrn: string, target: string): string | null {
  if (!memoryUrn) return null;
  const prefix = memoryPrefix(memoryUrn);
  return target.startsWith(prefix) ? target.slice(prefix.length) : null;
}

/** The destination for a Location typed in the node's own memory; '' when blank. */
export function sameMemoryTarget(memoryUrn: string, location: string): string {
  const loc = location.trim();
  return memoryUrn && loc ? composeNodeUrn(memoryUrn, loc) : '';
}
