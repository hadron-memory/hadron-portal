import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import Harness from "./Page.harness.svelte";
import { mountComponent } from "$lib/test/mountComponent";
import { beginEnhanced } from "$lib/test/stubs/app-forms";
import { setStubPage, resetStubPage } from "$lib/test/stubs/app-stores";
import { resetNavigationCalls, resetNavigationGuards } from "$lib/test/stubs/app-navigation";
import { grantsFixture, fixtureGrant } from "./grants.fixture";

let mounted: ReturnType<typeof mountComponent> | undefined;
const mountWith = (d: unknown) => {
  mounted = mountComponent(Harness, { data: d, form: null } as never);
  flushSync();
  return mounted.target;
};
const setForm = (f: unknown) => {
  (mounted!.instance.setForm as (f: never) => void)(f as never);
  flushSync();
};
beforeEach(() => {
  setStubPage("http://localhost/app/apps/app-example/grants", { appId: "app-example" });
  resetNavigationCalls();
  resetNavigationGuards();
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  resetStubPage();
});
const created = {
  grant: { ...fixtureGrant, id: "grant-new" },
  operation: "create",
  appId: "app-example",
};
const emptyProjection = () => {
  const d = grantsFixture();
  return { ...d, holders: {}, grants: { items: [], total: 0 } };
};
async function createAs(target: HTMLElement, refresh: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(refresh));
  const select = target.querySelector<HTMLSelectElement>("#grant-holder")!;
  select.value = "WORKER:worker-example";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
  const form = target.querySelector<HTMLFormElement>('form[action*="/create"]')!;
  const update = vi.fn(async () => setForm(created));
  await (await beginEnhanced(form, { update }))({
    type: "success",
    status: 200,
    data: created,
  });
  flushSync();
}
const card = (t: HTMLElement) =>
  t.querySelector('section[aria-label="Request result"]')!.textContent;

describe("created-result identity", () => {
  it("names the picked holder when the page projection lacks it and the refresh failed", async () => {
    const t = mountWith(emptyProjection());
    await createAs(t, { ok: false });
    expect(card(t)).toContain("Documentation worker");
    expect(card(t)).toMatch(/example.test/);
    expect(card(t)).not.toContain("Holder unavailable");
  });
  it("keeps it when the refreshed page still lacks the holder (created off page one)", async () => {
    const d = emptyProjection();
    const t = mountWith(d);
    await createAs(t, {
      ok: true,
      json: async () => ({
        appId: d.app.id, viewerId: d.viewerId, offset: 0,
        actionDefinitions: d.actionDefinitions, actionDefinitionsFailed: false,
        grants: { items: [], total: 41 }, holders: {}, nodes: {},
      }),
    });
    expect(card(t)).toContain("Documentation worker");
    expect(card(t)).not.toContain("Holder unavailable");
  });
  it("without a pick, an absent projection still reads unavailable (pin: the pick is what fixes it)", () => {
    const t = mountWith(emptyProjection());
    setForm(created);
    expect(card(t)).toContain("Holder unavailable");
  });
});

describe("impersonation display", () => {
  it("hides Revoke, explains, and never offers Create", () => {
    const d = { ...grantsFixture(false), impersonating: true };
    const t = mountWith(d);
    expect(t.textContent).toContain("Grants can be read here but not changed");
    expect(t.querySelector('form[action*="/revoke"]')).toBeNull();
    expect([...t.querySelectorAll("button")].some((b) => b.textContent?.trim() === "Revoke")).toBe(false);
    expect(t.querySelector('form[action*="/create"]')).toBeNull();
  });
  it("offers Revoke and no explanation to an ordinary session", () => {
    const t = mountWith({ ...grantsFixture(), impersonating: false });
    expect(t.querySelector('form[action*="/revoke"]')).not.toBeNull();
    expect(t.textContent).not.toContain("Grants can be read here");
  });
});

describe("create form clarity", () => {
  it("labels the datetime controls, links the UTC hint, and says what keeps Create disabled", () => {
    const t = mountWith({ ...grantsFixture(), impersonating: false });
    for (const id of ["grant-starts", "grant-expires"]) {
      const input = t.querySelector<HTMLInputElement>("#" + id)!;
      expect(input.labels?.length).toBe(1);
      expect(t.querySelector("#" + input.getAttribute("aria-describedby"))!.textContent).toContain("UTC");
    }
    expect(t.textContent).toContain("To create a grant, choose: entryNode.");
    expect(t.querySelector("#grant-create-needs")).not.toBeNull();
  });
});

describe("refresh-failure recovery", () => {
  it("puts Refresh beside the message and marks the count possibly out of date", async () => {
    const t = mountWith(emptyProjection());
    await createAs(t, { ok: false });
    const alert = [...t.querySelectorAll('[role="alert"]')].find((a) =>
      a.textContent?.includes("could not refresh"),
    )!;
    expect(alert.querySelector("a")?.textContent).toBe("Refresh");
    expect(t.querySelector('nav[aria-label="Grant pages"]')!.textContent).toContain("may be out of date");
  });
});
