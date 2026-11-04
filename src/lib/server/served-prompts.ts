import type { GraphQLClient } from 'graphql-request';
import {
  SERVED_LINT_PAGE,
  SERVED_PROVENANCE_PAGE,
  type ServedLintWarning,
  type ServedPromptSource,
  type ServedPromptView,
  type ServedPromptsResponse,
} from '$lib/served-prompts';

/** Never selects `compiledNodeId`'s content, a loc or a name: the record carries ids, revisions and hashes only. */
const RECORD = /* GraphQL */ `fragment ServedRecord on ServedPrompt {
  id
  kind
  ordinal
  pointerLevel
  servedAt
  servedRevSeq
  provenanceRevSeq
  pruned
  compiledNodeId
  compiledContentHash
  variables
  provenance(limit: $provLimit, offset: $provOffset) { items { revSeq hash pruned } total }
  currentLint(first: $lintFirst, after: $lintAfter) {
    items { kind position pinnedRevision newerRevision workerField targetUrn }
    nextCursor
    total
  }
}
`;

export const WORKER_SERVED_QUERY = /* GraphQL */ `query WorkerServedPrompt($ref: ID!, $provLimit: Int, $provOffset: Int, $lintFirst: Int, $lintAfter: String) { worker(ref: $ref) { servedPrompt { ...ServedRecord } } } ${RECORD}`;
export const SESSION_SERVED_QUERY = /* GraphQL */ `query SessionServedPrompts($id: ID!, $limit: Int, $offset: Int, $provLimit: Int, $provOffset: Int, $lintFirst: Int, $lintAfter: String) { session(id: $id) { servedPrompts(limit: $limit, offset: $offset) { items { ...ServedRecord } total } } } ${RECORD}`;
export const RUN_SERVED_QUERY = /* GraphQL */ `query RunServedPrompt($ref: ID!, $provLimit: Int, $provOffset: Int, $lintFirst: Int, $lintAfter: String) { appRun(ref: $ref) { servedPrompt { ...ServedRecord } } } ${RECORD}`;
export const CHAT_SERVED_QUERY = /* GraphQL */ `query ChatServedPrompts($chatId: ID!, $limit: Int, $offset: Int, $provLimit: Int, $provOffset: Int, $lintFirst: Int, $lintAfter: String) { chatServedPrompts(chatId: $chatId, limit: $limit, offset: $offset) { items { ...ServedRecord } total } } ${RECORD}`;
/** Names come from THIS read, as the viewer; `content` is never selected. */
export const SERVED_NODE_NAMES_QUERY = /* GraphQL */ `query ServedPromptNodeNames($refs: [ID!]) { nodeBatch(refs: $refs) { nodes { id urn name } } }`;

interface RawRecord extends Omit<ServedPromptView, 'node' | 'provenance' | 'lint'> {
  compiledNodeId: string;
  provenance: { items: ServedPromptView['provenance']['items']; total: number };
  currentLint: { items: ServedLintWarning[]; nextCursor: string | null; total: number } | null;
}

export interface ServedPromptPaging {
  /** Record page (session and chat only; a worker and a run have at most one record). */
  limit: number;
  offset: number;
  provenanceOffset: number;
  lintAfter: string | null;
}

export interface ServedPromptRead {
  source: ServedPromptSource;
  /** Worker id/ref, session id, run id, or the CHAT ROW id (never a browser-supplied one: see the route). */
  ref: string;
}

/** The viewer's own read of the compiled nodes' names. A failed read means no name, not a failed section. */
async function nodeNames(client: GraphQLClient, ids: string[]): Promise<Map<string, { urn: string; name: string }>> {
  const out = new Map<string, { urn: string; name: string }>();
  if (ids.length === 0) return out;
  try {
    const res = await client.request<{ nodeBatch: { nodes: Array<{ id: string; urn: string | null; name: string | null }> } }>(SERVED_NODE_NAMES_QUERY, { refs: ids });
    for (const n of res.nodeBatch.nodes) if (n.urn && n.name) out.set(n.id, { urn: n.urn, name: n.name });
  } catch {
    // Unavailable means no name and no chip. Nothing is inferred from the record.
  }
  return out;
}

export async function readServedPrompts(client: GraphQLClient, read: ServedPromptRead, paging: ServedPromptPaging): Promise<ServedPromptsResponse> {
  const vars = {
    provLimit: SERVED_PROVENANCE_PAGE,
    provOffset: paging.provenanceOffset,
    lintFirst: SERVED_LINT_PAGE,
    lintAfter: paging.lintAfter,
  };
  let raw: RawRecord[];
  let total: number;
  if (read.source === 'worker') {
    const r = await client.request<{ worker: { servedPrompt: RawRecord | null } | null }>(WORKER_SERVED_QUERY, { ref: read.ref, ...vars });
    raw = r.worker?.servedPrompt ? [r.worker.servedPrompt] : [];
    total = raw.length;
  } else if (read.source === 'run') {
    const r = await client.request<{ appRun: { servedPrompt: RawRecord | null } | null }>(RUN_SERVED_QUERY, { ref: read.ref, ...vars });
    raw = r.appRun?.servedPrompt ? [r.appRun.servedPrompt] : [];
    total = raw.length;
  } else if (read.source === 'session') {
    const r = await client.request<{ session: { servedPrompts: { items: RawRecord[]; total: number } } | null }>(SESSION_SERVED_QUERY, { id: read.ref, limit: paging.limit, offset: paging.offset, ...vars });
    raw = r.session?.servedPrompts.items ?? [];
    total = r.session?.servedPrompts.total ?? 0;
  } else {
    const r = await client.request<{ chatServedPrompts: { items: RawRecord[]; total: number } }>(CHAT_SERVED_QUERY, { chatId: read.ref, limit: paging.limit, offset: paging.offset, ...vars });
    raw = r.chatServedPrompts.items;
    total = r.chatServedPrompts.total;
  }

  const names = await nodeNames(client, [...new Set(raw.map((rec) => rec.compiledNodeId))]);
  const items: ServedPromptView[] = raw.map((rec) => ({
    id: rec.id,
    kind: rec.kind,
    ordinal: rec.ordinal,
    pointerLevel: rec.pointerLevel,
    servedAt: rec.servedAt,
    servedRevSeq: rec.servedRevSeq,
    provenanceRevSeq: rec.provenanceRevSeq,
    pruned: rec.pruned,
    compiledContentHash: rec.compiledContentHash,
    variables: rec.variables,
    node: names.get(rec.compiledNodeId) ?? null,
    provenance: { items: rec.provenance.items, total: rec.provenance.total, offset: paging.provenanceOffset },
    lint: rec.currentLint ? { items: rec.currentLint.items, total: rec.currentLint.total, nextCursor: rec.currentLint.nextCursor } : null,
  }));
  return { items, total, offset: paging.offset };
}
