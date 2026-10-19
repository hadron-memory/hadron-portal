/** #1058: rendered row identities and the REAL table filter, not accessor snapshots. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { mountComponent, tick } from '$lib/test/mountComponent';
import NodeList from './NodeList.svelte';
import type { MemoryNode } from '$lib/types';
import type { CommentHit } from '$lib/comments';

const mounts: Array<{ unmount: () => void }> = [];
beforeEach(() => window.localStorage.clear());
afterEach(() => {
  while (mounts.length) mounts.pop()!.unmount();
  window.localStorage.clear();
});

function comment(id: string, overrides: Partial<CommentHit> = {}): MemoryNode {
  return {
    id, memoryId: 'memory', loc: `comments:${id}`, name: `Note ${id}`,
    nodeType: 'comment', tags: [], description: null, seq: null, isRunnable: false,
    alias: null, abstract: null, content: null, tokens: null, data: null, ownerRepo: null,
    createdAt: '2026-10-19T00:00:00Z', updatedAt: '2026-10-19T00:00:00Z',
    outgoingEdges: [], incomingEdges: [],
    memory: { id: 'memory', urn: 'hrn:mem:example.com:notes', name: 'Notes' },
    comment: {
      id, isTopLevel: true, state: 'OPEN', deleted: false, anchorRevision: 13,
      author: {
        kind: 'USER_AGENT',
        user: { id: 'user', name: 'Author Sentinel', handle: null, urn: 'hrn:user:example.com:author-sentinel' },
        agent: { id: 'agent', name: 'Agent Sentinel', handle: null, urn: 'hrn:agent:example.com:agent-sentinel' },
        worker: null, app: null,
      },
      target: { id: `target-${id}`, name: 'Target Sentinel', urn: 'hrn:node:example.com:notes:target-sentinel', nodeType: 'info', revSeq: 19 },
      ...overrides,
    },
  };
}

function mountRows(nodes: MemoryNode[]) {
  const m = mountComponent(NodeList, { nodes, basePath: '/app/memories/memory' });
  mounts.push(m);
  return m.target;
}

async function search(target: HTMLElement, query: string) {
  const toggle = target.querySelector<HTMLButtonElement>('[data-testid="table-header-toggle"]')!;
  if (toggle.getAttribute('aria-expanded') === 'false') {
    toggle.click();
    await tick();
  }
  const input = target.querySelector<HTMLInputElement>('input[placeholder="Search nodes..."]');
  expect(input).not.toBeNull();
  input!.value = query;
  input!.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  await tick();
}

function titles(target: HTMLElement) {
  return [...target.querySelectorAll('tbody tr')].map((row) => row.querySelector('a.font-medium')?.textContent);
}

it('USER_AGENT renders its user label and agent URN, with nullable chips absent (#1058)', () => {
  const target = mountRows([comment('primary')]);
  const hit = target.querySelector('[data-testid="comment-hit"]')!;
  expect(hit.textContent).toContain('by Author Sentinel');
  expect(hit.textContent).toContain('via Agent Sentinel');
  const urns = [...hit.querySelectorAll('code span[title]')].map((c) => c.getAttribute('title'));
  // USER_AGENT shows the user label, not a user URN; its agent is addressable.
  expect(urns).not.toContain('hrn:user:example.com:author-sentinel');
  expect(urns).toContain('hrn:agent:example.com:agent-sentinel');

  const nullable = comment('nullable');
  nullable.comment!.author.user!.urn = null;
  nullable.comment!.author.agent!.urn = null;
  const absent = mountRows([nullable]).querySelector('[data-testid="comment-hit"]')!;
  expect(absent.textContent).toContain('via Agent Sentinel');
  // Only the target URN remains; neither author gets an empty Urn component.
  expect([...absent.querySelectorAll('code span[title]')].map((c) => c.getAttribute('title')))
    .toEqual(['hrn:node:example.com:notes:target-sentinel']);
});

it('deleted chip is present only when deleted, preserving the current role copy (#1058)', () => {
  const target = mountRows([comment('deleted-row', { deleted: true }), comment('live-row')]);
  const hits = [...target.querySelectorAll('[data-testid="comment-hit"]')];
  expect([...hits[0].querySelectorAll('span')].some((s) => s.textContent === 'deleted')).toBe(true);
  expect([...hits[1].querySelectorAll('span')].some((s) => s.textContent === 'deleted')).toBe(false);
  expect(hits[0].textContent).toContain('Comment · Open discussion');
});

const filterCases: Array<[string, string, Partial<CommentHit>]> = [
  ['row name', 'Unique note title', {}],
  ['open role', 'Open discussion', {}],
  ['resolved role', 'Resolved discussion', { state: 'RESOLVED' }],
  ['reply role', 'Reply', { isTopLevel: false, state: null }],
  ['deleted badge', 'deleted', { deleted: true }],
  ['author label', 'Author Sentinel', {}],
  ['author URN', 'hrn:worker:example.com:team:worker-sentinel', {
    author: { kind: 'WORKER', worker: { id: 'worker', name: 'Worker Sentinel', handle: null, urn: 'hrn:worker:example.com:team:worker-sentinel' }, user: null, agent: null, app: null },
  }],
  ['agent label', 'Agent Sentinel', {}],
  ['agent URN', 'hrn:agent:example.com:agent-sentinel', {}],
  ['target name', 'Target Sentinel', {}],
  ['target URN', 'hrn:node:example.com:notes:target-sentinel', {}],
  ['older anchor', 'On revision 13; the target is now at 19', {}],
  ['current anchor', 'On revision 19, the current one', { anchorRevision: 19 }],
];

describe('comment-search visible tokens (#1058)', () => {
  it.each(filterCases)('%s finds only the row rendering that token', async (_label, query, overrides) => {
    const primary = { ...comment('primary', overrides), name: 'Unique note title' };
    const control = comment('control', {
      isTopLevel: false, state: null, deleted: false, anchorRevision: 7,
      author: { kind: 'USER', user: { id: 'other', name: 'Other writer', handle: null, urn: 'hrn:user:example.com:other' }, worker: null, agent: null, app: null },
      target: { id: 'other-target', name: 'Other subject', urn: 'hrn:node:example.com:notes:other', nodeType: 'info', revSeq: 8 },
    });
    // For the Reply case the negative is a root, not a second reply.
    if (_label === 'reply role') { control.comment!.isTopLevel = true; control.comment!.state = 'OPEN'; }
    // For Open discussion the negative is already a reply; all labels/URNs and
    // anchor phrases are unique, so another column cannot accidentally match.
    const target = mountRows([primary, control]);
    expect(titles(target)).toEqual(['Unique note title', 'Note control']);
    await search(target, query);
    expect(titles(target)).toEqual(['Unique note title']);
    await search(target, 'unrelated-no-row-token');
    expect(titles(target)).toEqual([]);
    await search(target, '');
    expect(titles(target)).toEqual(['Unique note title', 'Note control']);
  });
});
