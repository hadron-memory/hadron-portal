/**
 * The contract between this portal and a build-time extension (#2566, C1).
 * See README.md in this directory.
 */

export interface ExtTab {
  id: string;
  label: string;
  href: string;
  match?: 'exact' | 'prefix';
}

export interface OrgTabContext {
  orgId: string;
  basePath: string;
  viewerOrgRole: string | null;
}

export interface AccountTabContext {
  basePath: string;
}

export interface ExtCommand {
  id: string;
  label: string;
  /** Lowercase words the command bar matches on; the first is the canonical one. */
  triggers: string[];
  desc: string;
  href: (ctx: { activeOrgId: string | null }) => string | null;
}

export interface LimitActionContext {
  limitKey: string;
  ownerType: 'organization' | 'user';
  callerCanManageOwner: boolean;
  ownerId: string | null;
}

export interface PortalExtension {
  /** Lowercase slug; equals its directory name under src/lib/ext/. */
  id: string;
  orgTabs?(ctx: OrgTabContext): ExtTab[];
  accountTabs?(ctx: AccountTabContext): ExtTab[];
  commands?: ExtCommand[];
  /** A link shown beside a limit-reached message. */
  limitAction?(ctx: LimitActionContext): { label: string; href: string } | null;
}
