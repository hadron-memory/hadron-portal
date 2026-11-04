/**
 * portal#1550 (MCP cut P2): the generated asset and P1's pinned list agree, and
 * stay that way. `disabled-team-tools.ts` is the ruled inventory (plan rev 2);
 * `SWITCHED_OFF_MCP_TOOLS` is what the server's switch disabled at the asset's
 * source commit. A difference is fixed in `disabled-team-tools.ts` or in the
 * server, never in the generated file.
 *
 * Every assertion reads the exported Sets. The asset's header prose names tools
 * of its own, so a search over its text would prove nothing.
 */
import { describe, expect, it } from 'vitest';
import { DISABLED_TEAM_TOOLS } from './disabled-team-tools';
import { HOSTED_MCP_TOOLS, SWITCHED_OFF_MCP_TOOLS } from './hosted-mcp-tools';

const KEPT = [
  'hadron_start_session',
  'hadron_end_session',
  'hadron_whoami',
  'hadron_agent_tasks',
  'hadron_agent_processes',
  'hadron_agent_set_base',
  'hadron_agent_set_index_refs',
];

describe('the hosted tool list and the disabled team tools', () => {
  it('holds the server\'s switched-off set equal to the pinned 71', () => {
    expect([...SWITCHED_OFF_MCP_TOOLS].sort()).toEqual([...DISABLED_TEAM_TOOLS].sort());
  });

  it('hosts none of the disabled tools', () => {
    expect([...HOSTED_MCP_TOOLS].filter((n) => DISABLED_TEAM_TOOLS.has(n))).toEqual([]);
  });

  it('hosts nothing the switch turned off', () => {
    expect([...HOSTED_MCP_TOOLS].filter((n) => SWITCHED_OFF_MCP_TOOLS.has(n))).toEqual([]);
  });

  it.each(KEPT)('still hosts %s', (name) => {
    expect(HOSTED_MCP_TOOLS.has(name)).toBe(true);
  });
});
