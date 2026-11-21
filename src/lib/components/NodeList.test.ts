import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';

import NodeList from './NodeList.svelte';
import { NODE_FIELDS } from '$lib/server/queries';

// Regression for the node-listing badge showing loc-only (e.g. `preflight`)
// instead of the full node URN (`micromentor.org:mmdata:preflight`). Two
// halves had to be right: the query had to fetch the node's memory urn, and
// the list had to compose it with the loc.

const node = {
  id: 'n1',
  memoryId: 'm1',
  memory: { id: 'm1', urn: 'micromentor.org::mmdata', name: 'mmdata' },
  nodeType: 'info',
  loc: 'preflight',
  name: 'Preflight',
  description: null,
  tags: [],
} as any;

describe('node listing renders the full node URN, not loc-only', () => {
  // Data-layer guard: the root cause was NODE_FIELDS omitting `memory`, so
  // node.memory?.urn was always undefined and nodeUrn() degraded to the loc.
  it('NODE_FIELDS fetches the node memory urn', () => {
    expect(NODE_FIELDS).toMatch(/memory\s*\{[^}]*\burn\b/);
  });

  // Render-layer guard: with the memory urn supplied via the prop (the
  // single-memory MemoryBrowser path), the badge composes the full URN.
  it('composes the full URN from the memoryUrn prop + loc', () => {
    const { body } = render(NodeList, {
      props: { nodes: [node], memoryUrn: 'micromentor.org::mmdata' },
    });
    expect(body).toContain('micromentor.org:mmdata:preflight');
  });

  // Render-layer guard: with no memoryUrn prop (the multi-memory agent/app
  // path), it falls back to each node's own memory.urn.
  it('falls back to node.memory.urn when no memoryUrn prop is given', () => {
    const { body } = render(NodeList, { props: { nodes: [node] } });
    expect(body).toContain('micromentor.org:mmdata:preflight');
  });
});

// #810 / hadron-server#1128 — ONE marker, TWO causes: the fingerprint
// DISAGREES (checked at author time, content moved since) or is ABSENT on a node
// with both an abstract and content (never checked). The copy must assert
// neither as THE cause.
//
// Two wordings have been wrong here. "the abstract lags the node content" is
// false for never-checked; "has not been checked against it" — my own
// replacement — is false for disagrees, and @codex and @copilot both caught it
// independently. My first version of THIS TEST pinned that second wrong wording,
// so it was enforcing the defect.
describe('abstract-stale tooltip wording (#810)', () => {
  const src = readFileSync('src/lib/components/NodeList.svelte', 'utf8');
  const tooltip =
    src.match(/'node-list\.abstract-stale',\s*'([^']*)'/)?.[1] ?? '';

  it('finds the tooltip string at all', () => {
    // Guards the regex above: a rename would otherwise make every assertion
    // below vacuously pass on an empty string.
    expect(tooltip).not.toBe('');
  });

  it('leads with what is actually known — that it may not match', () => {
    expect(tooltip).toMatch(/may not match the node content/i);
  });

  it('asserts NEITHER cause as the cause', () => {
    // Each retired wording named one cause and was false for the other.
    expect(tooltip).not.toMatch(/the abstract lags the node content/i);
    expect(tooltip).not.toMatch(/^[^,]*has not been checked against it$/i);
  });

  it('enumerates BOTH causes, so no third counterexample can break it', () => {
    // The #764 remedy: list the possibilities and exclude none.
    expect(tooltip).toMatch(/written against different content/i);
    expect(tooltip).toMatch(/never checked against it/i);
    expect(tooltip).toMatch(/\bor\b/i);
  });
});

// portal#1014: the open-feedback cue in node lists (hrn:node:hadronmemory.com:specs:cor:dmo:110:07),
// from the layout read's GraphNode.openThreads. It links to the node's
// Discussion tab, and an absent count shows nothing rather than a zero.
describe('open-feedback cue (portal#1014)', () => {
  it('shows the open-discussion count, linked to the Discussion tab', () => {
    const { body } = render(NodeList, {
      props: { nodes: [{ ...node, openThreads: 2 }], memoryUrn: 'micromentor.org::mmdata', basePath: '/app/memories/m1' },
    });
    expect(body).toContain('data-testid="node-open-feedback"');
    expect(body).toContain('2 open discussions');
    expect(body).toContain('href="/app/memories/m1/nodes/n1?tab=discussion"');
  });

  it('shows nothing at zero or when the count was not read', () => {
    for (const n of [{ ...node, openThreads: 0 }, node]) {
      const { body } = render(NodeList, { props: { nodes: [n], memoryUrn: 'micromentor.org::mmdata' } });
      expect(body).not.toContain('node-open-feedback');
    }
  });

  it('local review on #1025, P3: with no node link the cue is plain text, never a dead link', () => {
    const plain = render(NodeList, { props: { nodes: [{ ...node, openThreads: 1, memory: null, memoryId: undefined as never }], memoryUrn: 'micromentor.org::mmdata' } }).body;
    expect(plain).toContain('<span data-testid="node-open-feedback"');
    expect(plain).not.toContain('<a href="undefined');
  });
});


const hit = {
  id: 'c1', isTopLevel: true, state: 'OPEN', anchorRevision: 2, deleted: false,
  author: { kind: 'WORKER', worker: { id: 'w1', name: 'Gil', handle: null, urn: 'hrn:worker:o:a:gil' }, user: null, agent: null, app: null },
  target: { id: 't1', name: 'Retention policy', nodeType: 'info', revSeq: 5, urn: 'hrn:node:o:m:retention' },
};

// portal#1015 (hrn:node:hadronmemory.com:specs:cor:dmo:110:08): a Comments or All hit is feedback, labelled as
// such with its author, target and anchor revision, and links back to the
// DISCUSSION on its target rather than to the comment node.
describe('comment search hits (portal#1015)', () => {
  const commentNode = { ...node, id: 'c1', nodeType: 'comment', loc: 'comments:c1', name: 'Comment on Retention', comment: hit };

  it('labels the row as a comment with its author, target and anchor revision', () => {
    const { body } = render(NodeList, { props: { nodes: [commentNode], memoryUrn: 'micromentor.org::mmdata', basePath: '/app/memories/m1' } });
    expect(body).toContain('data-testid="comment-hit"');
    expect(body).toContain('Comment · Open discussion');
    expect(body).toContain('by Gil');
    expect(body).toContain('hrn:worker:o:a:gil');
    expect(body).toContain('Retention policy');
    expect(body).toContain('hrn:node:o:m:retention');
    expect(body).toContain('On revision 2; the target is now at 5');
  });

  it('links to the target\'s discussion, not the comment node', () => {
    const { body } = render(NodeList, { props: { nodes: [commentNode], memoryUrn: 'micromentor.org::mmdata', basePath: '/app/memories/m1' } });
    expect(body).toContain('href="/app/memories/m1/nodes/t1?tab=discussion"');
    expect(body).not.toContain('href="/app/memories/m1/nodes/c1"');
  });

  it('a content row carries none of it', () => {
    const { body } = render(NodeList, { props: { nodes: [node], memoryUrn: 'micromentor.org::mmdata', basePath: '/app/memories/m1' } });
    expect(body).not.toContain('comment-hit');
  });
});

// #1161: a deleted row is marked from what the SERVER reported (deletedIds from
// recoveryNodes), never inferred. Rows not in the set carry no mark.
describe('deleted rows are marked (#1161)', () => {
  const live = { ...node, id: 'live1', name: 'Live One', loc: 'live-one' };
  const gone = { ...node, id: 'gone1', name: 'Gone One', loc: 'gone-one' };

  it('badges only the ids the server reported as deleted', () => {
    const { body } = render(NodeList, {
      props: { nodes: [live, gone], memoryUrn: 'micromentor.org::mmdata', deletedIds: ['gone1'] },
    });
    expect(body.match(/data-testid="node-deleted"/g)).toHaveLength(1);
    const goneRow = body.slice(body.indexOf('Gone One'));
    expect(goneRow).toContain('node-deleted');
    expect(body.slice(body.indexOf('Live One'), body.indexOf('Gone One'))).not.toContain('node-deleted');
  });

  it('marks nothing when no deleted ids are supplied', () => {
    const { body } = render(NodeList, { props: { nodes: [live, gone], memoryUrn: 'micromentor.org::mmdata' } });
    expect(body).not.toContain('node-deleted');
  });
});
