import type { Grant } from "./types";
import { t } from "$lib/i18n/t";
export type GrantPageFilter = "all" | "pending" | "mine";
export function grantPending(g: Grant): boolean {
  return (
    g.activatedAt === null &&
    g.revokedAt === null &&
    g.holderDepartedAt === null
  );
}
export function grantExpired(g: Grant, now: number): boolean {
  return g.expiresAt !== null && Date.parse(g.expiresAt) <= now;
}
export function grantSignable(g: Grant, now: number): boolean {
  return grantPending(g) && !grantExpired(g, now);
}
export function grantMatches(
  g: Grant,
  filter: GrantPageFilter,
  viewerId: string | null | undefined,
): boolean {
  return filter === "pending"
    ? grantPending(g)
    : filter === "mine"
      ? !!viewerId && g.issuerUserId === viewerId
      : true;
}
export function grantActorRefs(
  g: Grant,
): { kind: "USER" | "WORKER"; id: string; labels: string[] }[] {
  const refs = new Map<
    string,
    { kind: "USER" | "WORKER"; id: string; labels: string[] }
  >();
  const add = (
    kind: "USER" | "WORKER",
    id: string | null | undefined,
    label: string,
  ) => {
    if (!id) return;
    const key = kind + ":" + id;
    const held = refs.get(key);
    if (held) held.labels.push(label);
    else refs.set(key, { kind, id, labels: [label] });
  };
  add(
    "USER",
    g.requestedByUserId,
    t("grants.actor.requester-person", "Requested by person"),
  );
  add(
    "WORKER",
    g.requestedByWorkerId,
    t("grants.actor.requester-worker", "Requested by worker"),
  );
  add("USER", g.issuerUserId, t("grants.actor.issuer", "Approved by"));
  add("USER", g.verifiedBy, t("grants.actor.verifier", "Verified by"));
  add("USER", g.revokedByUserId, t("grants.actor.revoker", "Revoked by"));
  return [...refs.values()];
}
