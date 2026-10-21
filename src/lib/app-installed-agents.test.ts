import { describe, expect, it } from 'vitest';
import { readableInstalledAgents } from './app-installed-agents';

describe('readableInstalledAgents (hadron-server#1526)', () => {
  const coordinator = { id: 'ag-1', name: 'Coordinator', urn: 'hrn:agent:acme.com:coordinator' };

  it('keeps readable Agents and drops the ones the caller may not read', () => {
    expect(readableInstalledAgents([{ agent: null }, { agent: coordinator }, { agent: null }])).toEqual({ kind: 'ok', agents: [coordinator] });
  });

  // portal#1148 (hadron-server#2089): null is a WITHHELD roster, not an empty one.
  it('reads a null roster as withheld, never as no installed agents', () => {
    expect(readableInstalledAgents(null)).toEqual({ kind: 'withheld' });
  });

  it('keeps a real empty roster as known-empty, and an unselected field as empty', () => {
    expect(readableInstalledAgents([])).toEqual({ kind: 'ok', agents: [] });
    expect(readableInstalledAgents(undefined)).toEqual({ kind: 'ok', agents: [] });
  });
});
