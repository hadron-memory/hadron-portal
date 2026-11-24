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

/** Plain code-point order, so "id order" does not depend on ICU or the locale. */
function compareCodePoints(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

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
  .sort(([a], [b]) => compareCodePoints(a, b))
  .map(([path, m]): Entry => {
    if (!m.default) throw new Error(`Extension module ${path} has no default export; it must default-export a PortalExtension.`);
    return [path, m.default];
  });
assertIdsMatchPaths(foundEntries);

export const installedExtensions: readonly PortalExtension[] = foundEntries.map(([, ext]) => ext);

function byId(exts: readonly PortalExtension[]): PortalExtension[] {
  return [...exts].sort((a, b) => compareCodePoints(a.id, b.id));
}

const NO_ORG_CTX = { orgId: '', basePath: '', viewerOrgRole: null } satisfies OrgTabContext;
const NO_ACCOUNT_CTX = { basePath: '' } satisfies AccountTabContext;

/**
 * Throws when two extensions share an extension id, a tab id, a tab href, a
 * command id or a command trigger, naming both. A build-time failure, never a
 * silent overwrite.
 *
 * Tabs are read once with an empty context, so their ids and hrefs must not
 * depend on who is looking: a tab that varies by role or organization is judged
 * only by what it returns for no one. The README says so.
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
    if (!SLUG.test(ext.id)) throw new Error(`Extension id "${ext.id}" must be a lowercase slug (a-z, 0-9, hyphen).`);
    claim('extension id', ext.id, ext.id);
    // Org tabs and account tabs live on different pages, so each kind has its own
    // namespace: one extension may use one id (and one relative href) in both.
    for (const t of ext.orgTabs?.(NO_ORG_CTX) ?? []) {
      claim('org tab id', t.id, ext.id);
      claim('org tab href', t.href, ext.id);
    }
    for (const t of ext.accountTabs?.(NO_ACCOUNT_CTX) ?? []) {
      claim('account tab id', t.id, ext.id);
      claim('account tab href', t.href, ext.id);
    }
    for (const c of ext.commands ?? []) {
      claim('command id', c.id, ext.id);
      for (const trigger of c.triggers) {
        if (trigger !== trigger.toLowerCase()) throw new Error(`Command trigger "${trigger}" in extension "${ext.id}" must be lowercase.`);
        claim('command trigger', trigger, ext.id);
      }
    }
  }
}

assertNoClashes(installedExtensions);

/** `installedExtensions` was checked when this module loaded; check a list handed in. */
function checkSupplied(exts: readonly PortalExtension[]): void {
  if (exts !== installedExtensions) assertNoClashes(exts);
}

export function extensionOrgTabs(ctx: OrgTabContext, exts: readonly PortalExtension[] = installedExtensions): ExtTab[] {
  checkSupplied(exts);
  return byId(exts).flatMap((e) => e.orgTabs?.(ctx) ?? []);
}

export function extensionAccountTabs(
  ctx: AccountTabContext,
  exts: readonly PortalExtension[] = installedExtensions,
): ExtTab[] {
  checkSupplied(exts);
  return byId(exts).flatMap((e) => e.accountTabs?.(ctx) ?? []);
}

export function extensionCommands(exts: readonly PortalExtension[] = installedExtensions): ExtCommand[] {
  checkSupplied(exts);
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

/**
 * C2 (#2568, ruling C2-R1(a)): the layouts key their tab lists by tab id, and a
 * repeated key throws at render. So the tabs the layouts show carry the
 * extension's id in their own: `ext:<extId>:<tabId>`. An extension tab named
 * `profile` then sits beside the built-in Profile tab instead of taking down
 * every org page. An extension id is a slug without ':', so the id parses back
 * unambiguously at its first two colons. C1's four helpers above are unchanged
 * and return the raw ids; the layouts call these.
 */
function namespaced(exts: readonly PortalExtension[], read: (e: PortalExtension) => ExtTab[] | undefined): ExtTab[] {
  return byId(exts).flatMap((e) => (read(e) ?? []).map((tab) => ({ ...tab, id: `ext:${e.id}:${tab.id}` })));
}

export function extensionOrgNavTabs(ctx: OrgTabContext, exts: readonly PortalExtension[] = installedExtensions): ExtTab[] {
  checkSupplied(exts);
  return namespaced(exts, (e) => e.orgTabs?.(ctx));
}

export function extensionAccountNavTabs(
  ctx: AccountTabContext,
  exts: readonly PortalExtension[] = installedExtensions,
): ExtTab[] {
  checkSupplied(exts);
  return namespaced(exts, (e) => e.accountTabs?.(ctx));
}
