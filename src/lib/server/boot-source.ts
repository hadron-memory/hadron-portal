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
      mode: 'source';
      node: { id: string; urn: string; revision: number; content: string };
      /** The compiled node's approved revision; null when none is approved or it could not be read. */
      approvedRevision: number | null;
    };

type SourceNode = { id: string; urn: string; revision: number; content: string | null } | null;
type CompiledNode = { approvalStatus: { approval: { revision: number } | null } | null } | null;

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
    if (code === 'FORBIDDEN') return { mode: 'source-unreadable' };
    console.warn('[boot-source] source read failed:', code);
    return { mode: 'unknown' };
  }
  if (!node) return { mode: 'source-missing' };
  let approvedRevision: number | null = null;
  try {
    const compiled = (await client.request<{ node: CompiledNode }>(BOOT_COMPILED_QUERY, { ref: pointer.ref })).node;
    approvedRevision = compiled?.approvalStatus?.approval?.revision ?? null;
  } catch {
    // The status line only loses the revision number; the editor still works.
  }
  return { mode: 'source', node: { id: node.id, urn: node.urn, revision: node.revision, content: node.content ?? '' }, approvedRevision };
}
