import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import type { NodeColumnRow } from '$lib/node-columns';

let tableOptions: any;
vi.mock('$lib/table/createSvelteTable.svelte', async (original) => {
  const actual = await original<typeof import('$lib/table/createSvelteTable.svelte')>();
  return { ...actual, createSvelteTable: (options: any) => {
    tableOptions = options;
    return actual.createSvelteTable(options);
  } };
});
import NodeList from './NodeList.svelte';

const nodes = ['Alpha', 'Beta'].map((name, i) => ({
  id: `n${i}`, name, memoryId: 'm', memory: { id: 'm', name: 'Memory', urn: 'hrn:mem:example.com:memory' },
  nodeType: 'info', loc: name.toLowerCase(), description: null, tags: [],
  createdAt: '2026-10-01T12:00:00Z',
  // Deliberately unrelated snapshot time: never the live node update time.
  revisions: [{ createdAt: '2026-10-10T12:00:00Z' }],
}));
const updates = ['2026-10-20T23:30:00-04:00', '2026-10-21T01:00:00Z'];
const columnData = Object.fromEntries(nodes.map((n, i) => [n.id, {
  id: n.id, role: null, updatedAt: updates[i], revision: 3,
  approval: null, signature: null, agent: null, worker: null,
} satisfies NodeColumnRow]));

describe('Last changed meaning (#1219)', () => {
  it('explains the live update and saved snapshot clocks, only where the column is offered', () => {
    const explanation = 'Last changed is when the node was last updated. Revisions show when snapshots were saved; these times can differ.';
    expect(render(NodeList, { props: { nodes, showColumns: true, columnData } }).body).toContain(explanation);
    expect(render(NodeList, { props: { nodes } }).body).not.toContain(explanation);
  });

  it('renders operational updatedAt in runtime local time, not creation or revision time', () => {
    const body = render(NodeList, { props: { nodes, showColumns: true, columnData } }).body;
    for (const instant of updates) expect(body).toContain(new Date(instant).toLocaleString());
    expect(body).not.toContain(new Date(nodes[0].createdAt).toLocaleString());
    expect(body).not.toContain(new Date(nodes[0].revisions[0].createdAt).toLocaleString());
    if (process.env.TZ === 'America/Los_Angeles') {
      // Beta is Oct 21 UTC but Oct 20 locally: prove this run crosses midnight.
      expect(new Date(updates[1]).getDate()).toBe(20);
      expect(new Date(updates[1]).getUTCDate()).toBe(21);
    }
  });

  it('keeps numeric instant accessors and the existing page-only sorting restriction', () => {
    render(NodeList, { props: { nodes, showColumns: true, columnData } });
    const column = tableOptions.columns.find((c: any) => c.id === 'updatedAt');
    expect(column.accessorFn(nodes[0])).toBe(Date.parse(updates[0]));
    expect(column.accessorFn(nodes[1])).toBe(Date.parse(updates[1]));
    expect(column.accessorFn(nodes[0])).toBeGreaterThan(column.accessorFn(nodes[1]));
    expect(updates[0] < updates[1]).toBe(true); // wire-string ordering would be wrong
    expect(column.enableSorting).toBe(false); // displayed-page batches aren't a whole-memory sort
  });
});
