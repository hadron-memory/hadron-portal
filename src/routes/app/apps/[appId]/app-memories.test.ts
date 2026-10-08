/**
 * #1043 — the App page's memory summaries fold EVERY installed agent plus the
 * team space, not App.agent (the first installed agent) alone.
 */
import { describe, expect, it } from 'vitest';
import { effectiveAppMemories } from './app-memories';

const mem = (id: string, name: string) => ({ id, urn: `hrn:mem:acme.com:${id}`, name });
const item = (id: string, name: string, role: string) => ({
  id: `i-${id}-${role}`, role, memory: { ...mem(id, name), visibility: null },
});

// The issue's repro: the team agent comes first and holds "Roles"; the role
// agent holds "Eng Notes".
const teamAgent = { id: 'ag-team', urn: 'hrn:agent:acme.com:team', name: 'Team', memoryItems: [item('roles', 'Roles', 'read-write')] };
const engineer = {
  id: 'ag-eng', urn: 'hrn:agent:acme.com:eng', name: 'Engineer', personaRole: 'engineer',
  memoryItems: [item('eng', 'Eng Notes', 'read-write'), item('roles', 'Roles', 'read')],
};

describe('effectiveAppMemories', () => {
  it('lists every installed agent’s memories, with read-write from any agent winning', () => {
    const result = effectiveAppMemories(
      { agent: { ...teamAgent, description: null }, agents: [teamAgent, engineer], sharedMemory: null },
      'team space',
    );
    expect(result).toEqual([
      { ...mem('eng', 'Eng Notes'), access: 'read-write', agentName: 'Engineer' },
      { ...mem('roles', 'Roles'), access: 'read-write', agentName: 'Team' },
    ]);
  });

  it('a later read-write grant upgrades an earlier read one', () => {
    const reader = { ...teamAgent, memoryItems: [item('eng', 'Eng Notes', 'read')] };
    const result = effectiveAppMemories({ agent: null, agents: [reader, engineer], sharedMemory: null }, 'team space');
    expect(result.find((m) => m.id === 'eng')).toMatchObject({ access: 'read-write', agentName: 'Engineer' });
  });

  it('adds the team space as read, the level the server’s App fold gives it', () => {
    const result = effectiveAppMemories(
      { agent: null, agents: [teamAgent], sharedMemory: mem('space', 'Team space') },
      'team space',
    );
    expect(result.find((m) => m.id === 'space')).toEqual({ ...mem('space', 'Team space'), access: 'read', agentName: 'team space' });
  });

  it('does not downgrade a team space an agent already grants read-write', () => {
    const writer = { ...teamAgent, memoryItems: [item('space', 'Team space', 'read-write')] };
    const result = effectiveAppMemories({ agent: null, agents: [writer], sharedMemory: mem('space', 'Team space') }, 'team space');
    expect(result).toEqual([{ ...mem('space', 'Team space'), access: 'read-write', agentName: 'Team' }]);
  });

  it('falls back to App.agent when the roster carries no agents', () => {
    const result = effectiveAppMemories({ agent: { ...teamAgent, description: null }, agents: [], sharedMemory: null }, 'team space');
    expect(result.map((m) => m.id)).toEqual(['roles']);
  });
});
