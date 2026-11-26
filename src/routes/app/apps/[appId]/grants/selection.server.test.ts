import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError } from "graphql-request";
import { GraphQLError } from "graphql";
import { fixtureGrant, grantsFixture, fixtureActions } from "./grants.fixture";
import { env } from "$env/dynamic/public";
import { grantError } from "$lib/grants/types";
const request = vi.fn(), signing = vi.fn();
vi.mock("$lib/server/api", () => ({ gqlClient: () => ({ request }) }));
vi.mock("$lib/server/signing-capability", () => ({ deploymentOffersSigning: (...a: unknown[]) => signing(...a) }));
const app = grantsFixture().app;
const ceremony = "https://signing.example.test/grant-selection-signing/abc123";
const post = (refs: string[], impersonation: unknown = null, action = "signSelection") => {
  const body = new URLSearchParams(); for (const r of refs) body.append("ref", r);
  return { locals: { token: "synthetic", user: { id: "person-example" }, impersonation }, params: { appId: "hrn:app:example.test:team" }, url: new URL(`http://localhost/app/apps/app-example/grants?/${action}&offset=20`), request: new Request("http://localhost/x", { method: "POST", body }) };
};
const run = async (e: ReturnType<typeof post>, name: "signSelection" | "withdrawSelection" | "readSelection" = "signSelection") => { const { actions } = await import("./+page.server"); return (actions as Record<string, (e: never) => Promise<unknown>>)[name]!(e as never); };
const refusal = (code: string, message: string, extensions: Record<string, unknown> = {}) => new ClientError({ status: 400, headers: new Headers(), body: "", errors: [new GraphQLError(message, { extensions: { code, ...extensions } })] }, { query: "mutation SECRET_QUERY", variables: { secret: "PRIVATE_VARIABLE" } });
const serve = (selection: unknown) => request.mockImplementation(async (q: string) => {
  if (q.includes("query AppGrantsApp")) return { app };
  if (q.includes("query AppGrantActions")) return { grantActions: { items: fixtureActions, total: fixtureActions.length } };
  if (q.includes("mutation RequestGrantSelectionSignature")) { if (selection instanceof Error) throw selection; return { requestGrantSelectionSignature: selection }; }
  if (q.includes("mutation WithdrawGrantSigningSelection")) { if (selection instanceof Error) throw selection; return { withdrawGrantSigningSelection: selection }; }
  if (q.includes("query ReadGrantSigningSelection")) { if (selection instanceof Error) throw selection; return { grantSigningSelection: selection }; }
  throw Error("Unexpected operation " + q.slice(0, 60));
});
beforeEach(() => { env.PUBLIC_SERVER_URL = "https://signing.example.test"; request.mockReset(); signing.mockReset().mockResolvedValue(true); serve({ id: "sel1", ceremonyUrl: ceremony, expiresAt: "2026-12-01T00:00:00Z" }); });
const sent = (name: string) => request.mock.calls.filter(([q]) => String(q).includes(name));
describe("Sign selected: one request for the whole selection (portal#2638 acceptance 1)", () => {
  it("makes ONE requestGrantSelectionSignature with the three refs, in order, and answers the server's URL unmodified", async () => {
    const r = await run(post(["g1", "g2", "g3"])) as { selection: { id: string; ceremonyUrl: string; refs: string[] } };
    const calls = sent("RequestGrantSelectionSignature");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ grantRefs: ["g1", "g2", "g3"] });
    expect(r.selection).toMatchObject({ id: "sel1", ceremonyUrl: ceremony, refs: ["g1", "g2", "g3"] });
  });
  it("a selection of one grant is the same call with one ref", async () => {
    await run(post(["g1"]));
    expect(sent("RequestGrantSelectionSignature")[0][1]).toEqual({ grantRefs: ["g1"] });
  });
  it("never composes the link: a URL on another host or the wrong path is refused, not handed on", async () => {
    for (const u of ["https://evil.example/grant-selection-signing/abc", "https://signing.example.test/grant-signing/abc", "http://signing.example.test/grant-selection-signing/abc", "https://signing.example.test@evil.example/grant-selection-signing/abc"]) {
      serve({ id: "s", ceremonyUrl: u, expiresAt: "x" });
      expect((await run(post(["g1"])) as { status: number }).status).toBe(503);
    }
  });
  it("sends nothing it did not get from the form: no client-side cap, no de-duplication, no filtering", async () => {
    const refs = Array.from({ length: 40 }, (_, i) => `g${i % 30}`);
    await run(post(refs));
    expect(sent("RequestGrantSelectionSignature")[0][1]).toEqual({ grantRefs: refs });
  });
  it("is unavailable where the deployment offers no signing", async () => {
    signing.mockResolvedValue(false);
    expect((await run(post(["g1"])) as { status: number }).status).toBe(403);
    expect(sent("RequestGrantSelectionSignature")).toHaveLength(0);
  });
});
describe("refusals show the server's answer (portal#2638 acceptance 3 and the FORBIDDEN row)", () => {
  it.each(["SELECTION_EMPTY", "SELECTION_TOO_LARGE", "SELECTION_DUPLICATE_GRANT", "SELECTION_MIXED_APPS", "GRANT_NOT_FOUND", "GRANT_NOT_PENDING", "GRANT_EXPIRED", "GRANT_TERMS_UNREPRESENTABLE", "FORBIDDEN"])("%s renders the server's own message", async (code) => {
    serve(refusal(code, `Server says ${code}.`, { cap: 30 }));
    const r = await run(post(["g1", "g2"])) as { status: number; data: { error: string } };
    expect(r.status).toBe(400); expect(r.data.error).toBe(`Server says ${code}.`);
  });
  it("an unknown code, or a failure outside the contract, shows the page's generic text and leaks nothing", async () => {
    serve(refusal("SOMETHING_ELSE", "private SQL detail"));
    const r = await run(post(["g1"])) as { data: { error: string } };
    expect(JSON.stringify(r)).not.toMatch(/private SQL|SECRET_QUERY|PRIVATE_VARIABLE/);
  });
  it("the cap is the server's: the page never states a number of its own", async () => {
    serve(refusal("SELECTION_TOO_LARGE", "A selection can name at most 7 grants.", { cap: 7 }));
    const r = await run(post(Array.from({ length: 8 }, (_, i) => `g${i}`))) as { data: { error: string } };
    expect(r.data.error).toBe("A selection can name at most 7 grants.");
  });
});
describe("impersonation (portal#2638 gate addition)", () => {
  it("refuses the request with 403 before any selection call", async () => {
    const r = await run(post(["g1"], { sessionId: "imp" })) as { status: number };
    expect(r.status).toBe(403);
    expect(sent("RequestGrantSelectionSignature")).toHaveLength(0);
  });
  it("refuses the withdraw with 403 before any server call", async () => {
    const e = post([], { sessionId: "imp" }, "withdrawSelection");
    (e as { request: Request }).request = new Request("http://localhost/x", { method: "POST", body: new URLSearchParams({ id: "sel1" }) });
    const r = await run(e, "withdrawSelection") as { status: number };
    expect(r.status).toBe(403);
    expect(sent("WithdrawGrantSigningSelection")).toHaveLength(0);
  });
  it("shows the server's FORBIDDEN text like the page's other FORBIDDEN answers", async () => {
    serve(refusal("FORBIDDEN", "You are viewing as another person."));
    const r = await run(post(["g1"])) as { data: { error: string } };
    expect(r.data.error).toBe("You are viewing as another person.");
  });
});
describe("withdrawing an open selection (acceptance 5)", () => {
  const withdraw = (id = "sel1") => { const e = post([], null, "withdrawSelection"); (e as { request: Request }).request = new Request("http://localhost/x", { method: "POST", body: new URLSearchParams({ id }) }); return e; };
  it("calls withdrawGrantSigningSelection with that id and reports it ended", async () => {
    serve({ id: "sel1", endedAt: "2026-11-25T00:00:00Z" });
    const r = await run(withdraw(), "withdrawSelection") as { withdrawn: string };
    expect(sent("WithdrawGrantSigningSelection")[0][1]).toEqual({ id: "sel1" });
    expect(r.withdrawn).toBe("sel1");
  });
  it.each(["SIGNING_REQUEST_NOT_FOUND", "SIGNING_REQUEST_NOT_REQUESTER", "SIGNING_REQUEST_ENDED", "FORBIDDEN"])("%s shows the server's message", async (code) => {
    serve(refusal(code, `Server says ${code}.`));
    const r = await run(withdraw(), "withdrawSelection") as { data: { error: string } };
    expect(r.data.error).toBe(`Server says ${code}.`);
  });
});
describe("the App-manager gate is its own guard (security review P3-1)", () => {
  const notManager = () => request.mockImplementation(async (q: string) => {
    if (q.includes("query AppGrantsApp")) return { app: { ...app, viewerManages: false } };
    throw Error("no other call may be made: " + q.slice(0, 50));
  });
  it("a person who does not manage the App is refused before any selection or withdraw call", async () => {
    notManager();
    const a = await run(post(["g1"])) as { status: number };
    const e = post([], null, "withdrawSelection");
    (e as { request: Request }).request = new Request("http://localhost/x", { method: "POST", body: new URLSearchParams({ id: "sel1" }) });
    const w = await run(e, "withdrawSelection") as { status: number };
    expect([a.status, w.status]).toEqual([403, 403]);
    expect(sent("RequestGrantSelectionSignature")).toHaveLength(0);
    expect(sent("WithdrawGrantSigningSelection")).toHaveLength(0);
  });
  it("an App the person cannot read is concealed the same way, with no selection call", async () => {
    request.mockImplementation(async (q: string) => { if (q.includes("query AppGrantsApp")) throw refusal("FORBIDDEN", "no"); throw Error("no other call"); });
    const a = await run(post(["g1"])) as { status: number };
    expect([403, 404]).toContain(a.status);
    expect(sent("RequestGrantSelectionSignature")).toHaveLength(0);
  });
  it("the unknown-code answer is the generic text with status 503", async () => {
    serve(refusal("SOMETHING_ELSE", "private SQL detail"));
    const r = await run(post(["g1"])) as { status: number; data: { error: string } };
    expect(r.status).toBe(503); expect(r.data.error).toBe(grantError(null));
  });
});

describe("readSelection: the selection's own state (portal#2650)", () => {
  const read = (id = "sel1") => { const e = post([], null, "readSelection"); const body = new URLSearchParams({ id }); return run({ ...e, request: new Request("http://localhost/x", { method: "POST", body }) }, "readSelection") as Promise<Record<string, unknown>>; };
  it.each(["OPEN", "COMPLETED", "DECLINED", "EXPIRED", "WITHDRAWN"])("answers %s as the server read it", async (state) => {
    serve({ id: "sel1", state });
    expect(await read()).toMatchObject({ operation: "readSelection", id: "sel1", state });
    expect(sent("ReadGrantSigningSelection")[0][1]).toEqual({ id: "sel1" });
  });
  it("a null selection, another id or an unknown word is no state", async () => {
    for (const answer of [null, { id: "other", state: "DECLINED" }, { id: "sel1", state: "STALE" }]) {
      serve(answer);
      expect(await read()).toMatchObject({ state: null });
    }
  });
  it("an empty id is refused before any call", async () => {
    expect(await read("")).toMatchObject({ status: 400 });
    expect(sent("ReadGrantSigningSelection")).toHaveLength(0);
  });
  it("a server refusal is a failure, never a state", async () => {
    serve(refusal("SIGNING_REQUEST_NOT_FOUND", "No such request."));
    const r = await read() as { status?: number; data?: { error?: string; state?: unknown } };
    expect(r.data?.error).toBeTruthy();
    expect(r.data).not.toHaveProperty("state");
  });
});
