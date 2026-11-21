import { describe, expect, it, vi } from "vitest";
import { readGrantPage } from "./app-grants";
import { fixtureActions } from "../../routes/app/apps/[appId]/grants/grants.fixture";

// #2073 read budget, measure-only: the identity-enrichment GraphQL request count
// for one 20-row page. No timing threshold, no batching (the issue forbids both).
const row = (i: number, holder: string, node: string) => ({
  id: `g${i}`, appId: "app", action: "schedule.create", holderKind: "WORKER",
  holderId: holder, values: { entryNode: node }, reason: "r", startsAt: null,
  expiresAt: null, maxUses: null, useCount: 0, createdAt: "2026-01-01T00:00:00Z",
  activatedAt: null, revokedAt: null, holderDepartedAt: null, allows: false,
});
function stub(items: ReturnType<typeof row>[]) {
  const seen: string[] = [];
  const request = vi.fn(async (q: string, v: { ref?: string }) => {
    if (q.includes("query AppGrantsPage")) return { appGrants: { items, total: items.length } };
    if (q.includes("query AppGrantActions")) return { grantActions: { items: fixtureActions, total: 4 } };
    seen.push(q.match(/query (\w+)/)![1]);
    if (q.includes("GrantSubjectNode")) return { node: { id: v.ref, name: v.ref, urn: "u" } };
    return { worker: { id: v.ref, name: v.ref, urn: "u" } };
  });
  return { request, seen };
}
const count = (seen: string[], name: string) => seen.filter((n) => n === name).length;

describe("grant page identity-enrichment read budget", () => {
  it("20 distinct holders and nodes: at most 20 holder and 20 node reads", async () => {
    const { request, seen } = stub(Array.from({ length: 20 }, (_, i) => row(i, `w${i}`, `n${i}`)));
    await readGrantPage({ request } as never, "app", 0);
    expect(count(seen, "GrantSubjectNode")).toBe(20);
    expect(count(seen, "GrantHolderWorker") + count(seen, "GrantHolder")).toBeLessThanOrEqual(20);
    expect(seen.length).toBeLessThanOrEqual(40);
  });
  it("duplicate-ref control: 20 rows sharing one holder and one node read each once", async () => {
    const { request, seen } = stub(Array.from({ length: 20 }, (_, i) => row(i, "w0", "n0")));
    await readGrantPage({ request } as never, "app", 0);
    expect(count(seen, "GrantSubjectNode")).toBe(1);
    expect(seen.length).toBe(2);
  });
});
