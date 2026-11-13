export const fixtureActions = [
  ["schedule.create", "entryNode"], ["webhook.create", "entryNode"],
  ["bootprompt.source.edit", "sourceNode"], ["bootprompt.compile.approve", "compiledNode"],
].map(([name, parameter]) => ({ name, parameters: [{ name: parameter, type: "node-ref", refusesWildcard: true }] }));
import type { Grant } from "$lib/grants/types";
export const fixtureGrant: Grant = {
  id: "grant-example",
  appId: "app-example",
  holderKind: "WORKER",
  holderId: "worker-example",
  action: "schedule.create",
  values: { entryNode: "node-example" },
  reason: "Run the daily documentation check",
  startsAt: null,
  expiresAt: "2027-01-01T00:00:00Z",
  maxUses: 10,
  useCount: 0,
  createdAt: "2026-11-12T10:00:00Z",
  activatedAt: null,
  revokedAt: null,
  holderDepartedAt: null,
  allows: false,
};
export const grantsFixture = (signing = true) => ({
  actionDefinitions: fixtureActions,
  routeRef: "app-example",
  viewerId: "person-example",
  app: {
    id: "app-example",
    name: "Documentation team",
    urn: "hrn:app:example.test:team",
    viewerManages: true,
    organizationId: null,
  },
  signing,
  grants: { items: [fixtureGrant], total: 1 },
  holders: {
    "WORKER:worker-example": {
      id: "worker-example",
      name: "Documentation worker",
      urn: "hrn:worker:example.test:team:docs",
    },
  },
  nodes: {},
  choices: {
    failed: false,
    workers: [
      {
        id: "worker-example",
        name: "Documentation worker",
        urn: "hrn:worker:example.test:team:docs",
      },
    ],
    agents: [
      {
        id: "agent-example",
        name: "Documentation agent",
        urn: "hrn:agent:example.test:docs",
      },
    ],
  },
  memories: { kind: "ok" as const, value: [] },
  offset: 0,
});
