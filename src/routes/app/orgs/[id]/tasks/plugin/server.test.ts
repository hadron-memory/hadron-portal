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
  unrecognized?: unknown[];
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
      // `unrecognized` is non-null in the schema (server#1296), so every legal
      // response carries it — an empty list when nothing is unrecognised.
      return { skillPlan: { scanned: 1, judged: 1, entries: opts.entries ?? [], unrecognized: opts.unrecognized ?? [] } };
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
  // Every EXPORT entry carries an exportPlan (schema: "Present only for
  // EXPORT"), so a legal fixture does too.
  exportPlan: { action: 'WRITE', reasons: [] },
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

    // #909: the manifest in the zip carries the content version the report names.
    const manifest = JSON.parse(await zip.file('.claude-plugin/plugin.json')!.async('string'));
    expect(manifest.name).toBe('acme-skills');
    expect(manifest.version).toMatch(/^0\.0\.0-h[0-9a-f]{12}$/);
    expect(r.body.version).toBe(manifest.version);
  });

  it('#909: the same content downloads with the same version, and the Codex download has none', async () => {
    route({ entries: [entry()] });
    const first = await post({ host: 'claudeSkill' });
    route({ entries: [entry()] });
    const again = await post({ host: 'claudeSkill' });
    expect(again.body.version).toBe(first.body.version);
    route({ entries: [entry({ renderedBody: BODY + 'edited\n' })] });
    const edited = await post({ host: 'claudeSkill' });
    expect(edited.body.version).not.toBe(first.body.version);
    route({ entries: [entry()] });
    expect((await post({ host: 'codexSkill' })).body.version).toBeNull();
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

  // server#1296 — a key under `exports` that names no host.
  const unknown = (over: Record<string, unknown> = {}) => ({
    nodeId: 'typo',
    urn: 'hrn:node:acme.com:ops:tasks:typo',
    name: 'Typo task',
    keyCount: 1,
    keys: ['codex'],
    findings: [{ rule: 'skill-host-unknown', severity: 'warning', message: 'properties.exports key "codex" names no skill host' }],
    ...over,
  });

  it('reports a task declared ONLY under an unknown key, which is in neither the entries nor the other-host list', async () => {
    route({ entries: [entry()], unrecognized: [unknown()] });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    // The case that used to vanish: no entry, no other-host row, no skip.
    expect(r.body.skipped).toEqual([]);
    expect(r.body.notForHost).toEqual([]);
    expect(r.body.unrecognized).toEqual([
      {
        name: 'Typo task',
        urn: 'hrn:node:acme.com:ops:tasks:typo',
        inDownload: false,
        keyCount: 1,
        messages: ['properties.exports key "codex" names no skill host'],
      },
    ]);
  });

  it('says a task with an unknown key IS in the download when a host key exports it — joined on node id', async () => {
    route({
      entries: [entry()],
      // Same node as the exported entry, under a DIFFERENT URN spelling: the
      // join is on node id, so a lossy emitted URN cannot flip the answer.
      unrecognized: [unknown({ nodeId: 'n1', urn: 'hrn:node:acme.com:ops:tasks:other-spelling' })],
    });
    const r = await post({ host: 'codexSkill' });
    expect(r.body.included).toHaveLength(1);
    expect(r.body.unrecognized).toHaveLength(1);
    expect(r.body.unrecognized[0].inDownload).toBe(true);
  });

  it('carries the TRUE key count, not the length of the capped key list', async () => {
    route({ entries: [], unrecognized: [unknown({ keyCount: 14, keys: Array.from({ length: 10 }, (_, i) => `k${i}`) })] });
    const r = await post({ host: 'claudeSkill' });
    expect(r.body.unrecognized[0].keyCount).toBe(14);
  });

  it('selects `unrecognized` in the EXPORT plan it sends', async () => {
    route({ entries: [entry()] });
    await post({ host: 'claudeSkill' });
    const call = mockRequest.mock.calls.find(([q]) => q === SKILL_PLAN_EXPORT_QUERY);
    const doc = String(call?.[0]);
    // Structure, not a substring of the whole document: the field must sit
    // inside skillPlan's selection with keyCount beneath it.
    expect(doc).toMatch(/skillPlan\([^)]*\)\s*\{[^]*?\bunrecognized\s*\{[^}]*\bkeyCount\b/);
  });
});
