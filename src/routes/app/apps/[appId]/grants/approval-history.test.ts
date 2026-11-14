import { fixtureActions } from "./grants.fixture";
import { describe, it, expect, vi } from "vitest";
import { render } from "svelte/server";
import {
  grantActors,
  grantHolders,
  readGrantPage,
} from "$lib/server/app-grants";
import {
  grantMatches,
  grantPending,
  grantSignable,
} from "$lib/grants/approval";
import History from "./GrantHistory.svelte";
import { fixtureGrant } from "./grants.fixture";
const grant = {
  ...fixtureGrant,
  requestedByUserId: "person-one",
  requestedByWorkerId: "worker-example",
  issuerUserId: "person-one",
  verifiedBy: "person-one",
  revokedByUserId: "person-one",
  activatedAt: "2026-11-12T11:00:00Z",
};
describe("grant approval history identities and facts", () => {
  it("shows one person URN with all their roles, and labels the requester separately", () => {
    const html = render(History, {
      props: {
        grant,
        actors: {
          "USER:person-one": {
            id: "person-one",
            name: "Signer",
            urn: "hrn:user:signer",
          },
          "WORKER:worker-example": {
            id: "worker-example",
            name: "Requester",
            urn: "hrn:worker:example.test:team:requester",
          },
        },
      },
    }).body;
    expect(html).toContain("Approved on");
    expect(html).toContain(
      "Requested by person / Approved by / Verified by / Revoked by",
    );
    expect(html).toContain("Requested by worker");
    expect(html).toContain("Not in effect");
    expect(html.match(/title="hrn:user:signer"/g)).toHaveLength(1);
    expect(html).not.toMatch(/>\s*(Spent|Departed|Withdrawn)\s*</);
  });
  it("falls back to the recorded id on missing or failed identity reads without asserting deletion", async () => {
    const client = {
      request: vi
        .fn()
        .mockResolvedValue({ user: null })
        .mockRejectedValueOnce(Error("private")),
    };
    const actors = await grantActors(client as never, [grant]);
    expect(actors["USER:person-one"]).toEqual({
      id: "person-one",
      name: "person-one",
    });
    const html = render(History, { props: { grant, actors } }).body;
    expect(html).toContain("person-one");
    expect(html).not.toContain("deleted");
    expect(html).not.toContain("private");
  });
  it("shares raw reads across holder and repeated requester/issuer/verifier/revoker roles while preserving per-grant fallbacks", async () => {
    const person = { id: "person-one", name: "Signer", urn: "hrn:user:signer" };
    const worker = {
      id: "worker-example",
      name: "Worker",
      urn: "hrn:worker:example.test:team:worker",
    };
    const request = vi.fn(async (q: string) => {
      if (q.includes("query AppGrantActions")) return { grantActions: { items: fixtureActions, total: fixtureActions.length } };
    if (q.includes("query AppGrantsPage"))
        return {
          appGrants: { items: [grant, { ...grant, id: "second" }], total: 2 },
        };
      if (q.includes("query GrantHolderUser")) return { user: person };
      if (q.includes("query GrantHolderWorker")) return { worker };
      if (q.includes("query GrantSubjectNode")) return { node: null };
      throw Error("unexpected");
    });
    const r = await readGrantPage({ request } as never, "app-example", 0);
    expect(r.actors?.["USER:person-one"]).toEqual(person);
    expect(
      request.mock.calls.filter(([q]) => q.includes("query GrantHolderUser")),
    ).toHaveLength(1);
    expect(
      request.mock.calls.filter(([q]) => q.includes("query GrantHolderWorker")),
    ).toHaveLength(1);
  });
  it("uses issuer identity only for the by-me filter, not requestedBy or verifiedBy", () => {
    expect(
      grantMatches(
        {
          ...grant,
          issuerUserId: "other",
          requestedByUserId: "me",
          verifiedBy: "me",
        },
        "mine",
        "me",
      ),
    ).toBe(false);
    expect(grantMatches({ ...grant, issuerUserId: "me" }, "mine", "me")).toBe(
      true,
    );
    expect(grantMatches({ ...grant, issuerUserId: null }, "mine", null)).toBe(
      false,
    );
  });
  it("keeps an expired unended grant pending but not signable, and allows pre-start signing", () => {
    const expired = { ...fixtureGrant, expiresAt: "2026-11-11T00:00:00Z" };
    expect(grantPending(expired)).toBe(true);
    expect(grantSignable(expired, Date.parse("2026-11-12T00:00:00Z"))).toBe(
      false,
    );
    expect(
      grantSignable(
        { ...fixtureGrant, startsAt: "2026-12-01T00:00:00Z" },
        Date.parse("2026-11-12T00:00:00Z"),
      ),
    ).toBe(true);
  });
});
