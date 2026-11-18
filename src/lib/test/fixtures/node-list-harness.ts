// portal#1315: mounts the real NodeList, search visible, for
// scripts/test-node-list-search.mjs. Loaded through Vite so `$lib` aliases and
// the component's own Svelte compile apply. The fourteen cases mirror
// NodeList.comment-search.client.test.ts (#1058): each query is a string the
// comment row displays, and the script runs it against the real table filter in
// Chromium. MemoryBrowser keeps hideSearch={true}; only this harness shows it.
// USER_AGENT `via`, no-base/no-link rows stay component/seam-only; the deleted
// badge is reached here by a synthetic `deleted: true` fixture.
import { flushSync, mount, unmount } from 'svelte';
import NodeList from '../../components/NodeList.svelte';
import { commentSearchNode, userAgentAuthor } from './comment-search-pins';

const base = commentSearchNode();
export const NODE_LIST_CASES = [
  { name: 'name', query: 'row-saffron', node: base },
  { name: 'open role', query: 'Open discussion', node: base },
  { name: 'resolved role', query: 'Resolved discussion', node: commentSearchNode({ state: 'RESOLVED' }) },
  { name: 'reply role', query: 'Reply', node: commentSearchNode({ isTopLevel: false, state: null }) },
  { name: 'deleted badge', query: 'deleted', node: commentSearchNode({ deleted: true }) },
  { name: 'author label', query: 'author-quartz', node: base },
  { name: 'author URN', query: 'hrn:worker:example.com:team:author-address', node: base },
  { name: 'user label', query: 'user-citrine', node: commentSearchNode({ author: userAgentAuthor }) },
  { name: 'agent label', query: 'agent-malachite', node: commentSearchNode({ author: userAgentAuthor }) },
  { name: 'agent URN', query: 'hrn:agent:example.com:agent-address', node: commentSearchNode({ author: userAgentAuthor }) },
  { name: 'target name', query: 'target-beryl', node: base },
  { name: 'target URN', query: 'hrn:node:example.com:comment-pins:target-address', node: base },
  { name: 'current anchor', query: 'On revision 7, the current one', node: base },
  { name: 'older anchor', query: 'On revision 7; the target is now at 13', node: commentSearchNode({ target: { ...base.comment!.target, revSeq: 13 } }) },
];

export function mountNodeList(target: HTMLElement, caseIndex: number): () => void {
  const control = { ...commentSearchNode(), id: 'control', name: 'control-obsidian', comment: undefined, nodeType: 'info' };
  const page = mount(NodeList, { target, props: { nodes: [NODE_LIST_CASES[caseIndex].node, control] } as never });
  flushSync();
  return () => unmount(page);
}
