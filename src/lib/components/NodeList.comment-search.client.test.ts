import { afterEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, type Mounted } from '$lib/test/mountComponent';
import { commentSearchNode, userAgentAuthor } from '$lib/test/fixtures/comment-search-pins';
import NodeList from './NodeList.svelte';

let mounted: Mounted<any> | undefined;
afterEach(() => { mounted?.unmount(); mounted = undefined; });
const base = commentSearchNode();
const cases = [
  ['name', 'row-saffron', base],
  ['open role', 'Open discussion', base],
  ['resolved role', 'Resolved discussion', commentSearchNode({ state: 'RESOLVED' })],
  ['reply role', 'Reply', commentSearchNode({ isTopLevel: false, state: null })],
  ['deleted badge', 'deleted', commentSearchNode({ deleted: true })],
  ['author label', 'author-quartz', base],
  ['author URN', 'hrn:worker:example.com:team:author-address', base],
  ['user label', 'user-citrine', commentSearchNode({ author: userAgentAuthor })],
  ['agent label', 'agent-malachite', commentSearchNode({ author: userAgentAuthor })],
  ['agent URN', 'hrn:agent:example.com:agent-address', commentSearchNode({ author: userAgentAuthor })],
  ['target name', 'target-beryl', base],
  ['target URN', 'hrn:node:example.com:comment-pins:target-address', base],
  ['current anchor', 'On revision 7, the current one', base],
  ['older anchor', 'On revision 7; the target is now at 13', commentSearchNode({ target: { ...base.comment!.target, revSeq: 13 } })],
] as const;

describe('#1058 real table search', () => {
  it.each(cases)('finds the displayed %s and excludes unrelated rows', (_name, query, node) => {
    const control = { ...commentSearchNode(), id: 'control', name: 'control-obsidian', comment: undefined, nodeType: 'info' };
    mounted = mountComponent(NodeList, { nodes: [node, control] });
    const { target } = mounted;
    target.querySelector<HTMLButtonElement>('[data-testid="table-header-toggle"]')!.click(); flushSync();
    const input = target.querySelector<HTMLInputElement>('input[placeholder="Search nodes..."]')!;
    const search = (text: string) => { input.value = text; input.dispatchEvent(new Event('input', { bubbles: true })); flushSync(); };
    const rows = () => [...target.querySelectorAll('tbody tr')].map(r => r.textContent ?? '');
    expect(rows()).toHaveLength(2);
    if (query.startsWith('hrn:')) expect(target.querySelector(`tbody [title="${query}"]`)).not.toBeNull();
    else expect(rows()[0]).toContain(query);
    search(query);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('row-saffron');
    expect(rows()[0]).not.toContain('control-obsidian');
    search('absent-tourmaline'); expect(rows()).toHaveLength(0);
    search('control-obsidian'); expect(rows()).toHaveLength(1);
    expect(rows()[0]).not.toContain(query);
    search(''); expect(rows()).toHaveLength(2);
  });
});
