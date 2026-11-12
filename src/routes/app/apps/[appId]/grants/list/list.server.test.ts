import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "graphql-request";
import { GraphQLError } from "graphql";
import { fixtureGrant, grantsFixture } from "../grants.fixture";
const request = vi.fn();
vi.mock("$lib/server/api", () => ({ gqlClient: () => ({ request }) }));
const event = () => ({
  locals: { token: "synthetic", user: { id: "person-example" } },
  params: { appId: "hrn:app:example.test:team" },
  url: new URL("http://localhost/app/apps/app-example/grants/list?offset=20"),
});
beforeEach(() => {
  request.mockReset();
  request.mockImplementation(async (q: string) => {
    if (q.includes("query AppGrantsApp")) return { app: grantsFixture().app };
    if (q.includes("query AppGrantsPage"))
      return { appGrants: { items: [fixtureGrant], total: 41 } };
    if (q.includes("query GrantHolderWorker"))
      return { worker: grantsFixture().holders["WORKER:worker-example"] };
    if (q.includes("query GrantSubjectNode")) return { node: null };
    throw Error("Unexpected operation");
  });
});
const get = async (e = event()) => (await import("./+server")).GET(e as never);
describe("Grants section endpoint", () => {
  it("uses the same manager/list readers, canonical App id and bounded offset without signing or write reads", async () => {
    const res = await get();
    const b = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(b).toMatchObject({
      appId: "app-example",
      viewerId: "person-example",
      offset: 20,
      grants: { items: [fixtureGrant], total: 41 },
    });
    expect(
      request.mock.calls.find(([q]) => q.includes("query AppGrantsPage"))?.[1],
    ).toEqual({ appRef: "app-example", limit: 20, offset: 20 });
    expect(
      request.mock.calls.some(([q]) =>
        /mutation|ServerInfo|AppGrantWorkers|AppInstalledAgents/.test(q),
      ),
    ).toBe(false);
  });
  it("returns a no-store 401 before any read without a token/person", async () => {
    const e = event();
    e.locals.token = "";
    const res = await get(e);
    expect(res.status).toBe(401);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(request).not.toHaveBeenCalled();
  });
  it("denies a readable non-manager before the grant page", async () => {
    request.mockResolvedValueOnce({
      app: { ...grantsFixture().app, viewerManages: false },
    });
    const r = await get();
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ failed: true });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("keeps unreadable and missing App responses equally concealed", async () => {
    request.mockRejectedValueOnce(
      new ClientError(
        {
          status: 400,
          headers: new Headers(),
          body: "",
          data: null,
          errors: [
            new GraphQLError("private", { extensions: { code: "FORBIDDEN" } }),
          ],
        },
        { query: "query AppGrantsApp {app{id}}" },
      ),
    );
    expect((await get()).status).toBe(404);
    request.mockResolvedValueOnce({ app: null });
    expect((await get()).status).toBe(404);
  });
  it("represents an outage as a failed section, never empty grants or raw prose", async () => {
    request.mockRejectedValueOnce(Error("secret details"));
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ failed: true });
  });
});
