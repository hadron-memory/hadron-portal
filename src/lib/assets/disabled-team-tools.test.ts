/**
 * portal#1496 (MCP cut P1): the text the portal hands to agents names no
 * agent-team MCP tool that phase 3 switches off.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DISABLED_TEAM_TOOLS, disabledToolsIn } from './disabled-team-tools';
import instructions from './hadron-instructions.md?raw';
import skillGetStarted from './skill-get-started.md?raw';
import skillSearch from './skill-search.md?raw';

const KEPT = [
  'hadron_start_session',
  'hadron_end_session',
  'hadron_whoami',
  'hadron_agent_tasks',
  'hadron_agent_processes',
  'hadron_agent_set_base',
  'hadron_agent_set_index_refs',
];

describe('the disabled team tool list', () => {
  const names = [...DISABLED_TEAM_TOOLS];

  it('has exactly 71 unique tool names', () => {
    expect(names).toHaveLength(71);
    for (const n of names) expect(n).toMatch(/^hadron_[a-z_]+$/);
  });

  // The plan writes these with a shared prefix ("`hadron_task_create`, `_update`, …");
  // the list must carry them expanded.
  it.each(['hadron_task_make_ready', 'hadron_stop_signal_lift', 'hadron_agent_ticker_template_delete', 'hadron_delivery_settings_set'])(
    'expands the prefixed name %s',
    (n) => expect(DISABLED_TEAM_TOOLS.has(n)).toBe(true),
  );

  it('shares no name with the tools that stay', () => {
    expect(KEPT.filter((n) => DISABLED_TEAM_TOOLS.has(n))).toEqual([]);
  });

  // Counted a second way: the source file holds 71 quoted names, so no entry
  // is built at run time from a prefix.
  it('writes every name out in full in its source', () => {
    const src = readFileSync(fileURLToPath(new URL('./disabled-team-tools.ts', import.meta.url)), 'utf8');
    expect(src.match(/^ {2}'hadron_[a-z_]+',$/gm)).toHaveLength(71);
  });

  it('names the plan revision it is a copy of', () => {
    const src = readFileSync(fileURLToPath(new URL('./disabled-team-tools.ts', import.meta.url)), 'utf8');
    expect(src).toContain('plan rev 2');
    expect(src).toContain('hrn:node:hadronmemory.com:hadron-dev-team-shared:plans:mcp-team-cut');
    expect(src).toContain('inventory rev 1');
  });
});

describe('disabledToolsIn', () => {
  // The extractor has to see every listed name, or a name it cannot match
  // would pass every asset check below.
  it('finds each of the 71 names in prose, a code span and a table cell', () => {
    for (const n of DISABLED_TEAM_TOOLS) {
      expect(disabledToolsIn(`call ${n} now`)).toEqual([n]);
      expect(disabledToolsIn(`use \`${n}\`.`)).toEqual([n]);
      expect(disabledToolsIn(`| \`${n}\` | does things |`)).toEqual([n]);
    }
  });

  it('does not count a kept tool', () => {
    expect(disabledToolsIn(KEPT.map((n) => `\`${n}\``).join(' '))).toEqual([]);
  });
});

describe.each([
  ['hadron-instructions.md', instructions],
  ['skill-get-started.md', skillGetStarted],
  ['skill-search.md', skillSearch],
])('%s', (_name, asset) => {
  it('names no disabled team tool', () => {
    expect(disabledToolsIn(asset)).toEqual([]);
  });

  it('fails, naming the tool, when a disabled tool is added', () => {
    expect(disabledToolsIn(`${asset}\nPost with \`hadron_team_chat_post\`.\n`)).toEqual(['hadron_team_chat_post']);
  });

  it('still passes when a kept tool is added', () => {
    expect(disabledToolsIn(`${asset}\nCheck with \`hadron_whoami\`.\n`)).toEqual([]);
  });
});
