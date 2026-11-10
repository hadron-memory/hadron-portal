import { describe, it, expect, vi } from 'vitest';
import { readCustomisation, writeCustomisation } from './install-customisation';
const context = { appRef: 'app-a', agentRef: 'agent-a' };
const app = {
  app: { id: 'app-a', agents: [{ id: 'agent-a', systemMemoryId: 'original' }] },
};
const client = (results: unknown[]) => ({
  request: vi.fn(async (..._args: unknown[]) => {
    const r = results.shift();
    if (r instanceof Error) throw r;
    return r;
  }),
});
describe('install customisation', () => {
  it('distinguishes concealed from failed install reads', async () => {
    expect(
      (
        await readCustomisation(
          client([app, { installMemory: null }]) as never,
          context,
          0,
        )
      ).list.state,
    ).toBe('not-shown');
    expect(
      (
        await readCustomisation(
          client([app, new Error('credential=secret')]) as never,
          context,
          0,
        )
      ).list.state,
    ).toBe('failed');
  });
  it('refuses a foreign Agent before any install read', async () => {
    const c = client([{ app: { id: 'app-a', agents: [] } }]);
    expect((await readCustomisation(c as never, context, 0)).list.state).toBe(
      'failed',
    );
    expect(c.request).toHaveBeenCalledTimes(1);
  });
  it('uses server total and distinguishes empty text from an unreadable original', async () => {
    const c = client([
      app,
      { installMemory: { id: 'install', urn: 'hrn:mem:acme.com:install' } },
      { memoryNodes: { nodes: [{ id: 'n', loc: 'x', name: 'X' }], total: 25 } },
      { node: { id: 'n', loc: 'x', name: 'X', content: '', revision: 7 } },
      { node: null },
    ]);
    const r = await readCustomisation(c as never, context, 20, 'x');
    expect(r.list).toMatchObject({
      state: 'ok',
      value: { total: 25, offset: 20 },
    });
    expect(r.replacement).toMatchObject({
      state: 'ok',
      value: { content: '', revision: 7 },
    });
    expect(r.original.state).toBe('not-shown');
    expect(
      c.request.mock.calls
        .map((c: unknown[]) => c[0])
        .filter((s: unknown) => String(s).includes('raw: true')),
    ).toHaveLength(2);
  });
  it('posts only changed content with the exact expected revision', async () => {
    const c = client([
      { installMemory: { id: 'install' } },
      { node: { role: null, isRunnable: false } },
      {},
    ]);
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      agentRef: 'agent-a',
      loc: 'x',
      content: 'new',
      baseContent: 'old',
      expectedRevision: '7',
    }))
      fd.set(k, v);
    await writeCustomisation(c as never, 'app-a', fd, false);
    expect(c.request.mock.calls.at(-1)?.[1]).toEqual({
      input: {
        install: context,
        loc: 'x',
        content: 'new',
        expectedRevision: 7,
      },
    });
  });
  it('invalid revision sends nothing', async () => {
    const c = client([]);
    const fd = new FormData();
    fd.set('agentRef', 'agent-a');
    fd.set('loc', 'x');
    fd.set('content', 'new');
    expect(
      await writeCustomisation(c as never, 'app-a', fd, false),
    ).toMatchObject({ status: 400 });
    expect(c.request).not.toHaveBeenCalled();
  });
  it('keeps a create conflict a create and never echoes transport credentials', async () => {
    const c = client([new Error('credential=secret')]);
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      agentRef: 'agent-a',
      loc: 'x',
      name: 'X',
      content: 'draft',
    }))
      fd.set(k, v);
    const r = await writeCustomisation(c as never, 'app-a', fd, true);
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(c.request).toHaveBeenCalledTimes(1);
  });
});

describe('customisation refusal and revision safety', () => {
  const form = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      agentRef: 'agent-a',
      loc: 'x',
      name: 'X',
      content: 'new',
      baseContent: 'old',
      expectedRevision: '7',
    }))
      fd.set(k, v);
    return fd;
  };
  it.each([
    'AGENT_NOT_INSTALLED',
    'INSTALL_TARGET_CHANGED',
    'INSTALL_MEMORY_NOT_FOUND',
    'URN_NOT_QUALIFIED',
    'NODE_WRITE_CONFLICT',
    'NodeLocConflictError',
    'FORBIDDEN',
    'APP_UNINSTALLED',
    'AGENT_ORG_GRANT_REQUIRED',
    'UNKNOWN_REFUSAL',
  ])(
    'preserves the own server text for %s without exposing request credentials',
    async (code) => {
      const error = Object.assign(new Error('request credential=secret'), {
        response: {
          errors: [
            {
              message: 'Own server prose <b>verbatim</b>',
              extensions: { code },
            },
          ],
        },
      });
      const c = client([error]);
      const result = await writeCustomisation(
        c as never,
        'app-a',
        form(),
        true,
      );
      expect(JSON.stringify(result)).toContain(
        code === 'UNKNOWN_REFUSAL' ? 'Something went wrong on our side.' : 'Own server prose <b>verbatim</b>',
      );
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(c.request).toHaveBeenCalledTimes(1);
      if (code === 'UNKNOWN_REFUSAL')
        expect(result).toMatchObject({ status: 500 });
    },
  );
  it('does not write unchanged content', async () => {
    const c = client([]);
    const fd = form();
    fd.set('content', 'old');
    expect(await writeCustomisation(c as never, 'app-a', fd, false)).toEqual({
      saved: true,
    });
    expect(c.request).not.toHaveBeenCalled();
  });
  it('does not advance the displayed baseline when governance is refreshed', async () => {
    const c = client([
      { installMemory: { id: 'i' } },
      { node: { role: null, isRunnable: false, revision: 99 } },
      {},
    ]);
    await writeCustomisation(c as never, 'app-a', form(), false);
    expect(c.request.mock.calls.at(-1)?.[1]).toMatchObject({
      input: { expectedRevision: 7 },
    });
  });
  it('keeps independent original and replacement failure states', async () => {
    const c = client([
      app,
      { installMemory: { id: 'i', urn: null } },
      { memoryNodes: { nodes: [], total: 0 } },
      new Error('read failed'),
      {
        node: { id: 'o', loc: 'x', name: 'Original', content: '', revision: 1 },
      },
    ]);
    const r = await readCustomisation(c as never, context, 0, 'x');
    expect(r.replacement.state).toBe('failed');
    expect(r.original).toMatchObject({ state: 'ok', value: { content: '' } });
  });
});

// #1368: the demand read honours the same bare-loc boundary as the write.
describe('bare-loc boundary on the demand read (#1368)', () => {
  const listed = () => [
    app,
    { installMemory: { id: 'install', urn: 'hrn:mem:acme.com:install' } },
    { memoryNodes: { nodes: [{ id: 'n', loc: 'x', name: 'X' }], total: 1 } },
  ];
  const queries = (c: ReturnType<typeof client>) =>
    c.request.mock.calls.map((call: unknown[]) => String(call[0]));
  it.each([
    'hrn:node:acme.com:other:secret',
    '  hrn:node:acme.com:other:secret',
    'hrn:mem:acme.com:other',
  ])('sends no node read for the qualified ref %j and keeps the list', async (loc) => {
    const c = client([
      ...listed(),
      { node: { id: 'o', loc: 'secret', name: 'Other', content: 'foreign', revision: 1 } },
      { node: { id: 'o', loc: 'secret', name: 'Other', content: 'foreign', revision: 1 } },
    ]);
    const r = await readCustomisation(c as never, context, 0, loc);
    expect(c.request).toHaveBeenCalledTimes(3);
    expect(queries(c).some((q) => q.includes('raw: true'))).toBe(false);
    expect(r.list).toMatchObject({ state: 'ok', value: { total: 1 } });
    expect(r.replacement).toEqual({ state: 'not-shown' });
    expect(r.original).toEqual({ state: 'not-shown' });
    expect(JSON.stringify(r)).not.toContain('foreign');
  });
  it('reads a bare loc from exactly the install and system memories', async () => {
    const c = client([
      ...listed(),
      { node: { id: 'r', loc: 'x', name: 'X', content: 'mine', revision: 2 } },
      { node: { id: 'o', loc: 'x', name: 'X', content: 'base', revision: 1 } },
    ]);
    const r = await readCustomisation(c as never, context, 0, 'x');
    expect(c.request).toHaveBeenCalledTimes(5);
    expect(c.request.mock.calls.slice(3).map((call: unknown[]) => call[1])).toEqual([
      { memoryRef: 'install', ref: 'loc:x' },
      { memoryRef: 'original', ref: 'loc:x' },
    ]);
    expect(queries(c).slice(3).map((q) => /query (\w+)/.exec(q)?.[1])).toEqual([
      'InstallNode',
      'OriginalNode',
    ]);
    expect(r.replacement).toMatchObject({ state: 'ok', value: { content: 'mine' } });
    expect(r.original).toMatchObject({ state: 'ok', value: { content: 'base' } });
  });
  it.each([undefined, ''])('sends no node read without a selection (%j)', async (loc) => {
    const c = client(listed());
    const r = await readCustomisation(c as never, context, 0, loc);
    expect(c.request).toHaveBeenCalledTimes(3);
    expect(r.replacement).toEqual({ state: 'not-shown' });
    expect(r.original).toEqual({ state: 'not-shown' });
  });
  it('keeps missing, withheld and failed apart', async () => {
    const withheld = client([
      { app: { id: 'app-a', agents: [{ id: 'agent-a', systemMemoryId: null }] } },
      { installMemory: { id: 'install', urn: null } },
      { memoryNodes: { nodes: [], total: 0 } },
      { node: null },
    ]);
    const w = await readCustomisation(withheld as never, context, 0, 'x');
    expect(withheld.request).toHaveBeenCalledTimes(4);
    expect(w.replacement).toEqual({ state: 'not-shown' });
    expect(w.original).toEqual({ state: 'not-shown' });
    const failed = client([...listed(), new Error('down'), new Error('down')]);
    const f = await readCustomisation(failed as never, context, 0, 'x');
    expect(f.replacement).toEqual({ state: 'failed' });
    expect(f.original).toEqual({ state: 'failed' });
  });
});

describe('bare-loc boundary on the write (#1368)', () => {
  it.each([
    ['create', true],
    ['save', false],
  ])('refuses a qualified loc on %s before any request', async (_kind, create) => {
    for (const loc of ['hrn:node:acme.com:other:x', ' hrn:node:acme.com:other:x']) {
      const c = client([]);
      const fd = new FormData();
      for (const [k, v] of Object.entries({
        agentRef: 'agent-a',
        loc,
        name: 'X',
        content: 'new',
        baseContent: 'old',
        expectedRevision: '7',
      }))
        fd.set(k, v);
      expect(await writeCustomisation(c as never, 'app-a', fd, create)).toMatchObject({
        status: 400,
        data: { customisationFailed: { code: 'invalid' } },
      });
      expect(c.request).not.toHaveBeenCalled();
    }
  });
});

describe('fixed refusal lead per mapped code (#1368)', () => {
  const changed = 'The installation changed. Reload before trying again.';
  const leads: Record<string, string> = {
    AGENT_NOT_INSTALLED: changed,
    INSTALL_TARGET_CHANGED: changed,
    APP_UNINSTALLED: changed,
    INSTALL_MEMORY_NOT_FOUND:
      'The customisation is not available. Reload before trying again.',
    NODE_WRITE_CONFLICT:
      'Another edit was saved. Your draft is kept; reload to start from the current version.',
    NodeLocConflictError:
      'Another edit was saved. Your draft is kept; reload to start from the current version.',
    FORBIDDEN: 'This change was refused. Your draft is kept.',
    URN_NOT_QUALIFIED: 'Use a bare loc for this customisation.',
    AGENT_ORG_GRANT_REQUIRED:
      'This App’s organization needs an active grant to customise this Agent. Your draft is kept.',
  };
  const conflicts = new Set(['NODE_WRITE_CONFLICT', 'AGENT_ORG_GRANT_REQUIRED']);
  const refuse = async (code: string) => {
    const error = Object.assign(new Error('request credential=secret'), {
      response: {
        errors: [{ message: 'Own server prose <b>verbatim</b>', extensions: { code } }],
      },
    });
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      agentRef: 'agent-a',
      loc: 'x',
      name: 'X',
      content: 'new',
    }))
      fd.set(k, v);
    return (await writeCustomisation(client([error]) as never, 'app-a', fd, true)) as {
      status: number;
      data: { customisationFailed: { code: string; detail: string } };
    };
  };
  it.each(Object.entries(leads))('%s leads with its fixed sentence', async (code, lead) => {
    const r = await refuse(code);
    expect(r.data.customisationFailed).toEqual({
      code,
      detail: `${lead} Own server prose <b>verbatim</b>`,
    });
    expect(r.status).toBe(code === 'FORBIDDEN' ? 403 : conflicts.has(code) ? 409 : 400);
    expect(JSON.stringify(r)).not.toContain('secret');
  });
  // #1785: update reach is Proposed in hrn:mem:hadronmemory.com:specs until
  // hadron-server#3628 ships, so this refusal is a mock of what it will send.
  it('leads an update refused for a missing grant the same way as a create', async () => {
    const code = 'AGENT_ORG_GRANT_REQUIRED';
    const error = Object.assign(new Error('request credential=secret'), {
      response: {
        errors: [{ message: 'Own server prose <b>verbatim</b>', extensions: { code } }],
      },
    });
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      agentRef: 'agent-a',
      loc: 'x',
      content: 'new',
      baseContent: 'old',
      expectedRevision: '7',
    }))
      fd.set(k, v);
    const c = client([
      { installMemory: { id: 'i' } },
      { node: { role: null, isRunnable: false, revision: 7 } },
      error,
    ]);
    const r = (await writeCustomisation(c as never, 'app-a', fd, false)) as {
      status: number;
      data: { customisationFailed: { code: string; detail: string } };
    };
    expect(r.status).toBe(409);
    expect(r.data.customisationFailed).toEqual({
      code,
      detail: `${leads[code]} Own server prose <b>verbatim</b>`,
    });
    expect(c.request).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(r)).not.toContain('secret');
  });
  it('adds no lead for an unmapped code', async () => {
    const r = await refuse('UNKNOWN_REFUSAL');
    expect(r.status).toBe(500);
    for (const lead of new Set(Object.values(leads)))
      expect(r.data.customisationFailed.detail).not.toContain(lead);
    expect(JSON.stringify(r)).not.toContain('secret');
    expect(JSON.stringify(r)).not.toContain('Own server prose');
  });
});

// #1504 §10 (Riana): node(ref:) resolves a PK or a urn:node: ref on its own and
// ignores memoryRef, so those shapes could still show another readable node.
// Every customisation node read pins the ref to its memory with `loc:`, which
// the server reads as a loc inside memoryRef whatever the string looks like.
describe('every customisation node read is pinned to its memory (#1504 §10)', () => {
  const listed = () => [
    app,
    { installMemory: { id: 'install', urn: null } },
    { memoryNodes: { nodes: [], total: 0 } },
  ];
  it.each([
    '0123456789abcdef0123456789abcdef',
    'cjld2cjxh0000qzrmn831i7rn',
    'urn:node:acme.com:other:secret',
    'loc:x',
    'x',
  ])('demand reads send ref loc:%s', async (loc) => {
    const c = client([...listed(), { node: null }, { node: null }]);
    await readCustomisation(c as never, context, 0, loc);
    expect(c.request.mock.calls.slice(3).map((call: unknown[]) => call[1])).toEqual([
      { memoryRef: 'install', ref: `loc:${loc}` },
      { memoryRef: 'original', ref: `loc:${loc}` },
    ]);
  });
  it.each(['0123456789abcdef0123456789abcdef', 'urn:node:acme.com:other:secret', 'x'])(
    'the save door pre-read sends ref loc:%s',
    async (loc) => {
      const c = client([{ installMemory: { id: 'install' } }, { node: { role: null, isRunnable: false } }, {}]);
      const fd = new FormData();
      for (const [k, v] of Object.entries({ agentRef: 'agent-a', loc, content: 'new', baseContent: 'old', expectedRevision: '7' }))
        fd.set(k, v);
      await writeCustomisation(c as never, 'app-a', fd, false);
      expect(c.request.mock.calls[1]?.[1]).toEqual({ memoryRef: 'install', ref: `loc:${loc}` });
      // The write itself still addresses the literal loc.
      expect(c.request.mock.calls[2]?.[1]).toMatchObject({ input: { loc } });
    },
  );
});

describe('stale save target is not malformed input (#1370)', () => {
  const valid = () => {
    const fd = new FormData();
    for (const [k, v] of Object.entries({
      agentRef: 'agent-a',
      loc: 'x',
      content: 'new',
      baseContent: 'old',
      expectedRevision: '7',
    }))
      fd.set(k, v);
    return fd;
  };
  const unavailable = {
    status: 409,
    data: { customisationFailed: { code: 'unavailable' } },
  };
  const isMutation = (call: unknown[]) => /mutation/i.test(String(call[0]));

  it('a valid draft whose install memory vanished gets changed-target guidance, no write', async () => {
    const c = client([{ installMemory: null }]);
    const r = await writeCustomisation(c as never, 'app-a', valid(), false);
    expect(r).toMatchObject(unavailable);
    expect(c.request).toHaveBeenCalledTimes(1);
    expect(c.request.mock.calls.some(isMutation)).toBe(false);
  });

  it('a valid draft whose replacement vanished gets changed-target guidance, no write', async () => {
    const c = client([{ installMemory: { id: 'install' } }, { node: null }]);
    const r = await writeCustomisation(c as never, 'app-a', valid(), false);
    expect(r).toMatchObject(unavailable);
    expect(c.request).toHaveBeenCalledTimes(2);
    expect(c.request.mock.calls.some(isMutation)).toBe(false);
  });

  it('says the same thing whether the install or the replacement is gone (deleted, hidden or foreign alike)', async () => {
    const gone = await writeCustomisation(
      client([{ installMemory: null }]) as never, 'app-a', valid(), false,
    );
    const hidden = await writeCustomisation(
      client([{ installMemory: { id: 'install' } }, { node: null }]) as never, 'app-a', valid(), false,
    );
    expect(hidden).toEqual(gone);
  });

  it('guides to Reload, keeps the draft, and does not blame the input', async () => {
    const r = (await writeCustomisation(
      client([{ installMemory: null }]) as never, 'app-a', valid(), false,
    )) as { data: { customisationFailed: { detail: string } } };
    const detail = r.data.customisationFailed.detail;
    expect(detail).toMatch(/no longer available/i);
    expect(detail).toMatch(/draft is kept/i);
    expect(detail).toMatch(/reload/i);
    expect(detail).not.toMatch(/bare loc|revision you opened/i);
  });

  it('keeps malformed fields invalid (negative control): no request, invalid guidance', async () => {
    const fd = valid();
    fd.delete('expectedRevision');
    const c = client([]);
    expect(await writeCustomisation(c as never, 'app-a', fd, false)).toMatchObject({
      status: 400,
      data: { customisationFailed: { code: 'invalid' } },
    });
    expect(c.request).not.toHaveBeenCalled();
  });

  it.each([
    ['install reread', [new Error('socket hang up')]],
    ['replacement reread', [{ installMemory: { id: 'install' } }, new Error('socket hang up')]],
  ])('keeps an infrastructure failure on the %s a failure, not stale guidance', async (_k, results) => {
    const c = client([...results]);
    const r = await writeCustomisation(c as never, 'app-a', valid(), false);
    expect(r).toMatchObject({ status: 500, data: { customisationFailed: { code: 'failed' } } });
    expect(c.request.mock.calls.some(isMutation)).toBe(false);
  });
});
