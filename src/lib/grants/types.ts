import { t } from "$lib/i18n/t";
export const grantActions = {
  "schedule.create": "entryNode",
  "webhook.create": "entryNode",
  "bootprompt.source.edit": "sourceNode",
  "bootprompt.compile.approve": "compiledNode",
} as const;
export type GrantAction = keyof typeof grantActions;
export type Grant = {
  id: string;
  appId: string;
  action: string;
  holderKind: "USER" | "WORKER" | "AGENT" | "APP";
  holderId: string;
  values: unknown;
  reason: string;
  startsAt: string | null;
  expiresAt: string | null;
  maxUses: number | null;
  useCount: number;
  createdAt: string;
  activatedAt: string | null;
  revokedAt: string | null;
  holderDepartedAt: string | null;
  allows: boolean;
};
export type Holder = { id: string; name: string; urn?: string | null };
export function grantError(code: string | null): string {
  switch (code) {
    case "GRANT_NOT_MANAGER":
      return t(
        "grants.error.manager",
        "Only a manager of this App can manage its grants.",
      );
    case "GRANT_NOT_FOUND":
      return t("grants.error.missing", "That grant is unavailable.");
    case "GRANT_HOLDER_NOT_ALLOWED":
      return t(
        "grants.error.holder",
        "Choose a worker of this App or an agent installed in it.",
      );
    case "GRANT_ACTION_UNKNOWN":
      return t(
        "grants.error.action",
        "That action is unavailable. Choose another action.",
      );
    case "GRANT_VALUES_INVALID":
      return t("grants.error.values", "Choose a valid node for this action.");
    case "GRANT_TERMS_INVALID":
      return t("grants.error.terms", "Check the reason, dates and use limit.");
    default:
      return t(
        "grants.error.generic",
        "The grant request could not be completed. Refresh before trying again.",
      );
  }
}

// Only the known single-node value shapes are projected as node identities.
// Opaque, wildcard and multi-value grants keep their exact values instead.
export function grantNodeRef(grant: Grant): string | null {
  if (
    !Object.hasOwn(grantActions, grant.action) ||
    !grant.values ||
    typeof grant.values !== "object" ||
    Array.isArray(grant.values)
  )
    return null;
  const value = (grant.values as Record<string, unknown>)[
    grantActions[grant.action as GrantAction]
  ];
  return typeof value === "string" &&
    value !== "*" &&
    value.length > 0 &&
    !/[\s,]/.test(value)
    ? value
    : null;
}

export const GRANT_REASON_MAX = 2000;
export function grantReasonLimitMessage(): string {
  return t(
    "grants.reason.limit",
    "Use at most {max} characters for the reason.",
    { max: String(GRANT_REASON_MAX) },
  );
}

// Missing USER wording depends on THIS grant's first-end stamp, not another
// grant for the same person. Identity reads may still be deduplicated.
export function grantHolderKey(grant: Grant): string {
  return grant.holderKind === "USER"
    ? `USER:${grant.holderId}:${grant.id}`
    : `${grant.holderKind}:${grant.holderId}`;
}
