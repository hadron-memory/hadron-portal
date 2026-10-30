/**
 * portal#1316 (hadron-server#2061 / #2475) — the composition read keeps the
 * Tasks views' three outcomes and asks the server for exactly the closed
 * projection the SDL promises, nothing the server did not offer.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphQLClient } from 'graphql-request';
import { TEAM_COMPOSITION_QUERY } from '$lib/server/queries';
import { loadComposition } from './agent-tasks';

const request = vi.fn();
const client = { request } as unknown as GraphQLClient;
const gqlError = (code: string) => ({ response: { errors: [{ message: code, extensions: { code } }] } });

beforeEach(() => {
  request.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('loadComposition', () => {
  it('returns the server response untouched, and reads it once for the App', async () => {
    const composition = { appId: 'app-1', asOf: '2026-10-26T00:00:00Z', lanes: [] };
    request.mockResolvedValueOnce({ teamComposition: composition });
    expect(await loadComposition(client, 'app-1')).toEqual({ kind: 'ok', value: composition });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(TEAM_COMPOSITION_QUERY, { appRef: 'app-1' });
  });

  it('keeps a refusal and an outage apart, and neither is an empty team', async () => {
    request.mockRejectedValueOnce(gqlError('APP_NOT_FOUND'));
    expect(await loadComposition(client, 'app-1')).toEqual({ kind: 'not-participant' });
    request.mockRejectedValueOnce(new Error('down'));
    expect(await loadComposition(client, 'app-1')).toEqual({ kind: 'failed' });
  });

  it('selects the lane, headcount and worker fields the SDL defines, and no task or holder field', () => {
    for (const field of [
      'teamComposition(appRef: $appRef)', 'asOf', 'lanes', 'coordinator', 'coordinatorRetired',
      'countsByRole', 'countsByRoleFamily', 'worker', 'role', 'family', 'bound', 'liveSession', 'state', 'count',
    ]) expect(TEAM_COMPOSITION_QUERY).toContain(field);
    for (const absent of ['startedTasks', 'pendingTasks', 'heldBy', 'checkStatus']) expect(TEAM_COMPOSITION_QUERY).not.toContain(absent);
  });
});
