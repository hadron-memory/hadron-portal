import { fixtureActions } from "./grants.fixture";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "graphql-request";
import { GraphQLError } from "graphql";
import { fixtureGrant, grantsFixture } from "./grants.fixture";
import { env } from "$env/dynamic/public";
const request = vi.fn(),
  signing = vi.fn();
vi.mock("$lib/server/api", () => ({ gqlClient: () => ({ request }) }));
vi.mock("$lib/server/signing-capability", () => ({
  deploymentOffersSigning: (...a: unknown[]) => signing(...a),
}));
const app = grantsFixture().app;
const ceremony =
  "https://signing.example.test/grant-signing/opaque?server=owns%2Fpath&z=2";
const event = (ref = fixtureGrant.id) => ({
  locals: {
    token: "synthetic",
    user: { id: "person-example" },
    impersonation: null,
  },
  params: { appId: "hrn:app:example.test:team" },
  url: new URL(
    "http://localhost/app/apps/app-example/grants?/approve&offset=20",
  ),
  request: new Request(
    "http://localhost/app/apps/app-example/grants?/approve&offset=20",
    { method: "POST", body: new URLSearchParams({ ref }) },
  ),
});
const run = async (e = event()) => {
  const { actions } = await import("./+page.server");
  return actions.approve!(e as never);
};
const refusal = (code: string, message: string) =>
  new ClientError(
    {
      status: 400,
      headers: new Headers(),
      body: "",
      errors: [new GraphQLError(message, { extensions: { code } })],
    },
    {
      query: "mutation SECRET_QUERY",
      variables: { secret: "PRIVATE_VARIABLE" },
    },
  );
beforeEach(() => {
  env.PUBLIC_SERVER_URL = "https://signing.example.test";
  request.mockReset();
  signing.mockReset().mockResolvedValue(true);
  request.mockImplementation(async (q: string) => {
    if (q.includes("query AppGrantsApp")) return { app };
    if (q.includes("query AppGrantActions")) return { grantActions: { items: fixtureActions, total: fixtureActions.length } };
    if (q.includes("query AppGrantsPage"))
      return { appGrants: { items: [fixtureGrant], total: 21 } };
    if (q.includes("mutation RequestAppGrantSignature"))
      return {
        requestGrantSignature: {
          id: "request-example",
          grantId: fixtureGrant.id,
          ceremonyUrl: ceremony,
        },
      };
    throw Error("Unexpected operation");
  });
});
describe("the approval redirect is pinned to the server public origin (portal#2417)", () => {
  const serve = (ceremonyUrl: unknown) =>
    request.mockImplementation(async (q: string) => {
      if (q.includes("query AppGrantsApp")) return { app };
      if (q.includes("query AppGrantsPage"))
        return { appGrants: { items: [fixtureGrant], total: 21 } };
      if (q.includes("mutation RequestAppGrantSignature"))
        return { requestGrantSignature: { id: "r", grantId: fixtureGrant.id, ceremonyUrl } };
      throw Error("Unexpected operation");
    });
  it("refuses a link on another host instead of redirecting to it", async () => {
    for (const u of [
      "https://evil.example/grant-signing/opaque",
      "https://signing.example.test.evil.example/grant-signing/opaque",
      "https://signing.example.test@evil.example/grant-signing/opaque",
      "http://signing.example.test/grant-signing/opaque",
    ]) {
      serve(u);
      const r = (await run()) as { status: number };
      expect(r.status).toBe(503);
    }
  });
  it("redirects nowhere when the origin is not configured, never to a guess", async () => {
    serve(ceremony);
    for (const unset of [undefined, "", "not a url", "javascript:alert(1)"]) {
      env.PUBLIC_SERVER_URL = unset;
      const r = (await run()) as { status: number };
      expect(r.status).toBe(503);
    }
  });
});
describe("one-grant manager approval handoff", () => {
  it("requests the selected on-page grant and redirects to the exact server ceremony URL", async () => {
    await expect(run()).rejects.toMatchObject({
      status: 303,
      location: ceremony,
    });
    expect(
      request.mock.calls.find(([q]) => q.includes("mutation"))?.[1],
    ).toEqual({ grantRef: fixtureGrant.id });
    expect(
      request.mock.calls.find(([q]) => q.includes("query AppGrantsPage"))?.[1],
    ).toEqual({ appRef: app.id, limit: 20, offset: 20 });
  });
  it("opens a fresh request every time without querying for another open request", async () => {
    for (let n = 0; n < 2; n++)
      await expect(run()).rejects.toMatchObject({
        status: 303,
        location: ceremony,
      });
    expect(
      request.mock.calls.filter(([q]) =>
        q.includes("mutation RequestAppGrantSignature"),
      ),
    ).toHaveLength(2);
    expect(
      request.mock.calls.some(([q]) =>
        /grantSigningRequest\(|grant\(ref/.test(q),
      ),
    ).toBe(false);
  });
  it("checks the session in the action before any server read", async () => {
    const e = event();
    e.locals.token = "";
    await expect(run(e)).rejects.toMatchObject({
      status: 303,
      location: expect.stringContaining("/signin"),
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("refuses impersonation without a request mutation", async () => {
    const e = event();
    e.locals.impersonation = {} as never;
    const r = await run(e);
    expect(r).toMatchObject({ status: 403 });
    expect(request).not.toHaveBeenCalled();
  });
  it("checks manager reach before touching grants", async () => {
    request.mockResolvedValueOnce({ app: { ...app, viewerManages: false } });
    const r = await run();
    expect(r).toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("sends no signing operation while signing is off", async () => {
    signing.mockResolvedValue(false);
    const r = await run();
    expect(r).toMatchObject({ status: 403 });
    expect(request.mock.calls.some(([q]) => q.includes("mutation"))).toBe(
      false,
    );
  });
  it.each(["not-on-page", ""])(
    "refuses an unbound target %s without a mutation",
    async (ref) => {
      const r = await run(event(ref));
      expect(r).toMatchObject({ status: expect.any(Number) });
      expect(request.mock.calls.some(([q]) => q.includes("mutation"))).toBe(
        false,
      );
    },
  );
  it.each([
    "GRANT_NOT_PENDING",
    "GRANT_EXPIRED",
    "GRANT_TERMS_UNREPRESENTABLE",
    "FORBIDDEN",
  ])(
    "keeps the server words for the allowed request refusal %s",
    async (code) => {
      request.mockImplementation(async (q: string) => {
        if (q.includes("query AppGrantsApp")) return { app };
        if (q.includes("query AppGrantsPage"))
          return { appGrants: { items: [fixtureGrant], total: 21 } };
        throw refusal(code, "Exact server refusal " + code);
      });
      const r = await run();
      expect(r).toMatchObject({
        data: {
          error: "Exact server refusal " + code,
          operation: "approve",
          appId: app.id,
        },
      });
    },
  );
  it.each(["INTERNAL_SERVER_ERROR", "UNKNOWN"])(
    "suppresses unknown/infrastructure prose %s",
    async (code) => {
      request.mockImplementation(async (q: string) => {
        if (q.includes("query AppGrantsApp")) return { app };
        if (q.includes("query AppGrantsPage"))
          return { appGrants: { items: [fixtureGrant], total: 21 } };
        throw refusal(code, "PRIVATE_SQL SECRET");
      });
      const r = await run();
      expect(JSON.stringify(r)).not.toMatch(
        /PRIVATE_SQL|SECRET_QUERY|PRIVATE_VARIABLE/,
      );
      expect(r).toMatchObject({
        data: { operation: "approve", error: expect.any(String) },
      });
    },
  );
  it("leaves server-clock expiry judgment to the signing request", async () => {
    request.mockImplementation(async (q: string) => {
      if (q.includes("query AppGrantsApp")) return { app };
      if (q.includes("query AppGrantsPage"))
        return {
          appGrants: {
            items: [{ ...fixtureGrant, expiresAt: "2000-01-01T00:00:00Z" }],
            total: 1,
          },
        };
      throw refusal("GRANT_EXPIRED", "Server clock says expired.");
    });
    expect(await run()).toMatchObject({
      data: { error: "Server clock says expired." },
    });
  });
});
