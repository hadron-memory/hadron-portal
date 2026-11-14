import { fixtureActions } from "./grants.fixture";
import { describe, expect, it, vi } from "vitest";
import { grantNodes } from "$lib/server/app-grants";
import { grantNodeRef } from "$lib/grants/types";
import { fixtureGrant } from "./grants.fixture";
describe("grant node context", () => {
  it("resolves only the known single-node scopes, once per ref", async () => {
    const node = {
      id: "node-example",
      name: "Daily entry",
      urn: "hrn:node:example.test:knowledge:daily",
    };
    const request = vi.fn().mockResolvedValue({ node });
    expect(
      await grantNodes({ request } as never, [fixtureGrant, fixtureGrant], fixtureActions),
    ).toEqual({ "node-example": node });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toEqual({ ref: "node-example" });
    for (const values of [
      { entryNode: "*" },
      { entryNode: ["one", "two"] },
      null,
    ])
      expect(grantNodeRef({ ...fixtureGrant, values }, fixtureActions)).toBeNull();
    expect(
      grantNodeRef({ ...fixtureGrant, action: "future.action" }, fixtureActions),
    ).toBeNull();
  });
  it("does not invent identity or disclose refusal text for unreadable nodes", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({ node: null })
      .mockRejectedValueOnce(Error("private content"));
    expect(await grantNodes({ request } as never, [fixtureGrant], fixtureActions)).toEqual({
      "node-example": null,
    });
    expect(await grantNodes({ request } as never, [fixtureGrant], fixtureActions)).toEqual({
      "node-example": null,
    });
  });
  it("never expands a page into more than twenty identity reads", async () => {
    const request = vi.fn().mockResolvedValue({ node: null });
    await grantNodes(
      { request } as never,
      Array.from({ length: 21 }, (_, i) => ({
        ...fixtureGrant,
        values: { entryNode: `node-${i}` },
      })),
      fixtureActions,
    );
    expect(request).toHaveBeenCalledTimes(20);
  });
});
