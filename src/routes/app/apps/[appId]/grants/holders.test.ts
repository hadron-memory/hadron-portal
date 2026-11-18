import { describe, expect, it, vi } from "vitest";
import { grantHolders } from "$lib/server/app-grants";
import { grantHolderKey, type Grant } from "$lib/grants/types";
import { fixtureGrant } from "./grants.fixture";
const error = (code: string) => ({
  response: { errors: [{ message: "suppressed", extensions: { code } }] },
});
const userGrant = (departed: string | null): Grant => ({
  ...fixtureGrant,
  holderKind: "USER",
  holderId: "person-example",
  holderDepartedAt: departed,
});
const readAs = (value: unknown) =>
  ({ request: vi.fn().mockResolvedValue(value) }) as never;
const rejectAs = (e: unknown) =>
  ({ request: vi.fn().mockRejectedValue(e) }) as never;
const nameOf = async (c: never, grant: Grant) =>
  (await grantHolders(c, [grant]))[grantHolderKey(grant)].name;
describe("grant holder projections", () => {
  it("uses the deleted-worker wording only for a known miss, not an outage", async () => {
    const request = vi.fn().mockRejectedValue(error("WORKER_NOT_FOUND"));
    const c = { request } as never;
    expect(
      (await grantHolders(c, [fixtureGrant]))["WORKER:worker-example"].name,
    ).toBe("a deleted worker");
    request.mockRejectedValue(Error("offline"));
    expect(
      (await grantHolders(c, [fixtureGrant]))["WORKER:worker-example"].name,
    ).toBe("Holder unavailable");
  });
  it("labels a departed person neutrally, and never as deleted", async () => {
    expect(await nameOf(readAs({ user: null }), userGrant("2026-11-12T10:00:00Z"))).toBe(
      "a departed person",
    );
    expect(await nameOf(readAs({ user: null }), userGrant(null))).toBe(
      "Holder unavailable",
    );
  });
  it("keeps an outage an outage: a departed person whose identity read throws is unavailable, not departed", async () => {
    expect(
      await nameOf(rejectAs(Error("offline")), userGrant("2026-11-12T10:00:00Z")),
    ).toBe("Holder unavailable");
  });
  // The server has no typed user-not-found error: user(ref:) returns null for
  // a missing or unreadable user (schema: "denied and missing are
  // indistinguishable"), so the null-return tests above are the real
  // deleted-user path. Any thrown error — whatever its GraphQL code — is an
  // outage, and no error code may reach the departed wording for a USER.
  // WORKER_NOT_FOUND below is a real server code, chosen deliberately: the
  // holder kind does not match it, so kind+code must both line up before any
  // wording is claimed.
  it("treats an identity-read error as unavailable, not departed, whatever the error code", async () => {
    expect(
      await nameOf(rejectAs(error("WORKER_NOT_FOUND")), userGrant("2026-11-12T10:00:00Z")),
    ).toBe("Holder unavailable");
    expect(
      await nameOf(rejectAs(error("WORKER_NOT_FOUND")), userGrant(null)),
    ).toBe("Holder unavailable");
  });
  it("prefers a readable name or handle over any fallback, departed or not", async () => {
    const named = { id: "person-example", name: "Former colleague", urn: "hrn:user:example.test:person" };
    expect(
      await nameOf(readAs({ user: named }), userGrant("2026-11-12T10:00:00Z")),
    ).toBe("Former colleague");
    expect(await nameOf(readAs({ user: named }), userGrant(null))).toBe(
      "Former colleague",
    );
    const handled = { id: "person-example", name: null, handle: "former-handle", urn: "hrn:user:example.test:person" };
    expect(
      await nameOf(readAs({ user: handled }), userGrant("2026-11-12T10:00:00Z")),
    ).toBe("former-handle");
  });
  it("keeps the success-object-without-name-and-handle boundary on the fallback expression", async () => {
    const bare = { id: "person-example", name: null, handle: null, urn: "hrn:user:example.test:person" };
    expect(
      await nameOf(readAs({ user: bare }), userGrant("2026-11-12T10:00:00Z")),
    ).toBe("a departed person");
    expect(await nameOf(readAs({ user: bare }), userGrant(null))).toBe(
      "Holder unavailable",
    );
  });
  it("keeps a departure fact from relabelling worker, agent and app holders", async () => {
    expect(
      await nameOf(readAs({ worker: null }), {
        ...fixtureGrant,
        holderDepartedAt: "2026-11-12T10:00:00Z",
      }),
    ).toBe("a deleted worker");
    expect(
      await nameOf(readAs({ agent: null }), {
        ...fixtureGrant,
        holderKind: "AGENT" as const,
        holderDepartedAt: "2026-11-12T10:00:00Z",
      }),
    ).toBe("Agent");
    expect(
      await nameOf(readAs({ app: null }), {
        ...fixtureGrant,
        holderKind: "APP" as const,
        holderDepartedAt: "2026-11-12T10:00:00Z",
      }),
    ).toBe("App");
  });
  it("reads an agent and app name when the holder is readable", async () => {
    expect(
      await nameOf(readAs({ agent: { id: "agent-example", name: "Docs agent", urn: "hrn:agent:example.test:docs" } }), {
        ...fixtureGrant,
        holderKind: "AGENT" as const,
      }),
    ).toBe("Docs agent");
    expect(
      await nameOf(readAs({ app: { id: "app-example", name: "Docs app", urn: "hrn:app:example.test:docs" } }), {
        ...fixtureGrant,
        holderKind: "APP" as const,
      }),
    ).toBe("Docs app");
  });
  it("keeps a readable holder name and URN even when the grant has a departure fact", async () => {
    const worker = {
      id: fixtureGrant.holderId,
      name: "Historical worker",
      urn: "hrn:worker:example.test:team:historical",
    };
    const c = { request: vi.fn().mockResolvedValue({ worker }) } as never;
    expect(
      (
        await grantHolders(c, [
          { ...fixtureGrant, holderDepartedAt: "2026-11-12T10:00:00Z" },
        ])
      )["WORKER:worker-example"],
    ).toEqual(worker);
  });
});
