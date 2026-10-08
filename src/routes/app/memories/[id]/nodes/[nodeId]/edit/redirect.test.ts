/**
 * #1031 — the node edit page became the node page's Properties tab, and its URL
 * redirects there. The URL is in the wild (bookmarks, issue text, the Task
 * Nodes list until #1031), so it must keep landing somewhere useful, with
 * whatever state the caller's link carried
 * (`hrn:node:hadronmemory.com:hadron-portal:review:redirect-must-carry-query-and-count-hops`).
 */
import { describe, expect, it } from 'vitest';
import { GET } from './+server';

function redirectOf(url: string, params = { id: 'mem-1', nodeId: 'n1' }): { status: number; location: string } {
  try {
    GET({ params, url: new URL(url) } as never);
  } catch (e) {
    return e as { status: number; location: string };
  }
  throw new Error('expected a redirect');
}

describe('/nodes/[nodeId]/edit → Properties tab (#1031)', () => {
  it('lands on the node page with the Properties tab open', () => {
    const r = redirectOf('http://localhost/app/memories/mem-1/nodes/n1/edit');
    expect(r.status).toBe(307);
    expect(r.location).toBe('/app/memories/mem-1/nodes/n1?tab=properties');
  });

  it('carries the rest of the query, and the Properties tab wins over a stale ?tab=', () => {
    const r = redirectOf('http://localhost/app/memories/mem-1/nodes/n1/edit?tab=content&from=tasks');
    const target = new URL(r.location, 'http://localhost');
    expect(target.pathname).toBe('/app/memories/mem-1/nodes/n1');
    expect(target.searchParams.getAll('tab')).toEqual(['properties']);
    expect(target.searchParams.get('from')).toBe('tasks');
  });
});
