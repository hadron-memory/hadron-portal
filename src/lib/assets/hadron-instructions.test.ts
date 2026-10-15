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

  it("names hadron_start_session's real arguments", () => {
    expect(startSessionRows).toHaveLength(1);
    // `description` is the one required argument; `workerRef` is what binds a
    // named teammate, which is the reason a team agent starts a session.
    expect(startSessionRows[0]).toMatch(/`description`/);
    expect(startSessionRows[0]).toMatch(/`workerRef`/);
  });
});
