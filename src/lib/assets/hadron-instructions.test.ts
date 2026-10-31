/**
 * #986: the agent instructions the App page hands out must describe the hosted
 * MCP's real `hadron_start_session`. The asset said it took
 * `(level: basic/guided/learn)`: the hosted tool has no `level` argument (levels
 * live only in hadron-client's `.hadron/config.json`), so an agent passed an
 * argument the server ignores and believed it had set a guided level.
 */
import { describe, expect, it } from 'vitest';
import instructions from './hadron-instructions.md?raw';

// The tool table's row. (The workflow list also names the tool in prose, with
// no arguments, which the no-level check above already covers.)
const startSessionRows = instructions
  .split('\n')
  .filter((l) => l.startsWith('| `hadron_start_session`'));

describe('hadron-instructions.md (#986)', () => {
  it('claims no level argument anywhere', () => {
    expect(instructions).not.toMatch(/\blevel\s*:/i);
    expect(instructions).not.toMatch(/basic\s*\/\s*guided\s*\/\s*learn/i);
  });

  it("names hadron_start_session's real argument and no worker binding", () => {
    expect(startSessionRows).toHaveLength(1);
    // `description` is the one required argument. portal#1496: a worker is no
    // longer bound through MCP, so the row names no `workerRef`.
    expect(startSessionRows[0]).toMatch(/`description`/);
    expect(instructions).not.toMatch(/workerRef/);
  });
});

/**
 * portal#1496 (MCP cut P1, rulings D1, D2, D4): team workers bind, recover and
 * post through the hadron CLI. The text describes that path; it runs nothing.
 */
describe('hadron-instructions.md sends team workers to the CLI (#1496)', () => {
  const sentences = instructions.split(/(?<=[.!?])\s+|\n\s*\n/);

  it('keeps the session tools an agent still has', () => {
    expect(instructions).toMatch(/`hadron_start_session`/);
    expect(instructions).toMatch(/`hadron_whoami`/);
    expect(instructions).toMatch(/`hadron_end_session`/);
  });

  it('drops the worker resume claim', () => {
    expect(instructions).not.toMatch(/resumeClaim/);
  });

  it('names the CLI commands for a new binding, recovery and team chat', () => {
    expect(instructions).toContain('`hadron team session start --as <worker>`');
    expect(instructions).toContain('`hadron team session whoami --check`');
    expect(instructions).toContain('`hadron team worker get <worker>`');
    expect(instructions).toContain('`hadron team chat post <message>`');
  });

  // hrn:node:hadronmemory.com:specs:cor:agt:020:03: plain start resumes the one live session or redeems the one
  // claim; when it lists several, the person chooses.
  it('recovers with a plain start, and the person picks among several', () => {
    const recovery = sentences.find((s) => s.includes('`hadron team session start` with no `--as`')) ?? '';
    expect(recovery).toMatch(/resumes your one live worker session/);
    expect(recovery).toMatch(/redeems your one resume claim/);
    expect(recovery).toMatch(/ask the person which one, never pick/);
  });

  it('never pairs binding with --as and resuming or recovering in one sentence', () => {
    const asBinds = sentences.filter((s) => /--as </.test(s));
    expect(asBinds.length).toBeGreaterThan(0);
    for (const s of asBinds) expect(s).not.toMatch(/resum|recover/i);
  });

  // D4: before S1 deploys, the CLI is the supported path; nothing says the
  // server already refuses an MCP worker binding.
  it('calls the CLI the supported path and claims no server refusal', () => {
    expect(instructions).toMatch(/the supported path for team work/);
    expect(instructions).not.toMatch(/refuse[sd]?[^.\n]*(MCP|bind)/i);
  });

  it('says a CLI session id is passed as `session` for attribution', () => {
    expect(instructions).toMatch(/pass its id as `session`/);
  });
});
