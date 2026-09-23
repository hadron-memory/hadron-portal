/**
 * #879 — the Task Nodes download endpoint.
 *
 * The empty-org case is pinned in the strong form, as the loader's is: not that
 * the answer is empty, but that `skillPlan` was never ISSUED — the server reads
 * an empty `memories` as every memory the caller can read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ORG_SKILL_BUNDLE_QUERY, SKILL_PLAN_EXPORT_QUERY, SKILL_PLAN_STATUS_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function post(body: unknown, token: string | null = 'tok') {
  const { POST } = await import('./+server');
  const res = await POST({
    request: new Request('http://x/app/orgs/org-1/tasks/plugin', {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params: { id: 'org-1' },
    locals: { token },
  } as never);
  return { status: res.status, body: await res.json() };
}

const BODY = '---\nname: drive-pr-home\ndescription: x\n---\n\nbody\n';

function route(opts: {
  memories?: Array<{ id: string }>;
  entries?: unknown[];
  planThrows?: boolean;
  otherEntries?: unknown[];
  otherThrows?: boolean;
}) {
  mockRequest.mockImplementation(async (query: string) => {
    if (query === SKILL_PLAN_STATUS_QUERY) {
      if (opts.otherThrows) throw new Error('other host down');
      return { skillPlan: { entries: opts.otherEntries ?? [] } };
    }
    if (query === ORG_SKILL_BUNDLE_QUERY) {
      return { organization: { id: 'org-1', name: 'Acme', memories: opts.memories ?? [{ id: 'mem-1' }] } };
    }
    if (query === SKILL_PLAN_EXPORT_QUERY) {
      if (opts.planThrows) throw new Error('boom');
      return { skillPlan: { scanned: 1, judged: 1, entries: opts.entries ?? [] } };
    }
    throw new Error(`Unexpected query: ${String(query).slice(0, 40)}`);
  });
}

const entry = (over: Record<string, unknown> = {}) => ({
  nodeId: 'n1',
  urn: 'hrn:node:acme.com:ops:tasks:drive-pr-home',
  name: 'drive-pr-home',
  class: 'never-exported',
  renderedBody: BODY,
  findings: [],
  ...over,
});

describe('POST /app/orgs/[id]/tasks/plugin', () => {
  it('refuses an anonymous request before any API call (@copilot on #890)', async () => {
    route({});
    const r = await post({ host: 'claudeSkill' }, null);
    expect(r.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses any host but the two declaration keys — including `codex` (#888)', async () => {
    route({});
    for (const host of ['codex', undefined, 'claude']) {
      const r = await post({ host });
      expect(r.status).toBe(400);
    }
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('an org with no memories issues NO skillPlan at all', async () => {
    route({ memories: [] });
    const r = await post({ host: 'claudeSkill' });
    expect(r).toEqual({ status: 409, body: { code: 'no-memories' } });
    expect(mockRequest.mock.calls.filter(([q]) => q === SKILL_PLAN_EXPORT_QUERY)).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([q]) => q === SKILL_PLAN_STATUS_QUERY)).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([q]) => q === ORG_SKILL_BUNDLE_QUERY)).toHaveLength(1);
  });

  it('plans exactly the org\'s memories for the host asked for', async () => {
    route({ memories: [{ id: 'mem-1' }, { id: 'mem-2' }], entries: [entry()] });
    await post({ host: 'codexSkill' });
    const call = mockRequest.mock.calls.find(([q]) => q === SKILL_PLAN_EXPORT_QUERY);
    expect(call?.[1]).toEqual({ host: 'codexSkill', memories: ['mem-1', 'mem-2'] });
  });

  it('returns a Claude plugin zip whose files are the server bodies, plus the report', async () => {
    route({
      entries: [
        entry(),
        entry({ nodeId: 'n2', urn: 'hrn:node:acme.com:ops:tasks:broken', name: 'broken', renderedBody: null,
          findings: [{ rule: 'skill-description-missing', severity: 'error', message: 'needs a description' }] }),
      ],
    });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    expect(r.body.filename).toBe('acme-skills.zip');
    expect(r.body.included).toEqual([{ name: 'drive-pr-home', urn: 'hrn:node:acme.com:ops:tasks:drive-pr-home' }]);
    expect(r.body.skipped).toEqual([
      { name: 'broken', urn: 'hrn:node:acme.com:ops:tasks:broken', reasons: ['needs a description'] },
    ]);

    const zip = await JSZip.loadAsync(r.body.zipBase64, { base64: true });
    const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir).sort();
    expect(paths).toEqual(['.claude-plugin/plugin.json', 'skills/drive-pr-home/SKILL.md']);
    expect(await zip.file('skills/drive-pr-home/SKILL.md')!.async('string')).toBe(BODY);
  });

  it('sends no archive when nothing could be exported, but still says why', async () => {
    route({ entries: [entry({ renderedBody: null })] });
    const r = await post({ host: 'codexSkill' });
    expect(r.status).toBe(200);
    expect(r.body.zipBase64).toBeNull();
    expect(r.body.skipped).toHaveLength(1);
  });

  it('a plan failure is a 502 carrying the server\'s words, not an empty download', async () => {
    route({ planThrows: true });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('plan-failed');
  });

  it('names a task declared for the OTHER host only — from the server, uncapped (@codex on #890)', async () => {
    route({
      memories: [{ id: 'mem-1' }, { id: 'mem-2' }],
      entries: [entry()],
      otherEntries: [
        { nodeId: 'n1', urn: entry().urn, name: 'drive-pr-home', class: 'never-exported' }, // judged by both
        { nodeId: 'solo', urn: 'hrn:node:acme.com:ops:tasks:solo', name: 'solo', class: 'never-exported' },
        { nodeId: 'off', urn: 'hrn:node:acme.com:ops:tasks:off', name: 'off', class: 'disabled' }, // switched off
      ],
    });
    const r = await post({ host: 'codexSkill' });
    expect(r.status).toBe(200);
    expect(r.body.otherHost).toBe('claudeSkill');
    expect(r.body.notForHost).toEqual([{ name: 'solo', urn: 'hrn:node:acme.com:ops:tasks:solo' }]);
    expect(r.body.notForHostUnknown).toBeNull();
    // The OTHER host, over the same memories, as STATUS (no bodies rendered).
    const call = mockRequest.mock.calls.find(([q]) => q === SKILL_PLAN_STATUS_QUERY);
    expect(call?.[1]).toEqual({ host: 'claudeSkill', memories: ['mem-1', 'mem-2'] });
  });

  it('an other-host failure costs the report one section, NOT the download — an export runs to the end', async () => {
    route({ entries: [entry()], otherThrows: true });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    expect(r.body.zipBase64).toEqual(expect.any(String));
    expect(r.body.included).toHaveLength(1);
    expect(r.body.notForHost).toEqual([]);
    expect(r.body.notForHostUnknown).toEqual(expect.any(String));
  });
});
