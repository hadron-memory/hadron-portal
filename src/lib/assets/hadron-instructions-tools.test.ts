/**
 * #1116: the agent instructions name only tools the hosted MCP has. The App
 * page ships hadron-instructions.md to agents as-is (`?raw`), and it listed
 * hadron_resume_session, hadron_save_session_task, hadron_save_plan and
 * hadron_create_pr, none of which hadron-server registers. An agent following
 * it got tool-not-found errors, and no way to recover its session.
 */
import { describe, expect, it } from 'vitest';
import instructions from './hadron-instructions.md?raw';
import { HOSTED_MCP_TOOLS } from './hosted-mcp-tools';

const named = [...new Set(instructions.match(/\bhadron_[a-z_]+\b/g) ?? [])];

describe('hadron-instructions.md names only registered MCP tools (#1116)', () => {
  it('names some tools at all, so the check below is not vacuous', () => {
    expect(named.length).toBeGreaterThan(5);
  });

  it('every tool it names is registered on the server', () => {
    expect(named.filter((n) => !HOSTED_MCP_TOOLS.has(n))).toEqual([]);
  });

  it('recovers a session through hadron_whoami, never a fresh bind', () => {
    expect(instructions).toMatch(/`hadron_whoami`/);
    // Binding again after a compaction abandons the handoff the open session
    // owes; the instructions must not suggest it.
    expect(instructions).not.toMatch(/(start|bind)[^.\n]*new session[^.\n]*(compaction|context)/i);
  });
});

/**
 * #1123 described the MCP resume claim. portal#1496 (MCP cut P1, D1) removes
 * it: a team worker recovers through the CLI, and the recovery note keeps
 * `hadron_whoami` for the agent's own session.
 */
describe('hadron-instructions.md recovery note (#1123, #1496)', () => {
  const row = (tool: string) =>
    instructions.split('\n').find((l) => l.startsWith(`| \`${tool}\``));

  it('has no rows for the resume claim tools', () => {
    expect(row('hadron_create_resume_claim')).toBeUndefined();
    expect(row('hadron_resume_session')).toBeUndefined();
    expect(row('hadron_get_worker')).toBeUndefined();
  });

  it("drops hadron_end_session's resumeClaim", () => {
    expect(row('hadron_end_session')).toBeDefined();
    expect(row('hadron_end_session')).not.toMatch(/resumeClaim/);
  });

  it('keeps the recovery note, with hadron_whoami and the CLI for a team worker', () => {
    expect(instructions).toContain(
      "**Recovering after a context reset.** If your conversation loses its context\n" +
        "(a compaction, or a new chat window), don't start a new session: the open one\n" +
        'is still yours, and starting another leaves it behind. Call `hadron_whoami` to\n' +
        'get your open session id, then carry on with the same session id. A team\n' +
        'worker recovers with `hadron team session whoami` and\n' +
        '`hadron team worker get <name>`.',
    );
  });
});

/**
 * #1125 described hadron_team_chat_post's authorship. portal#1496 (MCP cut P1,
 * D2) replaces the section with the one CLI sentence.
 */
describe('hadron-instructions.md team chat (#1125, #1496)', () => {
  const section = instructions.slice(instructions.indexOf('### Team Chat'), instructions.indexOf('### Reading & Searching'));

  it('is one sentence naming the CLI command', () => {
    expect(section.replace('### Team Chat', '').trim()).toBe('Team workers post with `hadron team chat post <message>`.');
  });
});
