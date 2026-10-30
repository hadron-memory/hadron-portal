// portal#1346: the Nodes tab row carries the pending/failed embedding badge from
// #1282, only when the memory is vector-indexed, wording and escaping as there.
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import NodeList from './NodeList.svelte';
import type { NodeColumnRow } from '$lib/node-columns';

const node = (id: string, name: string) =>
  ({ id, memoryId: 'm1', memory: { id: 'm1', urn: 'hrn:mem:acme.com:mem', name: 'mem' }, nodeType: 'info', loc: name.toLowerCase(), name, description: null, tags: [] }) as any;
const row = (id: string, embedding: NodeColumnRow['embedding']): NodeColumnRow =>
  ({ id, role: null, updatedAt: null, revision: 1, approval: null, signature: null, agent: null, worker: null, embedding });
const NONE = { pendingAt: null, failedAt: null, error: null };
const mount = (embedding: NodeColumnRow['embedding'], embeddingEnabled = true) =>
  render(NodeList, { props: { nodes: [node('n1', 'Alpha')], showColumns: true, embeddingEnabled, columnData: { n1: row('n1', embedding) } } }).body;

describe('NodeList embedding badges (#1346)', () => {
  it('pending-only shows pending and not failed', () => {
    const body = mount({ ...NONE, pendingAt: '2026-10-20T10:00:00Z' });
    expect(body).toContain('embedding-pending');
    expect(body).not.toContain('embedding-failed');
  });

  it('failed shows failed with the reason', () => {
    const body = mount({ ...NONE, failedAt: '2026-10-20T10:00:00Z', error: 'dimension mismatch' });
    expect(body).toContain('embedding-failed');
    expect(body).toContain('dimension mismatch');
  });

  it('escapes markup in the reason', () => {
    const body = mount({ ...NONE, failedAt: '2026-10-20T10:00:00Z', error: '<img src=x onerror=alert(1)>' });
    expect(body).not.toContain('<img');
    expect(body).toContain('&lt;img');
  });

  it('all-null renders nothing', () => {
    expect(mount(NONE)).not.toContain('node-embedding-state');
  });

  it('is hidden when the memory is not vector-indexed, even with stale fields', () => {
    const body = mount({ ...NONE, pendingAt: 'x', failedAt: 'y', error: 'stale' }, false);
    expect(body).not.toContain('node-embedding-state');
    expect(body).not.toContain('stale');
  });

  it('a row whose columns have not loaded shows no badge', () => {
    const body = render(NodeList, { props: { nodes: [node('n2', 'Beta')], showColumns: true, embeddingEnabled: true, columnData: {} } }).body;
    expect(body).not.toContain('node-embedding-state');
  });
});
