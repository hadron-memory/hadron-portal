import type { MemoryNode } from '$lib/types';

// Shared synthetic dataset for the two bake-off spike routes.
const TYPES = ['info', 'task', 'data', 'record', 'plan'];
export const mockNodes: MemoryNode[] = Array.from({ length: 250 }, (_, i) => ({
  id: `node-${i}`,
  loc: `dev:topic:item-${i}`,
  name: `Node ${i}`,
  nodeType: TYPES[i % TYPES.length],
  description: `Synthetic description for node ${i}`,
  tags: [],
  seq: i,
  memoryId: 'mem-1',
})) as unknown as MemoryNode[];
