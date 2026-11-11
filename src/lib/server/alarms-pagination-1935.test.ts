import { describe, it, expect, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { loadAlarms } from './agent-tasks';
import { AGENT_ALARMS_QUERY } from './queries';

describe('1935 newest-end alarms paging', () => {
  it('starts at the newest end and reaches every alarm beyond 2000 without a walk cap', async () => {
    const all = Array.from({ length: 2105 }, (_, i) => ({ id: `alarm-${2105 - i}` }));
    const request = vi.fn(async (_query, vars) => {
      // Reject the old forward walk, not a timing-dependent infinite fixture.
      if (!AGENT_ALARMS_QUERY.includes('newestFirst: true')) throw new Error('oldest-first read');
      const start = vars.before ? all.findIndex(a => a.id === vars.before) + 1 : 0;
      return { agentTeamEvents: all.slice(start, start + vars.limit) };
    });
    const client = { request } as unknown as GraphQLClient;
    const seen: string[] = [];
    let before: string | undefined;
    for (let n = 0; n < 110; n++) {
      const page = await loadAlarms(client, 'app', before);
      expect(page.kind).toBe('ok');
      if (page.kind !== 'ok') throw new Error('read failed');
      expect(page.value.alarms.length).toBeLessThanOrEqual(20);
      seen.push(...page.value.alarms.map(a => a.id));
      before = page.value.nextBefore ?? undefined;
      if (!before) break;
    }
    expect(seen).toEqual(all.map(a => a.id));
    expect(new Set(seen).size).toBe(2105);
    expect(request).toHaveBeenCalledTimes(106);
    expect(request.mock.calls[0][1]).toEqual({ appRef: 'app', before: undefined, limit: 21 });
    expect(request.mock.calls[1][1].before).toBe('alarm-2086');
    expect(AGENT_ALARMS_QUERY).toContain('alarmsOnly: true');
    expect(AGENT_ALARMS_QUERY).not.toContain('after:');
  });

  it('never turns a failed or refused older page into a complete empty page', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce({ response: { errors: [{ extensions: { code: 'APP_NOT_FOUND' } }] } });
    const client = { request } as unknown as GraphQLClient;
    expect(await loadAlarms(client, 'app', 'last')).toEqual({ kind: 'failed' });
    expect(await loadAlarms(client, 'app', 'last')).toEqual({ kind: 'not-participant' });
  });
});
