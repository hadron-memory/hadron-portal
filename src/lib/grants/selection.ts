import type { Grant } from "./types";
import { grantExpired } from "./approval";

/**
 * The refusals a selection request or its withdrawal can answer that the page words from the
 * server's own text (hadron-server#5001; hrn:node:hadronmemory.com:specs:cor:acl:140:07). The page states no number of its own:
 * the cap lives in SELECTION_TOO_LARGE's message and `extensions.cap`.
 */
export const selectionRefusalCodes: readonly string[] = [
  "SELECTION_EMPTY",
  "SELECTION_TOO_LARGE",
  "SELECTION_DUPLICATE_GRANT",
  "SELECTION_MIXED_APPS",
  "GRANT_NOT_FOUND",
  "GRANT_NOT_PENDING",
  "GRANT_EXPIRED",
  "GRANT_TERMS_UNREPRESENTABLE",
  "FORBIDDEN",
];
export const withdrawRefusalCodes: readonly string[] = [
  "SIGNING_REQUEST_NOT_FOUND",
  "SIGNING_REQUEST_NOT_REQUESTER",
  "SIGNING_REQUEST_ENDED",
  "FORBIDDEN",
];

export type SelectionOutcome = {
  activated: number;
  pending: number;
  ended: number;
  /** Selected grants the fresh read did not return (another page): never guessed. */
  elsewhere: number;
};

/**
 * What became of the grants a person selected, read from a fresh list. Each grant activates or
 * fails on its own, so this counts each one and never says "all".
 */
export function selectionOutcome(refs: string[], items: Grant[], now: number): SelectionOutcome {
  const byId = new Map(items.map((g) => [g.id, g]));
  const out: SelectionOutcome = { activated: 0, pending: 0, ended: 0, elsewhere: 0 };
  for (const ref of new Set(refs)) {
    const g = byId.get(ref);
    if (!g) out.elsewhere++;
    else if (g.activatedAt) out.activated++;
    else if (g.revokedAt || g.holderDepartedAt || grantExpired(g, now)) out.ended++;
    else out.pending++;
  }
  return out;
}
