/**
 * Compose a canonical node URN from a memory URN and a value (loc, or PK
 * as a defect-fallback chosen by the caller). Strict at input: throws on
 * wrong-type prefix, empty inputs. Forgiving at shape: accepts the memory
 * URN with or without its `urn:memory:` prefix.
 *
 * Spec: 010-always-show-full-urn FR-007.
 * Memory: `urn:node:hadronmemory.com:dev:conventions:urn-format`.
 */
export function composeNodeUrn(memoryUrn: string, value: string): string {
  if (!memoryUrn) {
    throw new Error('composeNodeUrn: memoryUrn is empty');
  }
  if (!value) {
    throw new Error('composeNodeUrn: value is empty');
  }

  let slugPath: string;
  if (memoryUrn.startsWith('urn:memory:')) {
    slugPath = memoryUrn.slice('urn:memory:'.length);
  } else if (memoryUrn.startsWith('urn:')) {
    // Wrong-type prefix — silent coercion is a security risk (the wrong
    // owner URN could resolve to an unauthorized resource downstream).
    throw new Error(
      `composeNodeUrn: memoryUrn must start with 'urn:memory:' or be a bare slug-path; got '${memoryUrn}'`,
    );
  } else {
    slugPath = memoryUrn;
  }

  return `urn:node:${slugPath}:${value}`;
}
