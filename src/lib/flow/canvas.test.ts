import { describe, expect, it } from 'vitest';
import { buildFlowCanvas, conditionTextOf } from './canvas';
import type { FlowCanvasEdgeInput, FlowCanvasNodeInput } from './canvas';

const nodes: FlowCanvasNodeInput[] = [
  {
    id: 'n1',
    loc: 'flow:classify',
    name: 'Classify report',
    kind: 'flow',
    data: { extractionSpec: [{ field: 'intent' }, { field: 'confidence', shape: 'number' }] },
  },
  {
    id: 'n2',
    loc: 'flow:act',
    name: 'Act on report',
    kind: 'flow',
    data: { tools: ['hadron_create_node'] },
  },
  {
    id: 'n3',
    loc: 'flow:defer',
    name: 'Defer report',
    kind: 'flow',
    data: { output: { writeTo: 'flow:alerts', mode: 'append' } },
  },
  { id: 'n4', loc: 'docs:playbook', name: 'Playbook', kind: 'reference' },
];

const edges: FlowCanvasEdgeInput[] = [
  {
    id: 'e-high',
    name: 'next.1.high',
    loc: 'flow:classify:next.1.high:flow:act',
    sourceId: 'n1',
    sourceLoc: 'flow:classify',
    targetId: 'n2',
    condition: { '>': [{ var: 'message.data.confidence' }, 0.8] },
  },
  {
    id: 'e-low',
    name: 'next.2.low',
    loc: 'flow:classify:next.2.low:flow:defer',
    sourceId: 'n1',
    sourceLoc: 'flow:classify',
    targetId: 'n3',
  },
  {
    id: 'e-docs',
    name: 'documents',
    loc: 'flow:act:documents:docs:playbook',
    sourceId: 'n2',
    sourceLoc: 'flow:act',
    targetId: 'n4',
  },
];

describe('buildFlowCanvas', () => {
  const model = buildFlowCanvas(nodes, edges);

  it('annotates routing edges with walker order, fall-through, and condition text', () => {
    const high = model.edges.find((e) => e.id === 'e-high')!;
    expect(high.kind).toBe('routing');
    expect(high.position).toBe(1);
    expect(high.isFallThrough).toBe(false);
    expect(high.conditionText).toMatch(/confidence/);

    const low = model.edges.find((e) => e.id === 'e-low')!;
    expect(low.position).toBe(2);
    expect(low.isFallThrough).toBe(true);
    expect(low.conditionText).toBeNull();
  });

  it('classifies non-routing edges as reference with their name as label', () => {
    const docs = model.edges.find((e) => e.id === 'e-docs')!;
    expect(docs.kind).toBe('reference');
    expect(docs.label).toBe('documents');
    expect(docs.position).toBeNull();
  });

  it('marks unrouted flow nodes as entries, never reference nodes', () => {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    expect(byId.get('n1')!.isEntry).toBe(true);
    expect(byId.get('n2')!.isEntry).toBe(false);
    expect(byId.get('n3')!.isEntry).toBe(false);
    expect(byId.get('n4')!.isEntry).toBe(false);
  });

  it('surfaces extraction fields, tools, and output target as badges', () => {
    const byId = new Map(model.nodes.map((n) => [n.id, n]));
    expect(byId.get('n1')!.extractionFields).toEqual(['intent', 'confidence']);
    expect(byId.get('n2')!.tools).toEqual(['hadron_create_node']);
    expect(byId.get('n3')!.outputWriteTo).toBe('flow:alerts');
  });

  it('marks routing edges sorted after a fall-through as unreachable', () => {
    const model2 = buildFlowCanvas(
      nodes,
      [
        { ...edges[1], id: 'e-first', name: 'next.1' },
        { ...edges[0], id: 'e-second', name: 'next.2.high', targetId: 'n2' },
      ],
    );
    const second = model2.edges.find((e) => e.id === 'e-second')!;
    expect(second.isUnreachable).toBe(true);
  });

  it('drops edges whose endpoints were not fetched', () => {
    const model3 = buildFlowCanvas(nodes, [
      { ...edges[0], id: 'e-dangling', targetId: 'n-missing' },
    ]);
    expect(model3.edges).toHaveLength(0);
  });
});

describe('conditionTextOf', () => {
  it('returns null for an always-fires edge', () => {
    expect(conditionTextOf(null)).toBeNull();
    expect(conditionTextOf(undefined)).toBeNull();
  });

  it('falls back to a JSON snippet for conditions outside the UI grammar', () => {
    const exotic = { '+': [1, 2] };
    const text = conditionTextOf(exotic);
    expect(text).toContain('"+"');
  });
});

describe('buildFlowCanvas — script nodes (#1597, cor:agt:010:04)', () => {
  const build = (data: unknown) =>
    buildFlowCanvas([{ id: 's', loc: 'flow:s', name: 'S', kind: 'flow', data }], []).nodes[0];

  it('projects a script node to its tool, args KEYS and no both-bodies flag', () => {
    const n = build({ script: { call: { tool: 'hadron_find_nodes', args: { query: 'secret-literal', limit: 3 } } } });
    expect(n.script).toEqual({ tool: 'hadron_find_nodes', argKeys: ['query', 'limit'], bothBodies: false });
  });

  it('never ships args VALUES to the client', () => {
    const n = build({ script: { call: { tool: 't', args: { query: 'secret-literal' } } } });
    expect(JSON.stringify(n)).not.toContain('secret-literal');
  });

  it('a node without script has script null and is otherwise unchanged', () => {
    const n = build({ tools: ['hadron_create_node'] });
    expect(n.script).toBeNull();
    expect(n.tools).toEqual(['hadron_create_node']);
  });

  it('flags both bodies when script sits with tools or extractionSpec, even an empty list', () => {
    const call = { tool: 't' };
    expect(build({ script: { call }, tools: ['x'] }).script?.bothBodies).toBe(true);
    expect(build({ script: { call }, extractionSpec: [{ field: 'a' }] }).script?.bothBodies).toBe(true);
    expect(build({ script: { call }, tools: [] }).script?.bothBodies).toBe(true);
  });

  it('tolerates a script with no usable call.tool or non-object args', () => {
    expect(build({ script: {} }).script).toEqual({ tool: null, argKeys: [], bothBodies: false });
    expect(build({ script: { call: { tool: 't', args: [1] } } }).script?.argKeys).toEqual([]);
  });
});
