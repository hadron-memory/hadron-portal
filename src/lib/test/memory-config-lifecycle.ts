export type MemoryConfigLifecycleEvent = { type: 'mount' | 'destroy'; id: number };

export const memoryConfigLifecycle: MemoryConfigLifecycleEvent[] = [];
let nextId = 0;

export function recordMemoryConfigMount() {
  const id = ++nextId;
  memoryConfigLifecycle.push({ type: 'mount', id });
  return id;
}

export function recordMemoryConfigDestroy(id: number) {
  memoryConfigLifecycle.push({ type: 'destroy', id });
}

export function resetMemoryConfigLifecycle() {
  memoryConfigLifecycle.length = 0;
  nextId = 0;
}
