import { fixtureActions } from "./grants.fixture";
import { GraphQLError } from "graphql";
import { ClientError } from "graphql-request";
import { beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.fn();
vi.mock("$lib/server/api", () => ({ gqlClient: () => ({ request }) }));
const signing = vi.fn();
vi.mock("$lib/server/signing-capability", () => ({
  deploymentOffersSigning: (...a: unknown[]) => signing(...a),
}));
const app = {
  id: "app-a",
  name: "Team",
  urn: "hrn:app:example.test:team",
  viewerManages: true,
};
const grant = {
  id: "grant-1",
  appId: app.id,
  holderKind: "WORKER",
  holderId: "worker-a",
  action: "schedule.create",
  values: { entryNode: "node-a" },
  reason: "Testing",
  allows: false,
  createdAt: "2026-01-01T00:00:00Z",
  activatedAt: null,
  revokedAt: null,
  holderDepartedAt: null,
  startsAt: null,
  expiresAt: null,
  maxUses: null,
  useCount: 0,
};
let manager: boolean, signingOn: boolean, refusal: string | null;
beforeEach(() => {
  manager = true;
  signingOn = true;
  refusal = null;
  request.mockReset();
  signing.mockImplementation(() => signingOn);
  request.mockImplementation(async (q: string, vars: any) => {
    if (q.includes("query AppGrantsApp"))
      return { app: { ...app, viewerManages: manager } };
    if (q.includes("query GrantSubjectNode"))
      return {
        node: {
          id: vars.ref,
          name: "Daily entry",
          urn: "hrn:node:example.test:knowledge:daily",
        },
      };
    if (q.includes("query AppGrantActions")) return { grantActions: { items: fixtureActions, total: fixtureActions.length } };
    if (q.includes("query AppGrantsPage"))
      return { appGrants: { items: [grant], total: 41 } };
    if (q.includes("query AppGrantWorkers"))
      return {
        teamRoster: {
          workers: [
            {
              worker: {
                id: "worker-a",
                name: "Builder",
                urn: "hrn:worker:example.test:team:builder",
              },
            },
          ],
        },
      };
    if (q.includes("query AppInstalledAgents"))
      return {
        app: {
          id: app.id,
          appAgents: [
            {
              agent: {
                id: "agent-a",
                name: "Engineer",
                urn: "hrn:agent:example.test:engineer",
              },
            },
          ],
        },
      };
    if (q.includes("query Memories"))
      return { memories: { items: [], total: 0 } };
    if (q.includes("query GrantHolder"))
      return {
        worker: {
          id: "worker-a",
          name: "Builder",
          urn: "hrn:worker:example.test:team:builder",
        },
      };
    if (q.includes("mutation")) {
      if (refusal)
        throw new ClientError(
          {
            status: 400,
            headers: new Headers(),
            body: JSON.stringify({
              data: null,
              errors: [
                {
                  message: "<script>secret server prose</script>",
                  extensions: { code: refusal },
                },
              ],
            }),
            data: null,
            errors: [
              new GraphQLError("<script>secret server prose</script>", {
                extensions: { code: refusal },
              }),
            ],
          },
          { query: q, variables: vars },
        );
      if (q.includes("CreateAppGrant")) return { createGrant: grant };
      if (q.includes("RevokeAppGrant"))
        return { revokeGrant: { ...grant, revokedAt: "2026-02-01T00:00:00Z" } };
    }
    throw Error(`unexpected ${q} ${JSON.stringify(vars)}`);
  });
});
const event = (body?: Record<string, string>, search = "") => ({
  params: { appId: app.id },
  locals: { token: "synthetic", user: { id: "person-a" } },
  url: new URL(`http://localhost/app/apps/${app.id}/grants${search}`),
  request: new Request("http://localhost", {
    method: "POST",
    body: new URLSearchParams(body),
  }),
});
const input = {
  holder: "WORKER:worker-a",
  action: "schedule.create",
  "parameter:entryNode": "node-a",
  reason: "Testing",
};
async function load(search = "") {
  return (await import("./+page.server")).load(
    event(undefined, search) as never,
  ) as any;
}
async function act(action: "create" | "revoke", body: Record<string, string>) {
  return (await import("./+page.server")).actions[action]!(
    event(body) as never,
  ) as any;
}
const writes = () => request.mock.calls.filter(([q]) => q.includes("mutation"));
describe("App Grants manager route", () => {
  it.each([
    "FORBIDDEN",
    "NOT_FOUND",
    "APP_NOT_FOUND",
    "UNAUTHENTICATED",
    "BAD_USER_INPUT",
  ])("conceals an unreadable App (%s) like a missing one", async (code) => {
    request.mockRejectedValueOnce(
      new ClientError(
        {
          status: 400,
          headers: new Headers(),
          body: JSON.stringify({
            data: null,
            errors: [{ message: "private App exists", extensions: { code } }],
          }),
          data: null,
          errors: [
            new GraphQLError("private App exists", { extensions: { code } }),
          ],
        },
        { query: "query AppGrantsApp($ref: ID!) { app(ref:$ref) { id } }" },
      ),
    );
    await expect(load()).rejects.toMatchObject({
      status: 404,
      body: { message: "App not found." },
    });
    expect(request).toHaveBeenCalledTimes(1);
    request.mockResolvedValueOnce({ app: null });
    await expect(load()).rejects.toMatchObject({
      status: 404,
      body: { message: "App not found." },
    });
  });
  it("keeps an App-read outage distinct from absence without leaking prose", async () => {
    request.mockRejectedValueOnce(Error("private transport details"));
    await expect(load()).rejects.toMatchObject({
      status: 503,
      body: {
        message:
          "The grant request could not be completed. Refresh before trying again.",
      },
    });
  });
  it("maps a signing-capability read failure to the fixed unavailable response", async () => {
    signing.mockRejectedValueOnce(Error("private capability details"));
    await expect(load()).rejects.toMatchObject({
      status: 503,
      body: {
        message:
          "The grant request could not be completed. Refresh before trying again.",
      },
    });
  });
  it("pins the reason cap in Unicode code points with a specific refusal", async () => {
    const ok = await act("create", { ...input, reason: "😀".repeat(2000) });
    expect(ok.grant).toBeTruthy();
    const bad = await act("create", { ...input, reason: "a".repeat(2001) });
    expect(bad.status).toBe(400);
    expect(bad.data.error).toBe("Use at most 2000 characters for the reason.");
  });
  it("loads every grant without a state filter and pages by the requested offset", async () => {
    const d = await load("?offset=20");
    expect(d.grants.items).toEqual([grant]);
    expect(d.grants.total).toBe(41);
    expect(
      request.mock.calls.find(([q]) => q.includes("query AppGrantsPage"))?.[1],
    ).toEqual({ appRef: app.id, limit: 20, offset: 20 });
    expect(d.holders["WORKER:worker-a"].name).toBe("Builder");
    expect(d.nodes["node-a"]?.name).toBe("Daily entry");
  });
  it("returns an already-revoked outcome from the current server page", async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation((q: string, vars: any) =>
      q.includes("query AppGrantsPage")
        ? {
            appGrants: {
              items: [{ ...grant, revokedAt: "2026-02-01T00:00:00Z" }],
              total: 1,
            },
          }
        : original(q, vars),
    );
    const result = await act("revoke", { ref: grant.id });
    expect(result.alreadyRevoked).toBe(true);
    expect(result.grant.revokedAt).toBe("2026-02-01T00:00:00Z");
  });
  it("distinguishes a fresh revoke from an already-revoked row", async () => {
    expect((await act("revoke", { ref: grant.id })).alreadyRevoked).toBe(false);
  });
  it("keeps list and revoke available when holder choices fail", async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (q: string, v: unknown) => {
      if (q.includes("query AppGrantWorkers")) throw Error("offline");
      return original(q, v);
    });
    const data = await load();
    expect(data.grants.items).toEqual([grant]);
    expect(data.choices.failed).toBe(true);
    expect(
      (await act("revoke", { ref: grant.id })).grant.revokedAt,
    ).toBeTruthy();
  });
  it("streams node memories without holding up the grant page", async () => {
    const original = request.getMockImplementation()!;
    let release!: (value: unknown) => void;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    request.mockImplementation(async (q: string, v: unknown) =>
      q.includes("query Memories") ? waiting : original(q, v),
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        load(),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), 200);
        }),
      ]);
      expect(result).not.toBeNull();
      expect(result.grants.items).toEqual([grant]);
    } finally {
      clearTimeout(timer);
      release({ memories: { items: [], total: 0 } });
    }
  });
  it("rejects non-managers before any grant or holder read", async () => {
    manager = false;
    await expect(load()).rejects.toMatchObject({ status: 403 });
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("does not offer creation with signing off but list and revoke work", async () => {
    signingOn = false;
    expect((await load()).signing).toBe(false);
    const r = await act("revoke", { ref: grant.id });
    expect(r.grant.revokedAt).toBeTruthy();
    expect(request.mock.calls.some(([q]) => q.includes("CreateAppGrant"))).toBe(
      false,
    );
  });
  it("rejects a direct create with signing off before selecting the absent mutation", async () => {
    signingOn = false;
    expect((await act("create", input)).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  it.each(["WORKER:worker-a", "AGENT:agent-a"])(
    "creates with picked holder and node ids: %s",
    async (holder) => {
      const result = await act("create", {
        ...input,
        holder,
        startsAt: "2026-01-01T10:00",
        maxUses: "3",
      });
      expect(result.grant).toEqual(grant);
      const [kind, id] = holder.split(":");
      expect(writes()[0][1].input).toMatchObject({
        appRef: app.id,
        holderKind: kind,
        holderRef: id,
        action: "schedule.create",
        values: { entryNode: "node-a" },
        maxUses: 3,
      });
      expect(writes()[0][1].input).not.toHaveProperty("activate");
    },
  );
  it.each([
    ["webhook.create", "entryNode"],
    ["bootprompt.source.edit", "sourceNode"],
    ["bootprompt.compile.approve", "compiledNode"],
  ])("maps %s to its one parameter", async (action, parameter) => {
    await act("create", { ...input, action, ["parameter:" + parameter]: "node-a" });
    expect(writes()[0][1].input.values).toEqual({ [parameter]: "node-a" });
  });
  it.each([
    { holder: "USER:person-a" },
    { holder: "WORKER:other-app-worker" },
    { "parameter:entryNode": "hrn:node:example.test:mem:n" },
    { "parameter:entryNode": "*" },
    { action: "anything" },
    { maxUses: "1.5" },
  ])("rejects unsupported choices %j", async (bad) => {
    expect(
      (await act("create", { ...input, ...bad } as Record<string, string>))
        .status,
    ).toBe(400);
    expect(writes()).toHaveLength(0);
  });
  it.each([
    "GRANT_NOT_MANAGER",
    "GRANT_NOT_FOUND",
    "GRANT_HOLDER_NOT_ALLOWED",
    "GRANT_ACTION_UNKNOWN",
    "GRANT_VALUES_INVALID",
    "GRANT_TERMS_INVALID",
    "UNEXPECTED",
  ])("redacts refusal %s", async (code) => {
    refusal = code;
    const r = await act("create", input);
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(r)).not.toContain("secret server prose");
    expect(r.data.error).toBeTruthy();
  });
  it.each(["GRANT_NOT_MANAGER", "GRANT_NOT_FOUND", "UNEXPECTED"])(
    "redacts revoke refusal %s",
    async (code) => {
      refusal = code;
      const r = await act("revoke", { ref: grant.id });
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r)).not.toContain("secret server prose");
      expect(r.data.error).toBeTruthy();
    },
  );
  it("revoke returns the exact server row, including an unchanged timestamp", async () => {
    const a = await act("revoke", { ref: grant.id });
    const b = await act("revoke", { ref: grant.id });
    expect(a.grant).toEqual(b.grant);
    expect(a.grant.revokedAt).toBe("2026-02-01T00:00:00Z");
  });
  it("rejects a grant from another App before any revoke mutation", async () => {
    expect((await act("revoke", { ref: "other-app-grant" })).status).toBe(409);
    expect(writes()).toHaveLength(0);
  });
  it.each(["tomorrow", "2026-02-30T10:00", "2026-01-01T25:00"])(
    "rejects invalid UTC input %s before writing",
    async (startsAt) => {
      expect((await act("create", { ...input, startsAt })).status).toBe(400);
      expect(writes()).toHaveLength(0);
    },
  );
  it("checks manager authority again on each write", async () => {
    manager = false;
    expect((await act("revoke", { ref: grant.id })).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  it("refuses an impersonated create or revoke locally", async () => {
    const e = event(input);
    (e.locals as any).impersonation = {};
    const a = (await import("./+page.server")).actions;
    expect(((await a.create!(e as never)) as any).status).toBe(403);
    expect(((await a.revoke!(e as never)) as any).status).toBe(403);
    expect(writes()).toHaveLength(0);
  });
  describe("create when the holder choices cannot be read", () => {
    const wire = (code: string | null, status = 200) =>
      new ClientError(
        {
          status,
          headers: new Headers(),
          body: "",
          data: null,
          errors: code
            ? [new GraphQLError("private prose", { extensions: { code } })]
            : undefined,
        } as never,
        { query: "query AppGrantWorkers", variables: {} },
      );
    const failChoices = (e: unknown) => {
      const original = request.getMockImplementation()!;
      request.mockImplementation(async (q: string, v: unknown) => {
        if (q.includes("query AppGrantWorkers")) throw e;
        return original(q, v);
      });
    };
    const message = "The holder choices could not be loaded. Try again.";
    it.each([
      ["a transport failure", () => Error("offline")],
      ["an INTERNAL_SERVER_ERROR", () => wire("INTERNAL_SERVER_ERROR", 500)],
    ])("answers 503 with the fixed text for %s, sending no mutation", async (_n, make) => {
      failChoices(make());
      const r = await act("create", input);
      expect(r.status).toBe(503);
      expect(r.data.error).toBe(message);
      expect(JSON.stringify(r)).not.toContain("private prose");
      expect(writes()).toHaveLength(0);
    });
    it("answers 503 when the installed-agent read is withheld", async () => {
      const original = request.getMockImplementation()!;
      request.mockImplementation(async (q: string, v: unknown) =>
        q.includes("query AppInstalledAgents")
          ? { app: { id: app.id, appAgents: null } }
          : original(q, v),
      );
      const r = await act("create", input);
      expect(r.status).toBe(503);
      expect(r.data.error).toBe(message);
      expect(writes()).toHaveLength(0);
    });
    it.each(["GRANT_NOT_MANAGER", "NOT_FOUND"])(
      "keeps a typed refusal (%s) at its existing 400 mapping, never 503",
      async (code) => {
        failChoices(wire(code));
        const r = await act("create", input);
        expect(r.status).toBe(400);
        expect(r.data.error).not.toBe(message);
        expect(writes()).toHaveLength(0);
      },
    );
    it("keeps validation refusals at 400 when the choices read works", async () => {
      const r = await act("create", { ...input, holder: "WORKER:nobody" });
      expect(r.status).toBe(400);
    });
  });
  it("loads no choices and offers no signing under impersonation", async () => {
    const e = event(undefined) as any;
    e.locals.impersonation = {};
    signing.mockClear();
    const d = await (await import("./+page.server")).load(e as never) as any;
    expect(d.signing).toBe(false);
    expect(d.impersonating).toBe(true);
    expect(d.choices).toEqual({ workers: [], agents: [], failed: false });
    expect(signing).not.toHaveBeenCalled();
    expect(request.mock.calls.some(([q]) => q.includes("AppGrantWorkers"))).toBe(false);
  });
  it("does not flag an ordinary session as impersonating", async () => {
    expect((await load()).impersonating).toBe(false);
  });
  it.each(["GRANT_NOT_MANAGER", "INTERNAL_SERVER_ERROR"])(
    "maps an appGrants read failing with %s",
    async (code) => {
      const original = request.getMockImplementation()!;
      request.mockImplementation(async (q: string, v: unknown) => {
        if (q.includes("query AppGrantsPage"))
          throw new ClientError(
            {
              status: 200,
              headers: new Headers(),
              body: "",
              data: null,
              errors: [new GraphQLError("private prose", { extensions: { code } })],
            } as never,
            { query: q, variables: {} },
          );
        return original(q, v);
      });
      await expect(load()).rejects.toMatchObject({
        status: code === "GRANT_NOT_MANAGER" ? 403 : 503,
      });
    },
  );
  it("maps an appGrants transport failure to the fixed 503", async () => {
    const original = request.getMockImplementation()!;
    request.mockImplementation(async (q: string, v: unknown) => {
      if (q.includes("query AppGrantsPage")) throw Error("private transport");
      return original(q, v);
    });
    await expect(load()).rejects.toMatchObject({
      status: 503,
      body: { message: "The grant request could not be completed. Refresh before trying again." },
    });
  });
});
