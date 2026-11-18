import type { MemoryNode } from '$lib/types';

/**
 * portal#1656: the client half of the Children section's "Show more"; see
 * ./children/+server.ts. Never rejects: null means the page could not be read
 * (a rejected fetch, a non-OK status, a `{ failed: true }` answer or a payload
 * that is not a page), and the section keeps what it already shows.
 */
export async function readMoreChildren(
  basePath: string,
  nodeId: string,
  offset: number,
): Promise<{ children: MemoryNode[]; hasMore: boolean } | null> {
  try {
    const response = await fetch(`${basePath}/nodes/${encodeURIComponent(nodeId)}/children?offset=${offset}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { children?: unknown; hasMore?: unknown } | null;
    if (!body || !Array.isArray(body.children) || typeof body.hasMore !== 'boolean') return null;
    const valid = body.children.every(
      (c) => !!c && typeof c === 'object' && typeof (c as { id?: unknown }).id === 'string' && typeof (c as { loc?: unknown }).loc === 'string',
    );
    return valid ? { children: body.children as MemoryNode[], hasMore: body.hasMore } : null;
  } catch {
    return null;
  }
}
