import { composeUrnV2, parseUrnV2 } from './parse-urn';

/**
 * Derive an organization URN from the root of an already-disclosed canonical
 * memory URN. Any other shape fails closed: owner attribution must never be
 * guessed from a malformed, legacy, fragmented, or non-memory identity.
 */
export function memoryOwnerOrgUrn(memoryUrn: string | null | undefined): string | null {
  if (typeof memoryUrn !== 'string' || !memoryUrn.startsWith('hrn:')) return null;
  try {
    const parsed = parseUrnV2(memoryUrn);
    if (parsed.type !== 'mem' || parsed.segments.length !== 1 || parsed.fragment) return null;
    return composeUrnV2('org', parsed.root);
  } catch {
    return null;
  }
}
