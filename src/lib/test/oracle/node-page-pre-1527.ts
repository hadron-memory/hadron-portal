// ORACLE for portal#1433: the node page loader's breadcrumb and chat-root
// lookups as they ran at 3b333cf0^ (the last commit before #1527 took the node
// list off), over the layout's `graphNodes`. The statements are copied from
// `src/routes/app/memories/[id]/nodes/[nodeId]/+page.server.ts` at that commit
// (lines 185-260 and 481-487), only lifted out of `load()` into functions and
// with their long comments trimmed. Test-only; do not import from app code.
//   git show '3b333cf0^:src/routes/app/memories/[id]/nodes/[nodeId]/+page.server.ts'
import { chatRootLocForMessage, isChatMessageNode, isChatNode } from '$lib/server/team-chat';
import { composeNodeUrn } from '$lib/urn/compose-node-urn';

export type OracleNode = {
  id: string;
  memoryId: string;
  loc: string;
  name?: string | null;
  nodeType?: string;
  tags?: string[];
};

export function oldBreadcrumb(
  memoryNodes: OracleNode[],
  params: { id: string },
  graph: { urn?: string | null } | null | undefined,
  node: { loc: string },
) {
  const ancestorByLoc = new Map<string, { id: string; name: string | null }>();
  for (const n of memoryNodes) {
    if (n.memoryId === params.id) ancestorByLoc.set(n.loc, { id: n.id, name: n.name ?? null });
  }

  const ancestorUrn = (loc: string): string | null => {
    if (!graph?.urn) return null;
    try {
      return composeNodeUrn(graph.urn, loc);
    } catch {
      return null;
    }
  };

  const parts = node.loc.split(':');
  const breadcrumb: Array<{
    label: string;
    path: string;
    nodeId: string | null;
    title?: string;
  }> = [];

  for (let i = 0; i < parts.length; i++) {
    const ancestorLoc = parts.slice(0, i + 1).join(':');
    let nodeId: string | null = null;
    let label = parts[i];
    let title: string | undefined;
    if (i < parts.length - 1) {
      const hit = ancestorByLoc.get(ancestorLoc);
      nodeId = hit?.id ?? null;
      if (hit?.name) {
        label = hit.name;
        title = ancestorUrn(ancestorLoc)
          ? `${hit.name} — ${ancestorUrn(ancestorLoc)}`
          : `${hit.name} — ${ancestorLoc}`;
      }
    }
    breadcrumb.push({ label, path: ancestorLoc, nodeId, title });
  }
  return breadcrumb;
}

export function oldOpenChat(
  memoryNodes: OracleNode[],
  params: { id: string },
  node: { loc: string; nodeType: string; tags?: string[] | null },
) {
  const isChatMessage = isChatMessageNode(node as Parameters<typeof isChatMessageNode>[0]);
  const chatRootLoc = isChatMessage ? chatRootLocForMessage(node.loc) : null;
  const chatRoot = chatRootLoc
    ? memoryNodes.find((n) => n.memoryId === params.id && n.loc === chatRootLoc)
    : undefined;
  const openChat = chatRoot && isChatNode(chatRoot as Parameters<typeof isChatNode>[0], { legacyThread: node.nodeType === 'message' })
    ? { nodeId: chatRoot.id, loc: chatRoot.loc, name: chatRoot.name ?? chatRoot.loc }
    : null;
  return openChat;
}
