/**
 * #879 — the Task Nodes download endpoint.
 *
 * The empty-org case is pinned in the strong form, as the loader's is: not that
 * the answer is empty, but that `skillPlan` was never ISSUED — the server reads
 * an empty `memories` as every memory the caller can read.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { ClientError } from 'graphql-request';
import { GraphQLError } from 'graphql';
import * as taskMemories from '$lib/server/org-task-memories';
import {
  CREATE_SCOPE_MUTATION,
  DELETE_SCOPE_MUTATION,
  ORG_SKILL_BUNDLE_QUERY,
  ORG_SYSTEM_MEMORY_IDS_QUERY,
  SKILL_PLAN_EXPORT_QUERY,
  SKILL_PLAN_STATUS_QUERY,
} from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  vi.restoreAllMocks();
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
  system?: Array<{ id: string; appId?: string | null }>;
  systemThrow?: boolean;
  unrecognized?: unknown[];
  scopeThrows?: boolean;
  deleteThrows?: boolean;
  scopeError?: unknown;
  deleteFalse?: boolean;
  orgId?: string;
}) {
  mockRequest.mockImplementation(async (query: string, vars?: Record<string, unknown>) => {
    // Spec 049: EXPORT refuses `memories`, even an empty list — the org's memory
    // set travels as a persisted scope, created for the call and deleted after.
    if (query === CREATE_SCOPE_MUTATION) {
      if (opts.scopeThrows) throw new Error('scope boom');
      if (opts.scopeError) throw opts.scopeError;
      return { createScope: { id: 'scope-1' } };
    }
    if (query === DELETE_SCOPE_MUTATION) {
      if (opts.deleteThrows) throw new Error('delete boom');
      return { deleteScope: !opts.deleteFalse };
    }
    if (query === ORG_SYSTEM_MEMORY_IDS_QUERY) {
      if (opts.systemThrow) throw new Error('system boom');
      const items = opts.system ?? [];
      return { memories: { items, total: items.length } };
    }
    if (query === SKILL_PLAN_STATUS_QUERY) {
      if (opts.otherThrows) throw new Error('other host down');
      return { skillPlan: { entries: opts.otherEntries ?? [] } };
    }
    if (query === ORG_SKILL_BUNDLE_QUERY) {
      return { organization: { id: opts.orgId ?? 'org-1', name: 'Acme', memories: opts.memories ?? [{ id: 'mem-1' }] } };
    }
    if (query === SKILL_PLAN_EXPORT_QUERY) {
      if (opts.planThrows) throw new Error('boom');
      if (vars && 'memories' in vars) throw new Error('skillPlan: EXPORT cannot select memories; use scopeRef.');
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

  it('#1689: the export scope includes the org\'s system memories, as the list does', async () => {
    route({ memories: [{ id: 'mem-1' }], system: [{ id: 'sys-1', appId: null }], entries: [] });
    await post({ host: 'claudeSkill' });
    const call = mockRequest.mock.calls.find(([q]) => q === CREATE_SCOPE_MUTATION);
    expect(call?.[1]).toMatchObject({ input: { memoryRefs: ['mem-1', 'sys-1'] } });
  });

  it('#1689: a failed system-memory lookup still exports the good skills but says the scope is incomplete', async () => {
    route({ memories: [{ id: 'mem-1' }], systemThrow: true });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    expect((r.body as { scopeIncomplete: boolean }).scopeIncomplete).toBe(true);
    expect(mockRequest.mock.calls.find(([q]) => q === CREATE_SCOPE_MUTATION)?.[1]).toMatchObject({
      input: { memoryRefs: ['mem-1'] },
    });
  });

  it('#1689: a complete scope reports scopeIncomplete false', async () => {
    route({ memories: [{ id: 'mem-1' }], system: [{ id: 'sys-1', appId: null }] });
    const r = await post({ host: 'claudeSkill' });
    expect((r.body as { scopeIncomplete: boolean }).scopeIncomplete).toBe(false);
  });

  // ── #1706: an App's install memory is not the org's export surface ─────────
  //
  // R208 / cor:api:060:04: neither the EXPORT scope nor the other host's
  // STATUS plan may name an appId-carrying system id. For a platform-ADMIN org
  // member this is not cosmetic: createScope refuses the set with
  // `No match for memoryRef "<install memory id>"`, so the id reaching it is
  // what made that caller's whole org export fail.
  it('#1706: neither the export scope nor the STATUS plan names an appId-carrying system id', async () => {
    route({
      memories: [{ id: 'mem-1' }],
      system: [{ id: 'sys-agent', appId: null }, { id: 'sys-install', appId: 'app-1' }],
      entries: [entry()],
    });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    expect(mockRequest.mock.calls.find(([q]) => q === CREATE_SCOPE_MUTATION)?.[1]).toMatchObject({
      input: { memoryRefs: ['mem-1', 'sys-agent'] },
    });
    expect(mockRequest.mock.calls.find(([q]) => q === SKILL_PLAN_STATUS_QUERY)?.[1]).toEqual({
      host: 'codexSkill',
      memories: ['mem-1', 'sys-agent'],
    });
  });

  it('#1706: an org whose only system memories are install memories is a no-memories refusal, not a failing export', async () => {
    // The filtered set is empty: the strong-form empty-set refusal applies (no
    // skillPlan, no scope), and with it the platform-ADMIN createScope refusal
    // above can no longer happen — the install id never reaches the server.
    route({ memories: [], system: [{ id: 'sys-install', appId: 'app-1' }] });
    const r = await post({ host: 'claudeSkill' });
    expect(r).toEqual({ status: 409, body: { code: 'no-memories' } });
    expect(mockRequest.mock.calls.filter(([q]) => q === CREATE_SCOPE_MUTATION)).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([q]) => q === SKILL_PLAN_EXPORT_QUERY)).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([q]) => q === SKILL_PLAN_STATUS_QUERY)).toHaveLength(0);
  });

  it('#1706: filtering install memories out does not read as an incomplete scope', async () => {
    // Dropping App-owned ids is the INTENDED scope, not a failed lookup:
    // scopeIncomplete stays false (it names a system-list FAILURE) and the
    // system lookup happened and succeeded.
    route({ memories: [{ id: 'mem-1' }], system: [{ id: 'sys-install', appId: 'app-1' }] });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    expect((r.body as { scopeIncomplete: boolean }).scopeIncomplete).toBe(false);
    expect(mockRequest.mock.calls.filter(([q]) => q === ORG_SYSTEM_MEMORY_IDS_QUERY)).toHaveLength(1);
  });

  it('an org with no memories issues NO skillPlan at all', async () => {
    route({ memories: [] });
    const r = await post({ host: 'claudeSkill' });
    expect(r).toEqual({ status: 409, body: { code: 'no-memories' } });
    expect(mockRequest.mock.calls.filter(([q]) => q === SKILL_PLAN_EXPORT_QUERY)).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([q]) => q === SKILL_PLAN_STATUS_QUERY)).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([q]) => q === CREATE_SCOPE_MUTATION)).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([q]) => q === ORG_SKILL_BUNDLE_QUERY)).toHaveLength(1);
  });

  it('plans exactly the org\'s memories for the host asked for', async () => {
    route({ memories: [{ id: 'mem-1' }, { id: 'mem-2' }], entries: [entry()] });
    await post({ host: 'codexSkill' });
    const call = mockRequest.mock.calls.find(([q]) => q === SKILL_PLAN_EXPORT_QUERY);
    expect(call?.[1]).toEqual({ host: 'codexSkill', scopeRef: 'scope-1' });
  });

  it('#1075: EXPORT names a persisted scope (scopeRef), never `memories`; the scope is the org\'s memory set', async () => {
    route({ memories: [{ id: 'mem-1' }, { id: 'mem-2' }], entries: [entry()] });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    const exportVars = mockRequest.mock.calls.find(([q]) => q === SKILL_PLAN_EXPORT_QUERY)?.[1];
    expect(exportVars).not.toHaveProperty('memories');
    const create = mockRequest.mock.calls.find(([q]) => q === CREATE_SCOPE_MUTATION)?.[1] as {
      input: { name: string; memoryRefs: string[]; organizationRef: string };
    };
    expect(create.input.organizationRef).toBe('org-1');
    expect(create.input.memoryRefs).toEqual(['mem-1', 'mem-2']);
    // The server's own name rule: 1-64 of [a-z0-9_-], never `global` / `app`.
    expect(create.input.name).toMatch(/^[a-z0-9_-]{1,64}$/);
  });

  it('#1075: the scope is deleted after the plan, and a delete failure costs the user nothing', async () => {
    route({ entries: [entry()], deleteThrows: true });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    const order = mockRequest.mock.calls.map(([q]) => q);
    expect(order.indexOf(DELETE_SCOPE_MUTATION)).toBeGreaterThan(order.indexOf(SKILL_PLAN_EXPORT_QUERY));
    expect(mockRequest.mock.calls.find(([q]) => q === DELETE_SCOPE_MUTATION)?.[1]).toEqual({ ref: 'scope-1' });
  });

  it('#1075: a failing plan still deletes its scope', async () => {
    route({ planThrows: true });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(502);
    expect(mockRequest.mock.calls.filter(([q]) => q === DELETE_SCOPE_MUTATION)).toHaveLength(1);
  });

  it('#1075: a scope that cannot be created is a plan failure, and no EXPORT is issued', async () => {
    route({ scopeThrows: true });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(502);
    expect((r.body as { code: string }).code).toBe('plan-failed');
    expect(mockRequest.mock.calls.filter(([q]) => q === SKILL_PLAN_EXPORT_QUERY)).toHaveLength(0);
    expect(mockRequest.mock.calls.filter(([q]) => q === DELETE_SCOPE_MUTATION)).toHaveLength(0);
  });

  it('#1075: the other-host STATUS plan keeps `memories` (EXPORT alone refuses it)', async () => {
    route({ memories: [{ id: 'mem-1' }], entries: [entry()] });
    await post({ host: 'claudeSkill' });
    expect(mockRequest.mock.calls.find(([q]) => q === SKILL_PLAN_STATUS_QUERY)?.[1]).toEqual({
      host: 'codexSkill',
      memories: ['mem-1'],
    });
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


describe('#1077 scope refusals and cleanup', () => {
  const providerError = (code: string) => new ClientError(
    { status: 200, headers: new Headers(), body: '', errors: [new GraphQLError('provider refusal', { extensions: { code } })] },
    { query: CREATE_SCOPE_MUTATION },
  );

  it('maps only provider FORBIDDEN to scope-forbidden and never starts either plan', async () => {
    route({ scopeError: providerError('FORBIDDEN') });
    expect(await post({ host: 'codexSkill' })).toEqual({ status: 403, body: { code: 'scope-forbidden' } });
    for (const query of [SKILL_PLAN_EXPORT_QUERY, SKILL_PLAN_STATUS_QUERY, DELETE_SCOPE_MUTATION]) {
      expect(mockRequest.mock.calls.filter(([q]) => q === query)).toHaveLength(0);
    }
  });

  it.each(['INTERNAL_SERVER_ERROR', 'NOT_FOUND', 'PERMISSION_DENIED'])('keeps provider %s as plan-failed/502', async (code) => {
    route({ scopeError: providerError(code) });
    const r = await post({ host: 'codexSkill' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('plan-failed');
  });

  it('does not infer FORBIDDEN from transport error text', async () => {
    route({ scopeError: new Error('FORBIDDEN') });
    const r = await post({ host: 'codexSkill' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('plan-failed');
  });

  it('logs a false delete result safely while still delivering the archive', async () => {
    route({ entries: [entry()], deleteFalse: true });
    const r = await post({ host: 'codexSkill' });
    expect(r.status).toBe(200);
    expect(r.body.zipBase64).toBeTruthy();
    expect(console.error).toHaveBeenCalledWith('[org tasks] deleteScope failed');
    expect(vi.mocked(console.error).mock.calls).toEqual([['[org tasks] deleteScope failed']]);
  });

  it('does not log cleanup error payloads', async () => {
    route({ entries: [entry()], deleteThrows: true });
    expect((await post({ host: 'codexSkill' })).status).toBe(200);
    expect(vi.mocked(console.error).mock.calls).toEqual([['[org tasks] deleteScope failed']]);
  });

  it('prefers the resolved org id over a differently spelled route ref', async () => {
    route({ orgId: 'resolved-org-id' });
    await post({ host: 'codexSkill' });
    expect(mockRequest.mock.calls.find(([q]) => q === CREATE_SCOPE_MUTATION)?.[1]).toMatchObject({ input: { organizationRef: 'resolved-org-id' } });
  });

  it('pins params fallback at the helper boundary when org is null', async () => {
    route({});
    // The real helper refuses absent orgs before scope creation; exercise the
    // defensive fallback without inventing an illegal GraphQL response.
    vi.spyOn(taskMemories, 'orgTaskMemoryIds').mockResolvedValueOnce({ ids: ['mem-1'], org: null, systemFailed: false });
    await post({ host: 'codexSkill' });
    expect(mockRequest.mock.calls.find(([q]) => q === CREATE_SCOPE_MUTATION)?.[1]).toMatchObject({ input: { organizationRef: 'org-1' } });
  });
});
