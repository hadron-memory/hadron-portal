import { readFileSync } from 'node:fs';
import { buildSchema, parse, validate } from 'graphql';
import type { GraphQLClient } from 'graphql-request';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AGENT_TASK_DETAIL_QUERY, AGENT_TASK_EVENTS_QUERY, AGENT_TASK_FINDINGS_QUERY } from '$lib/server/queries';
import { OPTIONAL_LIST_TIMEOUT_MS } from '$lib/server/with-timeout';
import { loadTaskFindings, streamTaskFindings } from './task-findings';
import { TASK_FINDINGS_PAGE_SIZE } from '$lib/agent-tasks/findings';

const request = vi.fn();
const client = { request } as unknown as GraphQLClient;
const gqlError = (code: string) => ({ response: { errors: [{ message: 'private provider detail', extensions: { code } }] } });
const answer = (items: unknown[] = [], total = items.length, hasMore = false) => ({
  agentTask: { id: 'canonical', result: { findings: { items, total, hasMore } } },
});

beforeEach(() => { request.mockReset(); vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('dedicated immutable-findings query', () => {
  it('is legal under the pinned SDL and selects exactly the paged finding fields', () => {
    const schema = buildSchema(readFileSync('schema/schema.graphql', 'utf8'));
    expect(validate(schema, parse(AGENT_TASK_FINDINGS_QUERY))).toEqual([]);
    expect(AGENT_TASK_FINDINGS_QUERY).toMatch(/agentTask\(id:\s*\$id\)\s*\{\s*id\s*result\s*\{\s*findings\(limit:\s*\$limit,\s*offset:\s*\$offset\)\s*\{\s*items\s*\{\s*id\s+severity\s+text\s*\}\s*total\s+hasMore/);
    expect(AGENT_TASK_FINDINGS_QUERY).not.toMatch(/findingDispositions|agentTeamEvents|disposeAgentTaskFinding|finishAgentTask/);
  });

  it('does not expand the shared task detail, history, event or disposition reads', () => {
    expect(AGENT_TASK_DETAIL_QUERY).not.toContain('findings(');
    expect(AGENT_TASK_DETAIL_QUERY).not.toContain('findingDispositions');
    expect(AGENT_TASK_EVENTS_QUERY).not.toContain('text');
    expect(AGENT_TASK_FINDINGS_QUERY).not.toContain('mutation ');
  });

  it('uses the canonical id and fixed requested size 20 with the requested offset', async () => {
    request.mockResolvedValueOnce(answer([{ id: 'F1', severity: 'P1', text: 'first' }], 45, true));
    expect(await loadTaskFindings(client, 'canonical', 20)).toEqual({ kind: 'page', value: {
      taskId: 'canonical', offset: 20, items: [{ id: 'F1', severity: 'P1', text: 'first' }], total: 45, hasMore: true,
    } });
    expect(request).toHaveBeenCalledExactlyOnceWith(AGENT_TASK_FINDINGS_QUERY, { id: 'canonical', limit: TASK_FINDINGS_PAGE_SIZE, offset: 20 });
  });
});

describe('findings read states', () => {
  it('distinguishes a legacy valid zero page from no result and an unreadable/missing task', async () => {
    request.mockResolvedValueOnce(answer([], 0, false));
    expect(await loadTaskFindings(client, 'canonical', 0)).toEqual({ kind: 'page', value: { taskId: 'canonical', offset: 0, items: [], total: 0, hasMore: false } });
    request.mockResolvedValueOnce({ agentTask: { id: 'canonical', result: null } });
    expect(await loadTaskFindings(client, 'canonical', 0)).toEqual({ kind: 'no-result' });
    request.mockResolvedValueOnce({ agentTask: null });
    expect(await loadTaskFindings(client, 'canonical', 0)).toEqual({ kind: 'unavailable' });
  });

  it.each(['FORBIDDEN', 'NOT_FOUND', 'TASK_NOT_FOUND', 'APP_NOT_FOUND'])('maps the known %s concealment answer to unavailable', async (code) => {
    request.mockRejectedValueOnce(gqlError(code));
    expect(await loadTaskFindings(client, 'canonical', 0)).toEqual({ kind: 'unavailable' });
  });

  it.each([
    ['an old provider without the field', gqlError('GRAPHQL_VALIDATION_FAILED')],
    ['a generic database error', gqlError('INTERNAL_SERVER_ERROR')],
    ['a transport fault', new Error('socket private detail')],
  ])('keeps %s failed, never empty', async (_label, fault) => {
    request.mockRejectedValueOnce(fault);
    expect(await loadTaskFindings(client, 'canonical', 0)).toEqual({ kind: 'failed' });
  });

  it('refuses malformed pages instead of casting them', async () => {
    request.mockResolvedValueOnce({ agentTask: { id: 'canonical', result: { findings: { items: [{ id: 'F1', severity: 'P1' }], total: 1, hasMore: false } } } });
    expect(await loadTaskFindings(client, 'canonical', 0)).toEqual({ kind: 'failed' });
  });
});

describe('the page loader optional stream', () => {
  it('does no findings read when the existing result is null', async () => {
    expect(await streamTaskFindings(client, { id: 'canonical', result: null })).toEqual({ kind: 'no-result' });
    expect(request).not.toHaveBeenCalled();
  });

  it('returns a caught value and never a raw rejected streamed promise', async () => {
    request.mockRejectedValueOnce(new Error('private failure'));
    const streamed = streamTaskFindings(client, { id: 'canonical', result: { outcome: 'done' } });
    expect(streamed).toBeInstanceOf(Promise);
    await expect(streamed).resolves.toEqual({ kind: 'failed' });
  });

  it('settles a hung read to failed at the optional 8s bound', async () => {
    vi.useFakeTimers();
    request.mockImplementationOnce(() => new Promise(() => {}));
    const streamed = streamTaskFindings(client, { id: 'canonical', result: { outcome: 'done' } });
    await vi.advanceTimersByTimeAsync(OPTIONAL_LIST_TIMEOUT_MS);
    await expect(streamed).resolves.toEqual({ kind: 'failed' });
  });
});
