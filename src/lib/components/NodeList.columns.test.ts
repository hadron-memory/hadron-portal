// portal#1174: the Nodes tab list shows Role, Last changed, Changed by,
// Revision, Approved and Signed, fed lazily by the Nodes tab. The children list
// and any other NodeList consumer keep their three columns.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeList from './NodeList.svelte';
import type { NodeColumnRow } from '$lib/node-columns';

const node = (id: string, name: string) =>
  ({ id, memoryId: 'm1', memory: { id: 'm1', urn: 'hrn:mem:acme.com:mem', name: 'mem' }, nodeType: 'info', loc: name.toLowerCase(), name, description: null, tags: [] }) as any;

const worker = { id: 'w1', name: 'Gil', urn: 'hrn:worker:hadronmemory.com:hadron-dev-team:gil' };
const agent = { id: 'a1', name: 'Portal Engineer', urn: 'hrn:agent:hadronmemory.com:portal-engineer' };
const cols: Record<string, NodeColumnRow> = {
  n1: { id: 'n1', role: 'spec', updatedAt: '2026-10-20T10:00:00Z', revision: 7, approval: 'APPROVED', signature: 'CURRENT', agent, worker },
};

describe('NodeList extra columns (#1174)', () => {
  it('adds the six columns only when asked', () => {
    const plain = render(NodeList, { props: { nodes: [node('n1', 'Alpha')] } }).body;
    for (const h of ['Role', 'Last changed', 'Changed by', 'Revision', 'Approved', 'Signed']) expect(plain).not.toContain(`>${h}<`);
    const withCols = render(NodeList, { props: { nodes: [node('n1', 'Alpha')], showColumns: true, columnData: cols } }).body;
    for (const h of ['Role', 'Last changed', 'Changed by', 'Revision', 'Approved', 'Signed']) expect(withCols).toContain(h);
  });

  it('renders a loaded row: role, revision, approval, signature, and the agent and worker with their URNs', () => {
    const { body } = render(NodeList, { props: { nodes: [node('n1', 'Alpha')], showColumns: true, columnData: cols } });
    expect(body).toContain('spec');
    expect(body).toContain('Approved');
    expect(body).toContain('Signed');
    expect(body).toContain('Gil');
    expect(body).toContain(worker.urn);
    expect(body).toContain('Portal Engineer');
    expect(body).toContain(agent.urn);
  });

  it('a row whose columns have not loaded shows blanks, never a made-up state', () => {
    const { body } = render(NodeList, { props: { nodes: [node('n2', 'Beta')], showColumns: true, columnData: cols } });
    expect(body).toContain('Beta');
    expect(body).not.toContain('Not approved');
    expect(body).not.toContain('Not signed');
  });

  it('says so while columns are loading and when some failed', () => {
    const loading = render(NodeList, { props: { nodes: [node('n1', 'Alpha')], showColumns: true, columnData: {}, columnsLoading: 3 } }).body;
    expect(loading).toContain('Loading columns');
    const failed = render(NodeList, { props: { nodes: [node('n1', 'Alpha')], showColumns: true, columnData: cols, columnsFailed: 2 } }).body;
    expect(failed).toContain('could not be loaded');
  });
});
