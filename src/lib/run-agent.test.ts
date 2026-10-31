import { describe, expect, it } from 'vitest';
import { runAgentChoice } from './run-agent';

const a = { id: 'ag-1', name: 'Writer', urn: 'hrn:agent:x:writer' };
const b = { id: 'ag-2', name: 'Editor', urn: 'hrn:agent:x:editor' };

// portal#1444 (hadron-server#2849): the picker exists only where the server
// would refuse a run that names no Agent — an App with SEVERAL installs.
describe('runAgentChoice', () => {
  it('several installed Agents: offers them all, by name', () => {
    expect(runAgentChoice([{ agent: a }, { agent: b }])).toEqual([a, b]);
  });

  it('one installed Agent: no picker (the server picks it)', () => {
    expect(runAgentChoice([{ agent: a }])).toBeNull();
  });

  it('no installed Agent: no picker', () => {
    expect(runAgentChoice([])).toBeNull();
  });

  it('a withheld roster (null) or an unread one (undefined): no picker, never an empty one', () => {
    expect(runAgentChoice(null)).toBeNull();
    expect(runAgentChoice(undefined)).toBeNull();
  });

  it('counts INSTALLS, not readable Agents: two installs with one withheld still offers the readable one', () => {
    expect(runAgentChoice([{ agent: a }, { agent: null }])).toEqual([a]);
  });

  it('several installs, none readable: nothing to offer', () => {
    expect(runAgentChoice([{ agent: null }, { agent: null }])).toBeNull();
  });
});
