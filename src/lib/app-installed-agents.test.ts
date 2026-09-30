import { describe, expect, it } from 'vitest';
import { readableInstalledAgents } from './app-installed-agents';

describe('readableInstalledAgents (hadron-server#1526)', () => {
  const coordinator = { id: 'ag-1', name: 'Coordinator', urn: 'hrn:agent:acme.com:coordinator' };

  it('keeps readable Agents and drops the ones the caller may not read', () => {
    expect(readableInstalledAgents([{ agent: null }, { agent: coordinator }, { agent: null }])).toEqual([coordinator]);
  });

  it('treats a missing list as empty', () => {
    expect(readableInstalledAgents(null)).toEqual([]);
    expect(readableInstalledAgents(undefined)).toEqual([]);
  });
});
