/**
 * portal#1550 (MCP cut P2): the generated asset and P1's pinned list agree, and
 * stay that way. `disabled-team-tools.ts` is the ruled inventory (plan rev 2);
 * `SWITCHED_OFF_MCP_TOOLS` is what the server's switch disabled at the asset's
 * source commit. A difference is fixed in `disabled-team-tools.ts`, in the
 * server or in the script's scan, never by hand in the generated file.
 *
 * Tool names are checked on the exported Sets, not the asset's text: its header
 * prose names tools of its own, so a search over it would prove nothing. Only
 * the counts come from the text, because the script writes them from the same
 * lists. A hand edit that drops a name moves the Set and not the count.
 */
import { describe, expect, it } from 'vitest';
import { DISABLED_TEAM_TOOLS } from './disabled-team-tools';
import { HOSTED_MCP_TOOLS, SWITCHED_OFF_MCP_TOOLS } from './hosted-mcp-tools';
import assetSource from './hosted-mcp-tools.ts?raw';

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

  it('holds both committed sets to the counts the script wrote', () => {
    const counts = assetSource.match(/(\d+) names hosted,\s+\* (\d+) switched off/);
    expect(counts, 'the asset header no longer states its counts').not.toBeNull();
    expect(HOSTED_MCP_TOOLS.size).toBe(Number(counts?.[1]));
    expect(SWITCHED_OFF_MCP_TOOLS.size).toBe(Number(counts?.[2]));
  });

  it.each(KEPT)('still hosts %s', (name) => {
    expect(HOSTED_MCP_TOOLS.has(name)).toBe(true);
  });
});
