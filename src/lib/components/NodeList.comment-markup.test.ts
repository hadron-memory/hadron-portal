import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeList from './NodeList.svelte';
import { commentSearchNode, userAgentAuthor } from '$lib/test/fixtures/comment-search-pins';

describe('#1058 valid comment rows', () => {
  it('renders USER_AGENT identities, via and the actual agent URN; null has no empty chip', () => {
    const node = commentSearchNode({ author: userAgentAuthor });
    const body = render(NodeList, { props: { nodes: [node] } }).body;
    expect(body).toContain('user-citrine'); expect(body).toContain('agent-malachite');
    expect(body).toContain('via agent-malachite</span>'); expect(body).toContain(userAgentAuthor.agent!.urn!);
    const absent = commentSearchNode({ author: { ...userAgentAuthor, agent: { ...userAgentAuthor.agent!, urn: null } } });
    const noUrn = render(NodeList, { props: { nodes: [absent] } }).body;
    expect(noUrn).toContain('agent-malachite');
    expect(noUrn).not.toContain(userAgentAuthor.agent!.urn!);
    expect((body.match(/<code /g) ?? []).length).toBe(3); // row, agent, target
    expect((noUrn.match(/<code /g) ?? []).length).toBe(2); // no empty agent chip
  });
  it('marks only deleted:true with the current deleted chip', () => {
    const chip = (deleted: boolean) => render(NodeList, { props: { nodes: [commentSearchNode({ deleted })] } }).body;
    expect(chip(true)).toMatch(/<span[^>]*>deleted<\/span>/);
    expect(chip(false)).not.toMatch(/<span[^>]*>deleted<\/span>/);
  });
  it('renders target-discussion title links for explicit and memory-derived bases', () => {
    const node = commentSearchNode();
    const explicit = render(NodeList, { props: { nodes: [node], basePath: '/app/memories/explicit' } }).body;
    expect(explicit).toContain('href="/app/memories/explicit/nodes/target-pins?tab=discussion"');
    const fallback = render(NodeList, { props: { nodes: [node] } }).body;
    expect(fallback).toContain('href="/app/memories/memory-pins/nodes/target-pins?tab=discussion"');
  });
  it('renders a plain title, not an empty/undefined link, for a valid target without a base', () => {
    const node = { ...commentSearchNode(), memory: undefined };
    const body = render(NodeList, { props: { nodes: [node] } }).body;
    expect(body).toMatch(/<span class="font-medium text-zinc-900 dark:text-white">row-saffron<\/span>/);
    expect(body).not.toMatch(/href="(?:|undefined[^"]*)"/);
  });
});
