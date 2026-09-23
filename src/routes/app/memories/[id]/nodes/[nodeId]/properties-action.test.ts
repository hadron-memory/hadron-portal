/**
 * #886 — updateProperties: the Properties tab's Source view saves the WHOLE
 * bag as JSON, through the node's kind door, and refuses to overwrite a bag
 * that changed since the editor was opened.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NODE_PROPERTIES_READ_QUERY, UPDATE_NODE_MUTATION, UPDATE_TASK_NODE_MUTATION } from '$lib/server/queries';
import { PROPERTIES_MAX, propertiesFingerprint, utf8Length } from '$lib/properties-source';

const mockRequest = vi.fn();
vi.mock('$lib/server/api', () => ({ gqlClient: () => ({ request: mockRequest }) }));
vi.mock('$lib/server/guards', () => ({ requireNonConsumer: vi.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockRequest.mockReset();
});

const stored = { url: 'https://x', exports: { claudeSkill: { name: 'x', description: 'd', enable: true } } };

const node = (over: Record<string, unknown> = {}) => ({
  id: 'pk',
  memoryId: 'mem-1',
  loc: 'tasks:x',
  name: 'X',
  description: null,
  isRunnable: false,
  role: null,
  properties: stored,
  ...over,
});

/** Route the fresh read; record every other call as the write. */
function route(opts: { node?: unknown; writeError?: unknown } = {}) {
  const writes: Array<[string, { input: Record<string, unknown> }]> = [];
  mockRequest.mockImplementation(async (query: string, vars: { input: Record<string, unknown> }) => {
    if (query === NODE_PROPERTIES_READ_QUERY) return { node: opts.node === undefined ? node() : opts.node };
    writes.push([query, vars]);
    if (opts.writeError) throw opts.writeError;
    return {};
  });
  return writes;
}

async function save(fields: Record<string, string>, token: string | null = 'tok') {
  const { actions } = await import('./+page.server');
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return actions.updateProperties({
    request: { formData: async () => fd },
    params: { id: 'mem-1', nodeId: 'pk' },
    locals: { token },
  } as never);
}

// What the page posts: the FINGERPRINT of the bag it opened on (@codex on #893).
const baseline = await propertiesFingerprint(stored);

describe('updateProperties — the write', () => {
  it('replaces the bag with exactly the submitted JSON, sending ONLY memoryId, loc and properties', async () => {
    const writes = route();
    const next = { url: 'https://x', exports: { claudeSkill: { name: 'x', description: 'd', enable: false } }, extra: [1] };
    const out = await save({ properties: JSON.stringify(next), baseline });
    expect(out).toEqual({ propertiesSaved: true });
    expect(writes).toHaveLength(1);
    expect(writes[0][1].input).toEqual({ memoryId: 'mem-1', loc: 'tasks:x', properties: next });
  });

  it('goes through the TASK door on a runnable node, the generic one otherwise (#868)', async () => {
    const task = route({ node: node({ isRunnable: true }) });
    await save({ properties: '{"a":1}', baseline });
    expect(task[0][0]).toBe(UPDATE_TASK_NODE_MUTATION);

    const plain = route();
    await save({ properties: '{"a":1}', baseline });
    expect(plain[0][0]).toBe(UPDATE_NODE_MUTATION);
  });

  it('writes nothing when the submitted bag equals the stored one (key order aside)', async () => {
    const writes = route();
    const reordered = { exports: { claudeSkill: { enable: true, description: 'd', name: 'x' } }, url: 'https://x' };
    expect(await save({ properties: JSON.stringify(reordered), baseline })).toEqual({ propertiesSaved: true });
    expect(writes).toHaveLength(0);
  });
});

describe('updateProperties — the stale-page check', () => {
  it('refuses when the stored bag changed since the editor opened, and writes NOTHING', async () => {
    // Someone ticked the Task Nodes export box off while this editor was open.
    const writes = route({ node: node({ properties: { ...stored, exports: { claudeSkill: { name: 'x', description: 'd', enable: false } } } }) });
    const out = await save({ properties: '{"url":"https://y"}', baseline });
    expect(out).toMatchObject({ status: 409, data: { propertiesFailed: { code: 'changed' } } });
    expect(writes).toHaveLength(0);
  });

  it('a baseline that differs only in key order is NOT a change', async () => {
    const writes = route();
    const reorderedBaseline = await propertiesFingerprint({ exports: stored.exports, url: stored.url });
    await save({ properties: '{"a":1}', baseline: reorderedBaseline });
    expect(writes).toHaveLength(1);
  });

  it('an empty stored bag matches a `null` baseline', async () => {
    const writes = route({ node: node({ properties: null }) });
    await save({ properties: '{"a":1}', baseline: await propertiesFingerprint(null) });
    expect(writes).toHaveLength(1);
  });

  it('refuses a save with no readable baseline rather than guessing — missing, or a whole bag instead of a fingerprint', async () => {
    const writes = route();
    for (const bad of [undefined, JSON.stringify(stored), 'abc']) {
      const out = await save(bad === undefined ? { properties: '{"a":1}' } : { properties: '{"a":1}', baseline: bad });
      expect(out).toMatchObject({ status: 400, data: { propertiesFailed: { code: 'no-baseline' } } });
    }
    expect(writes).toHaveLength(0);
  });

  it('a bag AT the size cap still fits the 512 KB body limit — the baseline is a hash, not a second copy (@codex on #893)', async () => {
    // The largest Source text the editor accepts, then the request the page
    // actually sends, measured as the multipart bytes adapter-node counts.
    const filler = 'x'.repeat(PROPERTIES_MAX - 20);
    const atCap = `{"k": "${filler}"}`;
    expect(utf8Length(atCap)).toBeLessThanOrEqual(PROPERTIES_MAX);
    const fd = new FormData();
    fd.set('properties', atCap);
    fd.set('baseline', baseline);
    const bytes = (await new Response(fd).arrayBuffer()).byteLength;
    expect(bytes).toBeLessThan(512 * 1024);
    // …which two full copies would not have.
    fd.set('baseline', atCap);
    expect((await new Response(fd).arrayBuffer()).byteLength).toBeGreaterThan(512 * 1024);
  });
});

describe('updateProperties — refusals', () => {
  it.each([
    ['empty text', '   ', 'empty'],
    ['invalid JSON', '{"a": }', 'invalid-json'],
    ['an array', '[1]', 'not-object'],
    ['a bare null', 'null', 'not-object'],
    ['a number JSON cannot carry back', '{"huge": 1e400}', 'unsafe-number'],
  ])('%s is refused before any API call', async (_what, properties, code) => {
    route();
    const out = await save({ properties, baseline });
    expect(out).toMatchObject({ status: 400, data: { propertiesFailed: { code } } });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('an anonymous POST is refused before any API call', async () => {
    route();
    const out = await save({ properties: '{}', baseline }, null);
    expect(out).toMatchObject({ status: 401, data: { propertiesFailed: { code: 'unauthenticated' } } });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('a node that is gone is not-found, with no write', async () => {
    const writes = route({ node: null });
    const out = await save({ properties: '{}', baseline });
    expect(out).toMatchObject({ status: 404, data: { propertiesFailed: { code: 'not-found' } } });
    expect(writes).toHaveLength(0);
  });

  it('a memory-schema refusal (strict collection) reaches the user in the SERVER\'s words', async () => {
    const err = Object.assign(new Error('x'), {
      response: {
        errors: [{ message: 'Unknown property "exports" on strict collection "competitor"', extensions: { code: 'BAD_USER_INPUT' } }],
      },
    });
    route({ writeError: err });
    const out = await save({ properties: '{"exports":{}}', baseline });
    expect(out).toMatchObject({ status: 400, data: { propertiesFailed: { code: 'rejected' } } });
    expect((out as { data: { propertiesFailed: { detail: string } } }).data.propertiesFailed.detail).toContain('strict collection');
  });
});
