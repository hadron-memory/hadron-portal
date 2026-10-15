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
