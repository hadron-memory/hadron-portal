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
  organizationId: null,
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
  nodeId: "node-a",
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
  it("loads every grant without a state filter and pages by the requested offset", async () => {
    const d = await load("?offset=20");
    expect(d.grants.items).toEqual([grant]);
    expect(d.grants.total).toBe(41);
    expect(
      request.mock.calls.find(([q]) => q.includes("query AppGrantsPage"))?.[1],
    ).toEqual({ appRef: app.id, limit: 20, offset: 20 });
    expect(d.holders["WORKER:worker-a"].name).toBe("Builder");
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
    await act("create", { ...input, action });
    expect(writes()[0][1].input.values).toEqual({ [parameter]: "node-a" });
  });
  it.each([
    { holder: "USER:person-a" },
    { holder: "WORKER:other-app-worker" },
    { nodeId: "hrn:node:example.test:mem:n" },
    { nodeId: "*" },
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
});
