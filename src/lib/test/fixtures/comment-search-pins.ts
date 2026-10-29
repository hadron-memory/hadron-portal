import type { MemoryNode } from '$lib/types';
import type { CommentHit } from '$lib/comments';

export function commentSearchNode(overrides: Partial<CommentHit> = {}): MemoryNode {
  return {
    id: 'comment-row', memoryId: 'memory-pins', memory: { id: 'memory-pins', name: 'Pins', urn: 'hrn:mem:example.com:comment-pins' },
    loc: 'row-address', name: 'row-saffron', nodeType: 'comment', alias: null, description: null, abstract: null,
    content: null, tokens: null, tags: [], seq: null, data: null, ownerRepo: null, isRunnable: false,
    createdAt: '2026-10-18T12:00:00Z', updatedAt: '2026-10-18T12:00:00Z', outgoingEdges: [], incomingEdges: [],
    comment: {
      id: 'comment-row', isTopLevel: true, state: 'OPEN', anchorRevision: 7, deleted: false,
      author: { kind: 'WORKER', worker: { id: 'w', name: 'author-quartz', handle: null, urn: 'hrn:worker:example.com:team:author-address' }, user: null, agent: null, app: null },
      target: { id: 'target-pins', name: 'target-beryl', nodeType: 'info', revSeq: 7, urn: 'hrn:node:example.com:comment-pins:target-address' },
      ...overrides,
    },
  };
}
export const userAgentAuthor: CommentHit['author'] = {
  kind: 'USER_AGENT', user: { id: 'u', name: 'user-citrine', handle: null, urn: null }, worker: null, app: null,
  agent: { id: 'a', name: 'agent-malachite', handle: null, urn: 'hrn:agent:example.com:agent-address' },
};
