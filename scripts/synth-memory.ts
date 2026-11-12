/**
 * Deterministic synthetic memory shared by the memory-entry profile (portal#1380
 * S1) and the layout payload pin (portal#1429): one fixture, so the byte bound
 * the pin states is measured at the scale the profile reported.
 */
// --- deterministic synthetic memory ---------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const WORDS = ['plan', 'finding', 'incident', 'review', 'spec', 'task', 'note', 'design', 'runbook', 'metric', 'decision', 'access', 'node', 'graph', 'usage'];
const hex = (r: () => number, n: number) => Array.from({ length: n }, () => Math.floor(r() * 16).toString(16)).join('');
const uuid = (r: () => number) => `${hex(r, 8)}-${hex(r, 4)}-${hex(r, 4)}-${hex(r, 4)}-${hex(r, 12)}`;

type Shape = { edgesPerNode: number; usageShare: number; descChars: number };
// Calibrated against Cloe's production key sizes (see the profile node); the
// calibration run prints the ratio so a drifting fixture is visible.
export const DEFAULT_SHAPE: Shape = { edgesPerNode: 0.7, usageShare: 0.9, descChars: 30 };

export function synthMemory(nodeCount: number, shape: Shape = DEFAULT_SHAPE, seed = 1380) {
  const r = rng(seed);
  const memoryId = uuid(r);
  const memoryUrn = 'hrn:mem:example.test:large';
  const nodes: Array<Record<string, unknown>> = [];
  const locs: string[] = [];
  // A tree of folders: branching ~12, depth up to 4, leaves carry the rest.
  for (let i = 0; i < nodeCount; i++) {
    const depth = 1 + Math.floor(r() * 3);
    const parts: string[] = [];
    for (let d = 0; d < depth; d++) parts.push(`${WORDS[Math.floor(r() * WORDS.length)].slice(0, 4)}${Math.floor(r() * 12)}`);
    const loc = `${parts.join(':')}:n${i}`;
    locs.push(loc);
    nodes.push({
      id: uuid(r),
      loc,
      name: `${WORDS[Math.floor(r() * WORDS.length)]} ${WORDS[Math.floor(r() * WORDS.length)]} ${i}`,
      nodeType: r() < 0.9 ? 'info' : 'reference',
      tags: Array.from({ length: Math.floor(r() * 4) }, () => WORDS[Math.floor(r() * WORDS.length)]),
      seq: r() < 0.5 ? Math.floor(r() * 100) : null,
      isRunnable: r() < 0.02 ? true : null,
      description: r() < 0.8 ? 'x'.repeat(shape.descChars - 10 + Math.floor(r() * 20)) : null,
      openThreads: r() < 0.03 ? 1 : 0,
    });
  }
  const edges: Array<Record<string, unknown>> = [];
  const edgeCount = Math.round(nodeCount * shape.edgesPerNode);
  for (let i = 0; i < edgeCount; i++) {
    const s = nodes[Math.floor(r() * nodeCount)];
    const t = nodes[Math.floor(r() * nodeCount)];
    edges.push({ id: uuid(r), loc: `${s.loc}:related:${t.loc}`, name: 'related', sourceId: s.id, targetId: t.id });
  }
  const usage: Array<{ nodeLoc: string; type: string; count: number }> = [];
  for (const loc of locs) {
    if (r() >= shape.usageShare) continue;
    usage.push({ nodeLoc: loc, type: 'read', count: 1 + Math.floor(r() * 40) });
    if (r() < 0.6) usage.push({ nodeLoc: loc, type: 'write', count: 1 + Math.floor(r() * 5) });
    if (r() < 0.5) usage.push({ nodeLoc: loc, type: 'search', count: 1 + Math.floor(r() * 9) });
    if (r() < 0.5) usage.push({ nodeLoc: loc, type: 'list', count: 1 + Math.floor(r() * 9) });
  }
  const memory = {
    id: memoryId,
    urn: memoryUrn,
    name: 'Large',
    organizationId: 'org-1',
  };
  return { memory, nodes, edges, usage };
}
