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
