import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from './gqlError';
import { BOOT_COMPILED_QUERY, BOOT_SOURCE_QUERY } from './queries';
import type { PointerRead } from '$lib/boot-prompt-pointer';

/** The fixed address of an Agent's boot-prompt source node. */
export const BOOT_SOURCE_LOC = 'boot:source';

/**
 * portal#1377 S1: which editor the Boot prompt tab offers. The loader decides;
 * the component only renders. A failed read is never `legacy`: falling back
 * to the `systemPrompt` field would silently reintroduce the wrong-text bug,
 * because workers are no longer served that field once a pointer is set.
 */
export type BootSourceView =
  | { mode: 'unknown' }
  | { mode: 'legacy' }
  | { mode: 'source-missing' }
  | { mode: 'source-unreadable' }
  | {
      /** R1 (c): the source is withheld, the compiled prompt is readable. Read-only, no writes. */
      mode: 'compiled-only';
      compiled: CompiledLite;
    }
  | {
      mode: 'source';
      node: { id: string; urn: string; revision: number; content: string };
      /** The compiled node; null when it could not be read, which says nothing about approval or serving. */
      compiled: CompiledLite | null;
    };

export interface CompiledLite {
  urn: string; revision: number; content: string;
  /** The newest approved revision; null only when the read succeeded and none is approved. */
  approvedRevision: number | null;
}

type SourceNode = { id: string; urn: string; revision: number; content: string | null } | null;
type CompiledNode = { urn: string; revision: number; content: string | null; approvalStatus: { approval: { revision: number } | null } | null } | null;

async function readCompiled(client: Pick<GraphQLClient, 'request'>, ref: string): Promise<CompiledLite | null> {
  try {
    const c = (await client.request<{ node: CompiledNode }>(BOOT_COMPILED_QUERY, { ref })).node;
    if (!c) return null;
    return { urn: c.urn, revision: c.revision, content: c.content ?? '', approvedRevision: c.approvalStatus?.approval?.revision ?? null };
  } catch {
    return null;
  }
}

export async function readBootSource(
  client: Pick<GraphQLClient, 'request'>,
  pointer: PointerRead,
  systemMemoryId: string | null | undefined,
): Promise<BootSourceView> {
  if (!pointer.ok) return { mode: 'unknown' };
  if (!pointer.ref) return { mode: 'legacy' };
  if (!systemMemoryId) return { mode: 'source-missing' };
  let node: SourceNode;
  try {
    node = (await client.request<{ node: SourceNode }>(BOOT_SOURCE_QUERY, { ref: BOOT_SOURCE_LOC, memoryRef: systemMemoryId })).node;
  } catch (e) {
    const code = extractGqlErrorCode(e);
    // The real server conceals a source in a memory the caller can't read as
    // MEMORY_NOT_FOUND, the code a missing memory gets (a scoped node read answers
    // alike for both, so existence is never disclosed), and FORBIDDEN elsewhere.
    // Both are the withheld case: the reader may still see the compiled prompt (R1 c).
    // Neither is inferred to mean "missing". A real outage carries another code
    // and stays unknown.
    if (code === 'FORBIDDEN' || code === 'MEMORY_NOT_FOUND') {
      const compiled = await readCompiled(client, pointer.ref);
      return compiled ? { mode: 'compiled-only', compiled } : { mode: 'source-unreadable' };
    }
    console.warn('[boot-source] source read failed:', code);
    return { mode: 'unknown' };
  }
  if (!node) return { mode: 'source-missing' };
  const compiled = await readCompiled(client, pointer.ref);
  return { mode: 'source', node: { id: node.id, urn: node.urn, revision: node.revision, content: node.content ?? '' }, compiled };
}
