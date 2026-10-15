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

  it('recovers a session through hadron_whoami and hadron_get_worker, never a fresh bind', () => {
    expect(instructions).toMatch(/`hadron_whoami`/);
    expect(instructions).toMatch(/`hadron_get_worker`/);
    // Binding again after a compaction abandons the handoff the open session
    // owes; the instructions must not suggest it.
    expect(instructions).not.toMatch(/(start|bind)[^.\n]*new session[^.\n]*(compaction|context)/i);
  });
});

/**
 * #1123: hadron-server#1966 (deployed at 4333d600) added a real resume claim.
 * The instructions name it, with the built semantics, beside the existing
 * recovery note, which stays word for word.
 */
describe('hadron-instructions.md describes the resume claim (#1123)', () => {
  const row = (tool: string) =>
    instructions.split('\n').find((l) => l.startsWith(`| \`${tool}\``)) ?? '';

  it('has a row for hadron_create_resume_claim: single use, 60 seconds, only you', () => {
    expect(row('hadron_create_resume_claim')).toMatch(/single use/i);
    expect(row('hadron_create_resume_claim')).toMatch(/60 seconds/);
    expect(row('hadron_create_resume_claim')).toMatch(/only you/i);
  });

  it('has a row for hadron_resume_session: first, no arguments, NOTHING_TO_RESUME', () => {
    expect(row('hadron_resume_session')).toMatch(/no arguments/i);
    expect(row('hadron_resume_session')).toMatch(/`NOTHING_TO_RESUME`/);
  });

  it("names hadron_end_session's resumeClaim", () => {
    expect(row('hadron_end_session')).toMatch(/`resumeClaim: true`/);
  });

  it('keeps the recovery note word for word', () => {
    expect(instructions).toContain(
      "**Recovering after a context reset.** If your conversation loses its context\n" +
        "(a compaction, or a new chat window), don't start a new session: the open one\n" +
        'is still yours, and starting another leaves it behind. Call `hadron_whoami` to\n' +
        'get your open session id (and, if you work as a named worker, which one), and\n' +
        "`hadron_get_worker` to re-read that worker's briefing. Then carry on with the\n" +
        'same session id.',
    );
  });
});
