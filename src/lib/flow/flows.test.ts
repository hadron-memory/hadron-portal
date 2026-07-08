import { describe, expect, it } from 'vitest';
import { flowRoots, type FlowGraphNode } from './flows';

const node = (over: Partial<FlowGraphNode> & { id: string; loc: string }): FlowGraphNode => ({
  memoryId: 'm1',
  name: over.loc,
  isRunnable: false,
  memory: { urn: 'acme.com::flows' },
  outgoingEdges: [],
  incomingEdges: [],
  ...over,
});

const edge = (sourceLoc: string, name: string, target: FlowGraphNode) => ({
  name,
  loc: `${sourceLoc}:${name}:${target.loc}`,
  target: { id: target.id, loc: target.loc, name: target.name },
});

const incoming = (source: FlowGraphNode, name: string, targetLoc: string) => ({
  name,
  loc: `${source.loc}:${name}:${targetLoc}`,
  source: { id: source.id, loc: source.loc, name: source.name },
});

describe('flowRoots', () => {
  it('derives roots: runnable + outgoing next* + no incoming next*', () => {
    const step2 = node({ id: 'n3', loc: 'flow1:step-2', isRunnable: true });
    const step1 = node({ id: 'n2', loc: 'flow1:step-1', isRunnable: true });
    const root = node({ id: 'n1', loc: 'flow1', name: 'Flow One', isRunnable: true });
    root.outgoingEdges = [edge('flow1', 'next', step1)];
    step1.outgoingEdges = [edge('flow1:step-1', 'next', step2)];
    step1.incomingEdges = [incoming(root, 'next', step1.loc)];
    step2.incomingEdges = [incoming(step1, 'next', step2.loc)];

    const flows = flowRoots([root, step1, step2]);
    expect(flows).toHaveLength(1);
    expect(flows[0].entry).toMatchObject({
      id: 'n1',
      name: 'Flow One',
      urn: 'hrn:node:acme.com::flows::flow1',
    });
    expect(flows[0].branchCount).toBe(1);
    expect(flows[0].stepCount).toBe(3);
  });

  it('excludes non-runnable roots, reference-only nodes, and mid-flow nodes', () => {
    const target = node({ id: 't', loc: 'act' });
    const notRunnable = node({ id: 'a', loc: 'a', outgoingEdges: [edge('a', 'next', target)] });
    const referenceOnly = node({
      id: 'b',
      loc: 'b',
      isRunnable: true,
      outgoingEdges: [edge('b', 'documents', target)],
    });
    expect(flowRoots([notRunnable, referenceOnly, target])).toEqual([]);
  });

  it('uses the loc-derived routing name for unnamed edges (walker parity)', () => {
    const target = node({ id: 't', loc: 'act' });
    const root = node({
      id: 'r',
      loc: 'classify',
      isRunnable: true,
      outgoingEdges: [{ name: null, loc: 'classify:next:act', target: { id: 't', loc: 'act', name: 'act' } }],
    });
    const flows = flowRoots([root, target]);
    expect(flows).toHaveLength(1);
    expect(flows[0].stepCount).toBe(2);
  });

  it('counts unfetched targets without expanding, and survives cycles', () => {
    const a = node({ id: 'a', loc: 'a', isRunnable: true });
    const b = node({ id: 'b', loc: 'b' });
    // a → b → a cycle, plus a → (missing node not in the set)
    a.outgoingEdges = [
      edge('a', 'next.1', b),
      { name: 'next.2', loc: 'a:next-2:ghost', target: { id: 'ghost', loc: 'ghost', name: 'ghost' } },
    ];
    b.outgoingEdges = [edge('b', 'next', a)];
    b.incomingEdges = [incoming(a, 'next.1', 'b')];
    a.incomingEdges = [incoming(b, 'next', 'a')];

    // `a` has an incoming routing edge (the cycle), so it is NOT a root.
    expect(flowRoots([a, b])).toEqual([]);

    // Break the cycle marker: treat the incoming edge as a reference.
    a.incomingEdges = [incoming(b, 'documents', 'a')];
    const flows = flowRoots([a, b]);
    expect(flows).toHaveLength(1);
    expect(flows[0].branchCount).toBe(2);
    expect(flows[0].stepCount).toBe(3); // a + b + ghost (counted, not expanded)
  });
});
