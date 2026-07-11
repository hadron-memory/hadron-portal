import { describe, expect, it } from 'vitest';
import { collectFlowFields, collectFlowFieldsByNode, extractionSpecOf } from './fields';

describe('extractionSpecOf', () => {
  it('tolerates absent/malformed data', () => {
    expect(extractionSpecOf(null)).toEqual([]);
    expect(extractionSpecOf(undefined)).toEqual([]);
    expect(extractionSpecOf({ extractionSpec: 'nope' })).toEqual([]);
    expect(extractionSpecOf({ extractionSpec: [{ notField: 1 }, null] })).toEqual([]);
  });

  it('returns well-formed entries', () => {
    expect(
      extractionSpecOf({ extractionSpec: [{ field: 'intent' }, { field: 'confidence', shape: 'number' }] }),
    ).toHaveLength(2);
  });
});

describe('collectFlowFields', () => {
  it('emits message.data.* paths for the source node’s own spec', () => {
    const fields = collectFlowFields({
      loc: 'classify',
      name: 'Classify',
      data: {
        extractionSpec: [
          { field: 'intent', description: 'What the user wants' },
          { field: 'confidence', shape: 'number' },
        ],
      },
    });
    expect(fields.map((f) => f.path)).toEqual(['message.data.intent', 'message.data.confidence']);
    expect(fields[0].label).toContain('Classify');
    expect(fields[0].hint).toBe('What the user wants');
    expect(fields[1].label).toContain('(number)');
  });

  it('walks upstream flow edges but ignores reference edges', () => {
    const fields = collectFlowFields({
      loc: 'act',
      name: 'Act',
      data: null,
      incomingEdges: [
        {
          name: 'next.1',
          loc: 'classify:next-1:act',
          source: {
            loc: 'classify',
            name: 'Classify',
            data: { extractionSpec: [{ field: 'intent' }] },
            incomingEdges: [
              {
                name: null,
                loc: 'entry:next:classify',
                source: { loc: 'entry', name: 'Entry', data: { extractionSpec: [{ field: 'seed' }] } },
              },
            ],
          },
        },
        {
          name: 'documents',
          loc: 'spec:documents:act',
          source: { loc: 'spec', name: 'Spec', data: { extractionSpec: [{ field: 'never' }] } },
        },
      ],
    });
    expect(fields.map((f) => f.path)).toEqual(['message.data.intent', 'message.data.seed']);
  });

  it('dedupes by path with the nearest extractor winning, and survives cycles', () => {
    const a = {
      loc: 'a',
      name: 'A',
      data: { extractionSpec: [{ field: 'x' }] },
      incomingEdges: [] as never[],
    };
    const b = {
      loc: 'b',
      name: 'B',
      data: { extractionSpec: [{ field: 'x' }] },
      incomingEdges: [{ name: 'next', loc: 'a:next:b', source: a }],
    };
    // a → b → a cycle
    a.incomingEdges = [{ name: 'next', loc: 'b:next:a', source: b }] as never[];
    const fields = collectFlowFields(b);
    expect(fields).toHaveLength(1);
    expect(fields[0].label).toContain('“B”');
  });
});

describe('collectFlowFieldsByNode', () => {
  // The flow canvas (#510) wires an already-fetched graph into per-node
  // field lists: entry → classify → act, with a reference edge off classify.
  const nodes = [
    { id: 'n1', loc: 'entry', name: 'Entry', data: { extractionSpec: [{ field: 'seed' }] } },
    { id: 'n2', loc: 'classify', name: 'Classify', data: { extractionSpec: [{ field: 'intent' }] } },
    { id: 'n3', loc: 'act', name: 'Act', data: null },
    { id: 'n4', loc: 'spec', name: 'Spec', data: { extractionSpec: [{ field: 'never' }] } },
  ];
  const edges = [
    { name: 'next', loc: 'entry:next:classify', sourceId: 'n1', targetId: 'n2' },
    { name: 'next', loc: 'classify:next:act', sourceId: 'n2', targetId: 'n3' },
    { name: 'documents', loc: 'spec:documents:classify', sourceId: 'n4', targetId: 'n2' },
  ];

  it('collects each node’s own + full-upstream fields, ignoring reference edges', () => {
    const byNode = collectFlowFieldsByNode(nodes, edges);
    expect(byNode.n1.map((f) => f.path)).toEqual(['message.data.seed']);
    expect(byNode.n2.map((f) => f.path)).toEqual(['message.data.intent', 'message.data.seed']);
    // act extracts nothing itself but sees the whole upstream chain.
    expect(byNode.n3.map((f) => f.path)).toEqual(['message.data.intent', 'message.data.seed']);
    // the reference edge's source never contributes.
    expect(byNode.n2.map((f) => f.path)).not.toContain('message.data.never');
  });

  it('survives routing cycles and skips edges to unknown nodes', () => {
    const byNode = collectFlowFieldsByNode(nodes, [
      ...edges,
      { name: 'next.2', loc: 'act:next-2:entry', sourceId: 'n3', targetId: 'n1' }, // cycle
      { name: 'next', loc: 'ghost:next:act', sourceId: 'ghost', targetId: 'n3' }, // unknown source
    ]);
    expect(byNode.n1.map((f) => f.path).sort()).toEqual([
      'message.data.intent',
      'message.data.seed',
    ]);
  });
});
