/**
 * #911 — the node page's single-skill download endpoint.
 *
 * Pinned in the strong forms: the plan is issued for the FETCHED node's memory,
 * not the URL's (#237), and never with an empty `memories` (which the server
 * reads as every memory the caller can read); the entry is chosen by node id,
 * so a sibling in the same memory is never shipped instead.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { MEMORY_REF_ID_QUERY, NODE_MEMORY_REF_QUERY, SKILL_PLAN_SINGLE_QUERY } from '$lib/server/queries';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));

beforeEach(() => {
  mockRequest.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

async function post(body: unknown, token: string | null = 'tok', nodeRef = 'node-1', memoryParam = 'mem-1') {
  const { POST } = await import('./+server');
  const res = await POST({
    request: new Request(`http://x/app/memories/${memoryParam}/nodes/${nodeRef}/skill`, {
      method: 'POST',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    params: { id: memoryParam, nodeId: nodeRef },
    locals: { token },
  } as never);
  return { status: res.status, body: await res.json() };
}

const BODY = '---\nname: drive-pr-home\ndescription: x\n---\n\nbody\n';
const entry = (over: Record<string, unknown> = {}) => ({
  nodeId: 'node-1',
  urn: 'hrn:node:acme.com:ops:tasks:drive-pr-home',
  name: 'drive-pr-home',
  class: 'never-exported',
  renderedBody: BODY,
  exportPlan: { action: 'WRITE', reasons: [] },
  findings: [],
  ...over,
});

/**
 * The server resolves the URL's memory REF: `mem-1` by id, or its URN — both
 * name the one memory the node lives in. Anything else is another memory (or
 * none the caller can read), and resolves to that or to null.
 */
const MEM_1_URN = 'hrn:mem:acme.com:ops';
function resolveMemory(ref: string) {
  if (ref === 'mem-1' || ref === MEM_1_URN) return { id: 'mem-1' };
  if (ref === 'other-mem') return { id: 'other-mem' };
  return null;
}

function route(opts: { node?: unknown; nodeThrows?: boolean; entries?: unknown[]; planThrows?: boolean }) {
  mockRequest.mockImplementation(async (query: string, vars: { ref?: string }) => {
    if (query === NODE_MEMORY_REF_QUERY) {
      if (opts.nodeThrows) throw new Error('node read down');
      return { node: opts.node === undefined ? { id: 'node-1', memoryId: 'mem-1', isRunnable: true } : opts.node };
    }
    if (query === MEMORY_REF_ID_QUERY) return { memory: resolveMemory(vars.ref ?? '') };
    if (query === SKILL_PLAN_SINGLE_QUERY) {
      if (opts.planThrows) throw new Error('boom');
      // Only what SKILL_PLAN_SINGLE_QUERY selects: no urn, no report.
      return {
        skillPlan: {
          entries: (opts.entries ?? []).map((e) => {
            const { urn: _urn, ...rest } = e as Record<string, unknown>;
            return rest;
          }),
        },
      };
    }
    throw new Error(`Unexpected query: ${String(query).slice(0, 40)}`);
  });
}

const planCalls = () => mockRequest.mock.calls.filter(([q]) => q === SKILL_PLAN_SINGLE_QUERY);

describe('POST …/nodes/[nodeId]/skill — refusals before any plan', () => {
  it('refuses an anonymous request without calling the API', async () => {
    const r = await post({ host: 'claudeSkill' }, null);
    expect(r.status).toBe(401);
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses an unknown host without calling the API', async () => {
    const r = await post({ host: 'codex' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('invalid-host');
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('refuses a node reached through ANOTHER memory\'s URL, and plans nothing (@copilot on #912)', async () => {
    route({ entries: [entry()] });
    const r = await post({ host: 'claudeSkill' }, 'tok', 'node-1', 'other-mem');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('wrong-memory');
    expect(planCalls()).toHaveLength(0);
  });

  it('refuses a plain node on a direct request, and plans nothing (@copilot on #912)', async () => {
    for (const isRunnable of [false, null]) {
      mockRequest.mockReset();
      route({ node: { id: 'node-1', memoryId: 'mem-1', isRunnable }, entries: [entry()] });
      const r = await post({ host: 'claudeSkill' });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('not-a-task');
      expect(planCalls()).toHaveLength(0);
    }
  });

  it('accepts the memory by URN as well as by id: [id] is a ref (@copilot on #912)', async () => {
    route({ entries: [entry()] });
    const r = await post({ host: 'claudeSkill' }, 'tok', 'node-1', MEM_1_URN);
    expect(r.status).toBe(200);
    expect(r.body.filename).toBe('drive-pr-home.zip');
    expect(planCalls().map(([, v]) => v)).toEqual([{ host: 'claudeSkill', memories: ['mem-1'] }]);
  });

  it('refuses a memory ref that resolves to nothing, and plans nothing', async () => {
    route({ entries: [entry()] });
    const r = await post({ host: 'claudeSkill' }, 'tok', 'node-1', 'no-such-mem');
    expect(r.status).toBe(404);
    expect(r.body.code).toBe('wrong-memory');
    expect(planCalls()).toHaveLength(0);
  });

  it('404s a node the caller cannot see, and plans nothing', async () => {
    route({ node: null });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(404);
    expect(planCalls()).toHaveLength(0);
  });
});

describe('POST …/nodes/[nodeId]/skill — the plan and the file', () => {
  it('resolves the node by the URL ref, then plans exactly the FETCHED node\'s memory for the host asked', async () => {
    route({ entries: [entry()] });
    await post({ host: 'codexSkill' }, 'tok', 'hrn:node:acme.com:ops:tasks:drive-pr-home');
    expect(mockRequest.mock.calls.find(([q]) => q === NODE_MEMORY_REF_QUERY)?.[1]).toEqual({
      ref: 'hrn:node:acme.com:ops:tasks:drive-pr-home',
    });
    expect(mockRequest.mock.calls.find(([q]) => q === MEMORY_REF_ID_QUERY)?.[1]).toEqual({ ref: 'mem-1' });
    expect(planCalls().map(([, v]) => v)).toEqual([{ host: 'codexSkill', memories: ['mem-1'] }]);
  });

  it('returns <name>.zip holding <name>/SKILL.md, the server body verbatim', async () => {
    route({ entries: [entry()] });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ host: 'claudeSkill', filename: 'drive-pr-home.zip', reasons: [] });
    const zip = await JSZip.loadAsync(r.body.zipBase64, { base64: true });
    const paths = Object.keys(zip.files).filter((p) => !zip.files[p].dir);
    expect(paths).toEqual(['drive-pr-home/SKILL.md']);
    expect(await zip.file('drive-pr-home/SKILL.md')!.async('string')).toBe(BODY);
  });

  it('ships THIS node, never a sibling from the same memory', async () => {
    route({
      entries: [
        entry({ nodeId: 'sibling', name: 'sibling-skill', renderedBody: 'SIBLING' }),
        entry(),
      ],
    });
    const r = await post({ host: 'claudeSkill' });
    expect(r.body.filename).toBe('drive-pr-home.zip');
    const zip = await JSZip.loadAsync(r.body.zipBase64, { base64: true });
    expect(Object.keys(zip.files).filter((p) => !zip.files[p].dir)).toEqual(['drive-pr-home/SKILL.md']);
  });

  it('sends no archive when the server withheld the body, and says why', async () => {
    route({
      entries: [entry({ renderedBody: null, findings: [{ rule: 'r', severity: 'error', message: 'needs a description' }] })],
    });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ host: 'claudeSkill', filename: null, zipBase64: null, reasons: ['needs a description'] });
  });

  it('sends no archive when the plan has no entry for the node', async () => {
    route({ entries: [entry({ nodeId: 'sibling' })] });
    const r = await post({ host: 'codexSkill' });
    expect(r.body.zipBase64).toBeNull();
    expect(r.body.reasons).toEqual([expect.stringContaining('no Codex entry')]);
  });
});

describe('POST …/nodes/[nodeId]/skill — failures carry the server\'s words', () => {
  it('a plan failure is a 502, not an empty download', async () => {
    route({ planThrows: true });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('plan-failed');
    expect(r.body.zipBase64).toBeUndefined();
  });

  it('a node-read failure is a 502, and plans nothing', async () => {
    route({ nodeThrows: true });
    const r = await post({ host: 'claudeSkill' });
    expect(r.status).toBe(502);
    expect(r.body.code).toBe('node-failed');
    expect(planCalls()).toHaveLength(0);
  });
});
