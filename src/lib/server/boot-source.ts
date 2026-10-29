import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from './gqlError';
import { AGENT_BOOT_POINTER_QUERY, BOOT_COMPILED_QUERY, BOOT_SOURCE_QUERY } from './queries';
import { approvalView, type NodeApprovalStatus } from '$lib/node-approval';
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
      /** The compiled node; null when it could not be read (the editor still works). */
      compiled: CompiledView | null;
    };

export interface LintItem {
  kind: string; position: number; text: string;
  targetUrn: string | null; pinnedRevision: number | null; newerRevision: number | null; workerField: string | null;
}
export interface LintView { items: LintItem[]; total: number; nextCursor: string | null }
export interface CompiledView {
  id: string; urn: string; revision: number; content: string;
  /** The revision workers get: the newest approved one; null when none is approved. */
  approvedRevision: number | null;
  /** The current revision is not approved, so the Approve panel shows. */
  pending: boolean;
  lint: LintView | null;
}

type SourceNode = { id: string; urn: string; revision: number; content: string | null } | null;
type CompiledNode = { id: string; urn: string; revision: number; content: string | null; approvalStatus: NodeApprovalStatus | null; lintWarnings: LintView | null } | null;

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
  let compiled: CompiledView | null = null;
  try {
    const c = (await client.request<{ node: CompiledNode }>(BOOT_COMPILED_QUERY, { ref: pointer.ref })).node;
    if (c) {
      const view = approvalView({ ok: true, value: c.approvalStatus });
      compiled = {
        id: c.id, urn: c.urn, revision: c.revision, content: c.content ?? '',
        approvedRevision: view.approval?.revision ?? null,
        pending: view.canApprove,
        lint: c.lintWarnings && c.lintWarnings.total > 0 ? c.lintWarnings : null,
      };
    }
  } catch {
    // Without the compiled node the status line and Approve panel are absent; the editor still works.
  }
  return { mode: 'source', node: { id: node.id, urn: node.urn, revision: node.revision, content: node.content ?? '' }, compiled };
}

/**
 * The revision workers get now, for a refusal's "nothing changed" line.
 * undefined when it couldn't be read: the line then makes no claim about it.
 */
export async function readServedRevision(client: Pick<GraphQLClient, 'request'>, agentRef: string): Promise<number | null | undefined> {
  try {
    const p = await client.request<{ agent: { bootPromptRef: string | null } | null }>(AGENT_BOOT_POINTER_QUERY, { ref: agentRef });
    const ref = p.agent?.bootPromptRef;
    if (!ref) return undefined;
    const c = (await client.request<{ node: CompiledNode }>(BOOT_COMPILED_QUERY, { ref })).node;
    return c ? approvalView({ ok: true, value: c.approvalStatus }).approval?.revision ?? null : undefined;
  } catch {
    return undefined;
  }
}
