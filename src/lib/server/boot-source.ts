import type { GraphQLClient } from 'graphql-request';
import { extractGqlErrorCode } from './gqlError';
import { AGENT_BOOT_POINTER_QUERY, AGENT_BOOT_START_QUERY, BOOT_COMPILED_QUERY, BOOT_SOURCE_APPROVAL_QUERY, BOOT_SOURCE_LINT_QUERY, BOOT_SOURCE_QUERY } from './queries';
import { approvalView, bindApprovalToRevision, type ApprovalView, type NodeApprovalRead, type NodeApprovalStatus } from '$lib/node-approval';
import type { PointerRead } from '$lib/boot-prompt-pointer';

/** The fixed address of an Agent's boot-prompt source node. */
export const BOOT_SOURCE_LOC = 'boot:source';

/**
 * portal#1377 S1: which editor the Boot prompt tab offers. The loader decides;
 * the component only renders. A failed read is never `legacy`: falling back
 * to compiled prompt text would silently reintroduce the wrong-text bug,
 * because workers are no longer served that field once a pointer is set.
 */
export type BootSourceView =
  | { mode: 'unknown' }
  | {
      /**
       * No pointer, no source: the legacy editor. portal#1378 case 2: `canStart`
       * only when the source read succeeded and found none (a refused or failed
       * read may hide an existing one, so it offers nothing).
       */
      mode: 'legacy';
      canStart: boolean;
    }
  | {
      /**
       * Pointer set, no `boot:source` (portal#1378 case 1). `compiled` is the seed
       * a started source would get; null when it could not be read.
       */
      mode: 'source-missing';
      compiled: CompiledView | null;
      canStart: boolean;
    }
  | { mode: 'source-unreadable' }
  | {
      /** R1 (c): the source is withheld, the compiled prompt is readable. Read-only, no writes. */
      mode: 'compiled-only';
      compiled: CompiledView;
    }
  | {
      mode: 'source';
      /**
       * portal#1485: the tab no longer edits the source; it links to the node page
       * (`memoryId` + `id`). `approval` is advisory: approving the source never gates a compile.
       */
      node: SourceView;
      /** The compiled node; null when it could not be read, which says nothing about approval or serving. */
      compiled: CompiledView | null;
      /** portal#1378: the Agent has a source but no pointer yet (no compile has run), so nothing is served. */
      noPointer?: true;
    };

export interface SourceView { id: string; urn: string; memoryId: string; revision: number; content: string; approval: ApprovalView }

export interface LintItem {
  kind: string; position: number; text: string;
  targetUrn: string | null; pinnedRevision: number | null; newerRevision: number | null; workerField: string | null;
}
export interface LintView { items: LintItem[]; total: number; nextCursor: string | null }
export interface CompiledView {
  id: string; urn: string; revision: number; content: string;
  /** For the link to the compiled node's page (portal#1485). */
  memoryId: string;
  /** The newest approved revision; null only when the read succeeded and none is approved. */
  approvedRevision: number | null;
  /** The current revision is not approved, so the Approve panel shows. */
  pending: boolean;
  lint: LintView | null;
}

type SourceNode = { id: string; urn: string; revision: number; content: string | null } | null;
type CompiledNode = { id: string; urn: string; memoryId: string; revision: number; content: string | null; approvalStatus: NodeApprovalStatus | null; lintWarnings: LintView | null } | null;

export async function readCompiled(client: Pick<GraphQLClient, 'request'>, ref: string): Promise<CompiledView | null> {
  try {
    const c = (await client.request<{ node: CompiledNode }>(BOOT_COMPILED_QUERY, { ref })).node;
    if (!c) return null;
    const view = approvalView({ ok: true, value: c.approvalStatus });
    return {
      id: c.id, urn: c.urn, memoryId: c.memoryId, revision: c.revision, content: c.content ?? '',
      approvedRevision: view.approval?.revision ?? null,
      pending: view.canApprove,
      lint: c.lintWarnings && c.lintWarnings.total > 0 ? c.lintWarnings : null,
    };
  } catch {
    return null;
  }
}

/**
 * portal#1485: its own read, so a fault here costs only the step 2 status, never the tab.
 * It runs after the source read, so an edit (and an approval of it) can land in between:
 * the status is bound to the revision shown, and one describing another revision is CHANGED.
 */
async function readSourceApproval(client: Pick<GraphQLClient, 'request'>, id: string, shownRevision: number): Promise<ApprovalView> {
  try {
    const n = (await client.request<{ node: NodeApprovalRead | null }>(BOOT_SOURCE_APPROVAL_QUERY, { ref: id })).node;
    return approvalView(bindApprovalToRevision(n, shownRevision));
  } catch {
    return approvalView({ ok: false });
  }
}

async function sourceView(client: Pick<GraphQLClient, 'request'>, node: NonNullable<SourceNode>, memoryId: string): Promise<SourceView> {
  return { id: node.id, urn: node.urn, memoryId, revision: node.revision, content: node.content ?? '', approval: await readSourceApproval(client, node.id, node.revision) };
}

export async function readBootSource(
  client: Pick<GraphQLClient, 'request'>,
  pointer: PointerRead,
  systemMemoryId: string | null | undefined,
): Promise<BootSourceView> {
  if (!pointer.ok) return { mode: 'unknown' };
  if (!systemMemoryId) {
    return pointer.ref ? { mode: 'source-missing', compiled: null, canStart: false } : { mode: 'legacy', canStart: false };
  }
  let node: SourceNode;
  try {
    node = (await client.request<{ node: SourceNode }>(BOOT_SOURCE_QUERY, { ref: BOOT_SOURCE_LOC, memoryRef: systemMemoryId })).node;
  } catch (e) {
    const code = extractGqlErrorCode(e);
    // No pointer: the legacy editor stays, and a failed read offers no Start (the source may exist).
    if (!pointer.ref) return { mode: 'legacy', canStart: false };
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
  if (!pointer.ref) {
    // portal#1378: a source started for a pointer-less Agent shows here (edited on its node page) until its first compile sets the pointer.
    return node
      ? { mode: 'source', node: await sourceView(client, node, systemMemoryId), compiled: null, noPointer: true }
      : { mode: 'legacy', canStart: true };
  }
  if (!node) return { mode: 'source-missing', compiled: await readCompiled(client, pointer.ref), canStart: true };
  const [view, compiled] = await Promise.all([sourceView(client, node, systemMemoryId), readCompiled(client, pointer.ref)]);
  return { mode: 'source', node: view, compiled };
}

export interface SourceLintItem {
  kind: string; position: number; targetUrn: string | null; pinnedRevision: number | null; newerRevision: number | null;
}
export interface SourceLintPage { items: SourceLintItem[]; total: number; nextCursor: string | null }
/** `page` null is the server saying lint is unavailable, which is not an empty list. */
export interface SourceLintRead { id: string; revision: number; page: SourceLintPage | null }

/** The source's memory, from the Agent: never a node id from the browser. */
async function sourceMemory(client: Pick<GraphQLClient, 'request'>, agentRef: string): Promise<string | null> {
  const { agent } = await client.request<{ agent: { systemMemoryId: string | null } | null }>(AGENT_BOOT_START_QUERY, { ref: agentRef });
  return agent?.systemMemoryId ?? null;
}

/** portal#1667: null when the Agent has no source; a failed read throws. The server owns the cursor. */
export async function readSourceLint(client: Pick<GraphQLClient, 'request'>, agentRef: string, after: string | null): Promise<SourceLintRead | null> {
  const memoryRef = await sourceMemory(client, agentRef);
  if (!memoryRef) return null;
  const { node } = await client.request<{ node: { id: string; revision: number; lintWarnings: SourceLintPage | null } | null }>(BOOT_SOURCE_LINT_QUERY, { ref: BOOT_SOURCE_LOC, memoryRef, after });
  return node ? { id: node.id, revision: node.revision, page: node.lintWarnings } : null;
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
    const c = await readCompiled(client, ref);
    return c ? c.approvedRevision : undefined;
  } catch {
    return undefined;
  }
}
