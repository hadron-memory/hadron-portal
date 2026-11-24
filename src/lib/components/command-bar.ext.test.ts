/**
 * Extension commands in the command bar (C2, #2568). A separate file so
 * command-bar.test.ts keeps the real registry; each case mocks it afresh and
 * re-imports the module, because the merge runs at module load.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ExtCommand } from '$lib/ext/types';

const base = { desc: 'd' };
const fixture: ExtCommand = {
  ...base,
  id: 'fx',
  label: 'Fixture',
  triggers: ['fixture'],
  href: ({ activeOrgId }) => (activeOrgId ? `/app/orgs/${activeOrgId}/fx` : null),
};

async function load(cmds: ExtCommand[]) {
  vi.resetModules();
  vi.doMock('$lib/ext/registry', async (orig) => ({
    ...(await orig<typeof import('$lib/ext/registry')>()),
    extensionCommands: () => cmds,
  }));
  return import('./command-bar');
}

afterEach(() => vi.doUnmock('$lib/ext/registry'));

const ctx = (activeOrgId: string | null) => ({ activeOrgId, resolve: async () => null });

describe('extension commands (C2, #2568)', () => {
  it('finds a fixture command by its trigger and navigates to its path', async () => {
    const m = await load([fixture]);
    expect(m.parseCommand('fix').matches.map((c) => c.id)).toContain('fx');
    const cmd = m.parseCommand('fixture').command!;
    expect(cmd.id).toBe('fx');
    expect(await m.resolveCommandAction(cmd, '', ctx('o1'))).toEqual({ type: 'navigate', path: '/app/orgs/o1/fx' });
  });

  it('shows the existing no-organization error when href returns null', async () => {
    const m = await load([fixture]);
    expect(await m.resolveCommandAction(m.parseCommand('fixture').command!, '', ctx(null))).toEqual({
      type: 'error',
      message: 'No active organization yet.',
    });
  });

  it.each(['https://evil.example/x', '//evil.example/x', 'app/x'])(
    'refuses a non-internal href %s with the unknown-command error (C2-R2)',
    async (href) => {
      const m = await load([{ ...fixture, href: () => href }]);
      const r = await m.resolveCommandAction(m.parseCommand('fixture').command!, '', ctx('o1'));
      expect(r).toEqual({ type: 'error', message: 'Don\'t know how to run "Fixture".' });
    },
  );

  it('sits after the built-ins (C2-R3)', async () => {
    const m = await load([fixture]);
    expect(m.COMMANDS.at(-1)?.id).toBe('fx');
    expect(m.COMMANDS).toHaveLength(m.BUILTIN_COMMANDS.length + 1);
  });

  it('fails at module load when an id equals a built-in id', async () => {
    await expect(load([{ ...fixture, id: 'open' }])).rejects.toThrow(/open/);
  });

  it('fails at module load when a trigger equals a built-in trigger', async () => {
    await expect(load([{ ...fixture, triggers: ['account'] }])).rejects.toThrow(/account/);
  });

  it('mergeCommands: a non-clashing command is appended, a clashing one throws', async () => {
    const m = await load([]);
    expect(m.mergeCommands(m.BUILTIN_COMMANDS, [fixture]).commands.at(-1)?.title).toBe('Fixture');
    expect(() => m.mergeCommands(m.BUILTIN_COMMANDS, [{ ...fixture, id: 'open' }])).toThrow();
    expect(() => m.mergeCommands(m.BUILTIN_COMMANDS, [{ ...fixture, triggers: ['sign out'] }])).toThrow();
  });

  it('with no extension the ids are today\'s 16, in order', async () => {
    const m = await load([]);
    expect(m.COMMANDS.map((c) => c.id)).toEqual(m.BUILTIN_COMMANDS.map((c) => c.id));
    expect(m.COMMANDS).toHaveLength(16);
  });
});
