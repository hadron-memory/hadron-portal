import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "svelte/server";
import { grantHolders } from "$lib/server/app-grants";
import Page from "./+page.svelte";
import { grantsFixture, fixtureGrant } from "./grants.fixture";
import { setStubPage, resetStubPage } from "$lib/test/stubs/app-stores";
function draw(signing = true, form?: unknown, override = {}) {
  setStubPage("http://localhost/app/apps/app-example/grants", {
    appId: "app-example",
  });
  return render(Page, {
    props: { data: { ...grantsFixture(signing), ...override }, form } as never,
  }).body;
}
afterEach(resetStubPage);
describe("App Grants screen", () => {
  it("shows facts and server allows, without inventing lifecycle labels", () => {
    const html = draw();
    expect(html).toContain("Documentation worker");
    expect(html).toContain("hrn:worker:example.test:team:docs");
    expect(html).toContain("Allows now: No");
    expect(html).not.toMatch(
      />\s*(Pending|Active|Ended|Withdrawn|Retired|Departed)\s*</,
    );
  });
  it("names the scoped node and created date without opening details", () => {
    const html = draw(true, undefined, {
      nodes: {
        "node-example": {
          id: "node-example",
          name: "Daily entry",
          urn: "hrn:node:example.test:knowledge:daily",
        },
      },
    });
    expect(html).toContain("Daily entry");
    expect(html).toContain("hrn:node:example.test:knowledge:daily");
    expect(html).toContain(fixtureGrant.createdAt);
    expect(html).not.toContain("Grant ID");
  });
  it("uses only grouped picked Workers and Agents, the four actions and a node picker", () => {
    const html = draw();
    expect(html).toContain('optgroup label="Workers"');
    expect(html).toContain('optgroup label="Agents"');
    expect(html).not.toContain("Someone else");
    expect(html).toContain("Choose a node…");
    expect(html).toContain("needs a signature");
    for (const action of [
      "schedule.create",
      "webhook.create",
      "bootprompt.source.edit",
      "bootprompt.compile.approve",
    ])
      expect(html).toContain(action);
    expect(html).not.toMatch(/name="(?:holderRef|nodeUrn)"/);
  });
  it("signing off hides the entire create control, retaining revoke", () => {
    const html = draw(false);
    expect(html).not.toContain("Create a grant");
    expect(html).not.toContain('name="holder"');
    expect(html).not.toContain("?/create");
    expect(html).toContain("Revoke");
  });
  it("displays the server-returned row without an activation control", () => {
    const html = draw(true, {
      grant: { ...fixtureGrant, revokedAt: "2026-11-12T11:05:00Z" },
      appId: "app-example",
      operation: "revoke",
    });
    expect(html).not.toContain("Create request succeeded");
    expect(html).not.toContain(">Activate<");
  });
  it("ignores returned rows from another App", () => {
    expect(
      draw(true, {
        grant: { ...fixtureGrant, reason: "OTHER-APP-SECRET" },
        appId: "other",
        operation: "create",
      }),
    ).not.toContain("OTHER-APP-SECRET");
  });
  it("pages by served count and retains Previous for an empty page", () => {
    const html = draw(true, undefined, {
      offset: 20,
      grants: { items: [fixtureGrant], total: 50 },
    });
    expect(html).toContain("?offset=21");
    expect(html).toContain("?offset=0");
    const empty = draw(false, undefined, {
      offset: 40,
      grants: { items: [], total: 25 },
    });
    expect(empty).toContain("Previous");
    expect(empty).not.toContain(">Next<");
  });
});

it.each([false, true])(
  "keeps a missing USER fallback specific to each grant (reverse=%s)",
  async (reverse) => {
    const ended = {
      ...fixtureGrant,
      id: "ended-grant",
      holderKind: "USER" as const,
      holderId: "person-example",
      revokedAt: "2026-11-12T11:00:00Z",
      holderDepartedAt: null,
    };
    const departed = {
      ...ended,
      id: "departed-grant",
      revokedAt: null,
      holderDepartedAt: "2026-11-12T12:00:00Z",
    };
    const items = reverse ? [ended, departed] : [departed, ended];
    const request = vi.fn().mockResolvedValue({ user: null });
    const holders = await grantHolders({ request } as never, items);
    const html = draw(false, undefined, {
      grants: { items, total: 2 },
      holders,
    });
    expect(html).toContain("a deleted user");
    expect(html).toContain("Holder unavailable");
    expect(request).toHaveBeenCalledTimes(1);
  },
);
