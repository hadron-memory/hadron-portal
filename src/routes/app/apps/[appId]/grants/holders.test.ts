import { describe, expect, it, vi } from "vitest";
import { grantHolders } from "$lib/server/app-grants";
import { grantHolderKey } from "$lib/grants/types";
import { fixtureGrant } from "./grants.fixture";
const error = (code: string) => ({
  response: { errors: [{ message: "suppressed", extensions: { code } }] },
});
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
  it("does not turn a concealed live user into a deleted-user claim", async () => {
    const grant = {
      ...fixtureGrant,
      holderKind: "USER" as const,
      holderId: "person-example",
    };
    const c = { request: vi.fn().mockResolvedValue({ user: null }) } as never;
    expect((await grantHolders(c, [grant]))[grantHolderKey(grant)].name).toBe(
      "Holder unavailable",
    );
    expect(
      (
        await grantHolders(c, [
          { ...grant, holderDepartedAt: "2026-11-12T10:00:00Z" },
        ])
      )[grantHolderKey(grant)].name,
    ).toBe("a deleted user");
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
