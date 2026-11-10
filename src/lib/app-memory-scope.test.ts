import { expect, it } from 'vitest';
import { appMemoryTargets, type AppScopedMemory } from './app-memory-scope';
const row = (memoryId: string, viewerCanWrite: boolean, kinds: string[]): AppScopedMemory => ({ memoryId, viewerCanWrite, memoryUrn: `hrn:mem:example.com:${memoryId}`, name: memoryId, class: 'knowledge', sources: kinds.map(kind => ({ kind, agentId: null })) });
it('requires the advisory flag AND a non-inherited source, without upgrading inherited nodes', () => {
 expect(appMemoryTargets([row('inherited',true,['INHERITED_BASE']),row('refused',false,['AGENT_LINK']),row('writable',true,['AGENT_LINK']),row('mixed',true,['INHERITED_BASE','TEAM_SPACE']),row('empty',true,[])])).toEqual(['writable','mixed']);
 expect(appMemoryTargets([])).toEqual([]);
});
