import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseGrantList,
  readGrantList,
  GRANT_READ_TIMEOUT_MS,
} from "./grant-list";
import { grantsFixture } from "./grants.fixture";
const scope = {
  appId: "app-example",
  viewerId: "person-example",
  routeRef: "hrn:app:example.test:team",
  offset: 0,
};
const body = () => {
  const d = grantsFixture();
  return {
    appId: scope.appId,
    viewerId: scope.viewerId,
    offset: 0,
    actionDefinitions: d.actionDefinitions,
    actionDefinitionsFailed: false,
    grants: d.grants,
    holders: d.holders,
    nodes: { "node-example": null },
  };
};
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it('rejects an old or malformed payload instead of silently replacing missing metadata with []', () => {
  const payload = body() as any;
  delete payload.actionDefinitions;
  expect(parseGrantList(payload, scope)).toBeNull();
});
describe("owned Grants read", () => {
  it("accepts legal count lag and uses no-store JSON at the exact route scope", async () => {
    const payload = body();
    payload.grants.total = 0;
    const fetcher = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetcher);
    expect((await readGrantList(scope))?.grants.items).toHaveLength(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "/app/apps/hrn%3Aapp%3Aexample.test%3Ateam/grants/list?offset=0",
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  });
  it.each([
    "viewer",
    "app",
    "offset",
    "grant-app",
    "missing-stamp",
    "allows",
    "holder",
    "node",
    "duplicate",
    "too-many",
  ])("refuses a malformed or foreign %s payload", (kind) => {
    const b: any = body();
    if (kind === "viewer") b.viewerId = "other";
    if (kind === "app") b.appId = "other";
    if (kind === "offset") b.offset = 20;
    if (kind === "grant-app")
      b.grants.items = [{ ...b.grants.items[0], appId: "other" }];
    if (kind === "missing-stamp") {
      b.grants.items = [{ ...b.grants.items[0] }];
      delete b.grants.items[0].revokedAt;
    }
    if (kind === "allows")
      b.grants.items = [{ ...b.grants.items[0], allows: "false" }];
    if (kind === "holder") b.holders = {};
    if (kind === "node") b.nodes = { "node-example": { name: "missing id" } };
    if (kind === "duplicate")
      b.grants.items = [b.grants.items[0], b.grants.items[0]];
    if (kind === "too-many")
      b.grants.items = Array.from({ length: 21 }, () => b.grants.items[0]);
    expect(parseGrantList(b, scope)).toBeNull();
  });
  it.each(["HTTP", "JSON", "rejection"])(
    "contains a %s failure without throwing",
    async (kind) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          kind === "rejection"
            ? () => Promise.reject(Error("private"))
            : async () => ({
                ok: kind !== "HTTP",
                json: async () => {
                  throw Error("malformed");
                },
              }),
        ),
      );
      expect(await readGrantList(scope)).toBeNull();
    },
  );
  it.each(["fetch", "JSON"])(
    "bounds a hung %s stage and aborts it",
    async (stage) => {
      vi.useFakeTimers();
      let signal: AbortSignal;
      vi.stubGlobal(
        "fetch",
        vi.fn((_u, opts) => {
          signal = opts.signal;
          return stage === "fetch"
            ? new Promise(() => {})
            : Promise.resolve({ ok: true, json: () => new Promise(() => {}) });
        }),
      );
      const read = readGrantList(scope);
      await vi.advanceTimersByTimeAsync(GRANT_READ_TIMEOUT_MS);
      expect(await read).toBeNull();
      expect(signal!.aborted).toBe(true);
    },
  );
  it("honours external cancellation even when fetch resolves late", async () => {
    const controller = new AbortController();
    let resolve!: (v: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((r) => (resolve = r))),
    );
    const read = readGrantList(scope, controller.signal);
    controller.abort();
    expect(await read).toBeNull();
    resolve({ ok: true, json: async () => body() });
  });
  it("accepts only typed actor references belonging to the served grants", () => {
    const b: any = body();
    b.grants.items = [{ ...b.grants.items[0], issuerUserId: "signer" }];
    b.actors = {
      "USER:signer": { id: "signer", name: "Signer", urn: "hrn:user:signer" },
    };
    expect(parseGrantList(b, scope)?.actors?.["USER:signer"].name).toBe(
      "Signer",
    );
    b.actors["USER:other"] = { id: "other", name: "Foreign actor" };
    expect(parseGrantList(b, scope)).toBeNull();
    delete b.actors["USER:other"];
    b.grants.items[0].verifiedBy = 42;
    expect(parseGrantList(b, scope)).toBeNull();
  });
});
