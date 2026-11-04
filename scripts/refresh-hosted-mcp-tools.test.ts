/**
 * portal#1550 (MCP cut P2): the refresh honors hadron-server's disabled-tool
 * switch by name. A disabled tool is skipped because it is registered through
 * the switch, not because its call text happens to miss the regex.
 *
 * The fixtures are written in S1's shape (hadron-server#3208, merge 99246d46):
 * `const off = offTeamTool(server);`, then `off(` with the quoted name on the
 * same line or the next one.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { MIN_REGISTERED, SWITCH, renderAsset, scanSource, serverTools } from './refresh-hosted-mcp-tools.mjs';

const kept = `
  server.tool(
    'hadron_kept',
    'A tool that stays.',
  );
`;
const switched = `
import { offTeamTool } from './disabledTools.js';
export function register(server: McpServer) {
  const off = offTeamTool(server); // #3082
  off(
    'hadron_gone',
    'A tool S1 disables.',
  );
  off('hadron_gone_inline',
    'Written the way agentTaskTools writes three of them.',
  );
  server.tool('hadron_kept_beside', 'Kept, in a module that also disables.');
}
`;
// A different local name, one the literal `off(` can't find.
const otherAlias = `
  const disabled = offTeamTool(server);
  disabled(
    'hadron_gone_other',
    'Disabled through a second alias.',
  );
`;
// An alias the generic regex also matches, so only the subtraction removes it.
const genericLooking = `
  const tool = offTeamTool(server);
  tool('hadron_gone_generic', 'Reads as a registration, and is disabled.');
`;
// Enough kept names to clear the floor, so the refusals below are the only reason to throw.
const many = Array.from({ length: MIN_REGISTERED }, (_, i) => `server.tool('hadron_filler_${i}', 'x');`).join('\n');

describe('scanSource', () => {
  it('lists a kept tool as registered and not as switched off', () => {
    expect(scanSource(kept)).toEqual({ registered: ['hadron_kept'], switchedOff: [] });
  });

  it('reads a switched-off tool on the same line as off( and on the next', () => {
    const { switchedOff } = scanSource(switched);
    expect(switchedOff).toEqual(['hadron_gone', 'hadron_gone_inline']);
  });

  it('counts a switched-off tool as registered: the switch is a registration', () => {
    expect(scanSource(switched).registered).toEqual(['hadron_gone', 'hadron_gone_inline', 'hadron_kept_beside']);
  });

  it('resolves the alias per module, not the literal off(', () => {
    expect(scanSource(otherAlias).switchedOff).toEqual(['hadron_gone_other']);
  });

  it('resolves an alias with a type annotation', () => {
    const source = `const off: McpServer['tool'] = offTeamTool(server);\noff('hadron_gone_typed', 'x');`;
    expect(scanSource(source).switchedOff).toEqual(['hadron_gone_typed']);
  });

  it('reads a call straight through the helper', () => {
    expect(scanSource(`offTeamTool(server)('hadron_gone_direct', 'x');`).switchedOff).toEqual(['hadron_gone_direct']);
  });

  it('does not take an unrelated function called off for the switch', () => {
    expect(scanSource(`function off(n: string) {}\noff('hadron_unrelated');`).switchedOff).toEqual([]);
  });

  it('keeps one module\'s alias out of another: each source is read alone', () => {
    expect(scanSource(`off('hadron_elsewhere', 'x');`).switchedOff).toEqual([]);
  });
});

describe('serverTools', () => {
  it('hosts only the kept tool of a module pair in S1\'s shape', () => {
    const { hosted } = serverTools([kept, switched, many]);
    expect(hosted).toContain('hadron_kept');
    expect(hosted).toContain('hadron_kept_beside');
    expect(hosted.filter((n) => n.startsWith('hadron_gone'))).toEqual([]);
  });

  it('collects the switched-off names of every module', () => {
    expect(serverTools([switched, otherAlias, many]).switchedOff).toEqual(['hadron_gone', 'hadron_gone_inline', 'hadron_gone_other']);
  });

  it('subtracts a disabled call the generic regex also matches', () => {
    const { hosted, switchedOff } = serverTools([genericLooking, many]);
    expect(switchedOff).toEqual(['hadron_gone_generic']);
    expect(hosted).not.toContain('hadron_gone_generic');
  });

  it('adds up: hosted is registered minus switched off', () => {
    const { registered, switchedOff, hosted } = serverTools([kept, switched, otherAlias, many]);
    expect(registered).toHaveLength(hosted.length + switchedOff.length);
  });

  it('refuses a ref that shows no switched-off names', () => {
    expect(() => serverTools([kept, many])).toThrow(SWITCH.helper);
  });

  it('refuses a helper renamed out from under it, instead of hosting the disabled tools', () => {
    const renamed = switched.replaceAll('offTeamTool', 'teamToolOff');
    expect(() => serverTools([renamed, many])).toThrow(SWITCH.helper);
  });

  it('refuses a source below the registration floor', () => {
    expect(() => serverTools([switched])).toThrow(/registration shape/);
  });

  it('counts the floor on registrations, so the switched-off names count toward it', () => {
    const justUnder = Array.from({ length: MIN_REGISTERED - 2 }, (_, i) => `server.tool('hadron_filler_${i}', 'x');`).join('\n');
    expect(() => serverTools([justUnder, switched])).not.toThrow();
  });
});

describe('renderAsset', () => {
  const sha = '99246d46434256bb977babc2a64fb8a3d9761aa8';
  const input = { sha, date: '2026-11-04', hosted: ['hadron_a', 'hadron_b'], switchedOff: ['hadron_c'] };

  // Evaluated, not grepped: the header's prose names tools of its own.
  function evaluated(source: string) {
    const exports: Record<string, ReadonlySet<string>> = {};
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
    new Function('exports', outputText)(exports);
    return exports;
  }

  it('declares both sets', () => {
    const asset = evaluated(renderAsset(input));
    expect([...asset.HOSTED_MCP_TOOLS]).toEqual(['hadron_a', 'hadron_b']);
    expect([...asset.SWITCHED_OFF_MCP_TOOLS]).toEqual(['hadron_c']);
  });

  it('names the commit, the switch and both counts in its header', () => {
    const header = renderAsset(input).split('export const')[0];
    expect(header).toContain(sha.slice(0, 12));
    expect(header).toContain(SWITCH.helper);
    expect(header).toMatch(/2 names hosted/);
    expect(header).toMatch(/1 switched off/);
  });

  it('says the switched-off set is a parity input, not a list to show', () => {
    expect(renderAsset(input)).toMatch(/SWITCHED_OFF_MCP_TOOLS[^*]*only the parity test/s);
  });
});
