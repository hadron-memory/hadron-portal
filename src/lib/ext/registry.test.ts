import { describe, expect, it } from 'vitest';
import {
  assertIdsMatchPaths,
  assertNoClashes,
  extensionAccountTabs,
  extensionCommands,
  extensionLimitAction,
  extensionOrgTabs,
} from './registry';
import type { ExtCommand, LimitActionContext, OrgTabContext, PortalExtension } from './types';

/**
 * #2566 (C1) — the extension registry.
 *
 * Every call passes `exts` explicitly. In a tree where a private overlay is
 * composed in, the default list is not empty, and that overlay runs this file
 * too: a test that read `installedExtensions` would pass in the public tree and
 * fail there. Whether the public tree HAS no extension belongs to the guard and
 * the build comparison, not to a unit test.
 */

const orgCtx: OrgTabContext = { orgId: 'o1', basePath: '/app/orgs/o1', viewerOrgRole: 'ADMIN' };
const limitCtx: LimitActionContext = {
  limitKey: 'memories',
  ownerType: 'organization',
  callerCanManageOwner: true,
  ownerId: 'o1',
};

function cmd(id: string, trigger: string): ExtCommand {
  return { id, label: id, triggers: [trigger], desc: id, href: () => '/x' };
}

const zeta: PortalExtension = {
  id: 'zeta',
  orgTabs: () => [
    { id: 'z-b', label: 'Z second', href: '/z/b' },
    { id: 'z-a', label: 'Z first', href: '/z/a' },
  ],
  accountTabs: () => [{ id: 'z-acct', label: 'Z', href: '/z/acct' }],
  commands: [cmd('z-two', 'zebra'), cmd('z-one', 'zed')],
};
const alpha: PortalExtension = {
  id: 'alpha',
  orgTabs: () => [{ id: 'a-1', label: 'A', href: '/a/1' }],
  accountTabs: () => [{ id: 'a-acct', label: 'A', href: '/a/acct' }],
  commands: [cmd('a-one', 'apple')],
};

describe('with no extension', () => {
  it('every helper returns empty or null', () => {
    expect(extensionOrgTabs(orgCtx, [])).toEqual([]);
    expect(extensionAccountTabs({ basePath: '/app/account' }, [])).toEqual([]);
    expect(extensionCommands([])).toEqual([]);
    expect(extensionLimitAction(limitCtx, [])).toBeNull();
  });
});

describe('ordering', () => {
  it('returns tabs in extension id order whatever order they are passed in, keeping each extension\'s own order', () => {
    expect(extensionOrgTabs(orgCtx, [zeta, alpha]).map((t) => t.id)).toEqual(['a-1', 'z-b', 'z-a']);
    expect(extensionOrgTabs(orgCtx, [alpha, zeta]).map((t) => t.id)).toEqual(['a-1', 'z-b', 'z-a']);
    expect(extensionAccountTabs({ basePath: '/b' }, [zeta, alpha]).map((t) => t.id)).toEqual(['a-acct', 'z-acct']);
  });

  it('returns commands in extension id order, keeping each extension\'s own order', () => {
    expect(extensionCommands([zeta, alpha]).map((c) => c.id)).toEqual(['a-one', 'z-two', 'z-one']);
  });

  it('does not reorder the array it was given', () => {
    const given = [zeta, alpha];
    extensionOrgTabs(orgCtx, given);
    expect(given.map((e) => e.id)).toEqual(['zeta', 'alpha']);
  });
});

describe('the context reaches the extension', () => {
  it('passes basePath and viewerOrgRole through', () => {
    const echo: PortalExtension = {
      id: 'echo',
      orgTabs: (ctx) => [{ id: 'e', label: String(ctx.viewerOrgRole), href: ctx.basePath + '/e' }],
    };
    expect(extensionOrgTabs(orgCtx, [echo])).toEqual([
      { id: 'e', label: 'ADMIN', href: '/app/orgs/o1/e' },
    ]);
  });
});

describe('clashes throw, naming both extensions', () => {
  const tab = (id: string, href: string) => ({ id, label: id, href });
  const withTabs = (id: string, ...tabs: ReturnType<typeof tab>[]): PortalExtension => ({
    id,
    orgTabs: () => tabs,
  });

  it('does not throw for two extensions that do not clash', () => {
    expect(() => assertNoClashes([zeta, alpha])).not.toThrow();
    expect(() => extensionOrgTabs(orgCtx, [zeta, alpha])).not.toThrow();
  });

  it('a duplicate tab href', () => {
    const exts = [withTabs('one', tab('t1', '/same')), withTabs('two', tab('t2', '/same'))];
    expect(() => extensionOrgTabs(orgCtx, exts)).toThrow(/href.*\/same.*one.*two/s);
    expect(() => assertNoClashes(exts)).toThrow(/\/same/);
  });

  it('a duplicate tab id', () => {
    const exts = [withTabs('one', tab('same', '/p')), withTabs('two', tab('same', '/q'))];
    expect(() => extensionOrgTabs(orgCtx, exts)).toThrow(/tab id.*same.*one.*two/s);
  });

  it('a duplicate command trigger', () => {
    const exts = [
      { id: 'one', commands: [cmd('c1', 'go')] },
      { id: 'two', commands: [cmd('c2', 'go')] },
    ];
    expect(() => extensionCommands(exts)).toThrow(/trigger.*go.*one.*two/s);
  });

  it('a duplicate command id', () => {
    const exts = [
      { id: 'one', commands: [cmd('same', 'a')] },
      { id: 'two', commands: [cmd('same', 'b')] },
    ];
    expect(() => extensionCommands(exts)).toThrow(/command id.*same.*one.*two/s);
  });

  it('a duplicate extension id', () => {
    expect(() => assertNoClashes([{ id: 'dup' }, { id: 'dup' }])).toThrow(/extension id.*dup/s);
  });
});

describe('extensionLimitAction', () => {
  it('returns the first non-null result in id order', () => {
    const first: PortalExtension = { id: 'aaa', limitAction: () => null };
    const second: PortalExtension = { id: 'bbb', limitAction: () => ({ label: 'Plans', href: '/plans' }) };
    expect(extensionLimitAction(limitCtx, [second, first])).toEqual({ label: 'Plans', href: '/plans' });
  });

  it('passes the context through', () => {
    const e: PortalExtension = {
      id: 'e',
      limitAction: (ctx) => ({ label: ctx.limitKey, href: `/${String(ctx.ownerId)}` }),
    };
    expect(extensionLimitAction(limitCtx, [e])).toEqual({ label: 'memories', href: '/o1' });
  });
});

describe('assertIdsMatchPaths', () => {
  it('passes when each id equals its directory name', () => {
    expect(() =>
      assertIdsMatchPaths([
        ['./alpha/index.ts', { id: 'alpha' }],
        ['./zeta/index.ts', { id: 'zeta' }],
      ]),
    ).not.toThrow();
  });

  it('throws naming the path and the id when they differ', () => {
    expect(() => assertIdsMatchPaths([['./alpha/index.ts', { id: 'beta' }]])).toThrow(/alpha.*beta/s);
  });

  it('throws on two entries claiming one id', () => {
    expect(() =>
      assertIdsMatchPaths([
        ['./one/index.ts', { id: 'one' }],
        ['./two/index.ts', { id: 'one' }],
      ]),
    ).toThrow();
  });
});
