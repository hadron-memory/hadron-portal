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
