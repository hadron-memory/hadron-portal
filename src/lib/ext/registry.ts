import type {
  AccountTabContext,
  ExtCommand,
  ExtTab,
  LimitActionContext,
  OrgTabContext,
  PortalExtension,
} from './types';

/**
 * Build-time extension registry (#2566, C1).
 *
 * Collects `src/lib/ext/<id>/index.ts` modules. A build with no extension
 * directory yields an empty list and behaves exactly as it did before.
 *
 * This module imports only `./types`: the command bar will import it, so it
 * must not import the command bar. A clash with a built-in command is checked
 * where the two are merged, not here.
 */

type Entry = readonly [path: string, ext: PortalExtension];

/**
 * An extension's id is its directory name. `path` is the glob key, e.g.
 * `./alpha/index.ts`. Directory names are unique, so this also keeps ids unique;
 * `assertNoClashes` still checks the list a helper is handed.
 */
export function assertIdsMatchPaths(entries: readonly Entry[]): void {
  for (const [path, ext] of entries) {
    const dir = /^\.\/([^/]+)\/index\.ts$/.exec(path)?.[1];
    if (dir !== ext.id) {
      throw new Error(
        `Extension at ${path} has id "${ext.id}", but its id must equal its directory name${dir ? ` "${dir}"` : ''}.`,
      );
    }
  }
}

const found = import.meta.glob<{ default: PortalExtension }>('./*/index.ts', { eager: true });
const foundEntries = Object.entries(found)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, m]): Entry => [path, m.default]);
assertIdsMatchPaths(foundEntries);

export const installedExtensions: readonly PortalExtension[] = foundEntries.map(([, ext]) => ext);

function byId(exts: readonly PortalExtension[]): PortalExtension[] {
  return [...exts].sort((a, b) => a.id.localeCompare(b.id));
}

const NO_ORG_CTX = { orgId: '', basePath: '', viewerOrgRole: null } satisfies OrgTabContext;
const NO_ACCOUNT_CTX = { basePath: '' } satisfies AccountTabContext;

/**
 * Throws when two extensions share an extension id, a tab id, a tab href, a
 * command id or a command trigger, naming both. A build-time failure, never a
 * silent overwrite.
 *
 * Tabs are read with an empty context: which tabs exist, and where they point,
 * must not depend on who is looking.
 */
export function assertNoClashes(exts: readonly PortalExtension[]): void {
  const owners = new Map<string, string>();
  const claim = (kind: string, value: string, owner: string) => {
    const key = `${kind}\u0000${value}`;
    const first = owners.get(key);
    if (first !== undefined) {
      throw new Error(`Duplicate ${kind} "${value}" in extensions "${first}" and "${owner}".`);
    }
    owners.set(key, owner);
  };
  for (const ext of byId(exts)) {
    claim('extension id', ext.id, ext.id);
    const tabs = [...(ext.orgTabs?.(NO_ORG_CTX) ?? []), ...(ext.accountTabs?.(NO_ACCOUNT_CTX) ?? [])];
    for (const t of tabs) {
      claim('tab id', t.id, ext.id);
      claim('tab href', t.href, ext.id);
    }
    for (const c of ext.commands ?? []) {
      claim('command id', c.id, ext.id);
      for (const trigger of c.triggers) claim('command trigger', trigger, ext.id);
    }
  }
}

assertNoClashes(installedExtensions);

export function extensionOrgTabs(ctx: OrgTabContext, exts: readonly PortalExtension[] = installedExtensions): ExtTab[] {
  assertNoClashes(exts);
  return byId(exts).flatMap((e) => e.orgTabs?.(ctx) ?? []);
}

export function extensionAccountTabs(
  ctx: AccountTabContext,
  exts: readonly PortalExtension[] = installedExtensions,
): ExtTab[] {
  assertNoClashes(exts);
  return byId(exts).flatMap((e) => e.accountTabs?.(ctx) ?? []);
}

export function extensionCommands(exts: readonly PortalExtension[] = installedExtensions): ExtCommand[] {
  assertNoClashes(exts);
  return byId(exts).flatMap((e) => e.commands ?? []);
}

/** The first non-null result, in extension id order. */
export function extensionLimitAction(
  ctx: LimitActionContext,
  exts: readonly PortalExtension[] = installedExtensions,
): { label: string; href: string } | null {
  for (const e of byId(exts)) {
    const action = e.limitAction?.(ctx) ?? null;
    if (action) return action;
  }
  return null;
}
