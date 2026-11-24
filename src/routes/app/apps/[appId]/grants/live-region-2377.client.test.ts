/**
 * portal#2344 / #2377: the Grants page's two loading lines ('Loading…' while the route's App is
 * not the one the data is for, 'Refreshing grants…' during a list read) are announced by regions
 * that exist before the state, hold the text during it, and are the same element after.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import Harness from "./Page.harness.svelte";
import { mountComponent, tick } from "$lib/test/mountComponent";
import { idleStatusRegions } from "$lib/test/firstPopulatedStatusText";
import { beginEnhanced } from "$lib/test/stubs/app-forms";
import { setStubPage, resetStubPage } from "$lib/test/stubs/app-stores";
import { resetNavigationCalls, resetNavigationGuards } from "$lib/test/stubs/app-navigation";
import { grantsFixture, fixtureGrant } from "./grants.fixture";

let mounted: ReturnType<typeof mountComponent> | undefined;
const payload = () => {
  const d = grantsFixture();
  return {
    appId: d.app.id, viewerId: d.viewerId, offset: 0, grants: d.grants, holders: d.holders,
    nodes: { "node-example": null }, actionDefinitions: d.actionDefinitions, actionDefinitionsFailed: false,
  };
};
const created = { type: "success" as const, status: 200, data: { grant: fixtureGrant, operation: "create", appId: "app-example" } };
const regionSaying = (text: string) =>
  [...mounted!.target.querySelectorAll<HTMLElement>('[role="status"]')].find((r) => r.textContent?.includes(text)) ?? null;

beforeEach(() => {
  setStubPage("http://localhost/app/apps/app-example/grants", { appId: "app-example" });
  resetNavigationCalls();
  resetNavigationGuards();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => payload() }));
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  resetStubPage();
  resetNavigationGuards();
});

it("'Loading…' (the data is for another App than the route) is one persistent region", async () => {
  mounted = mountComponent(Harness, { data: grantsFixture(), form: null } as never);
  const setData = (d: unknown) => { (mounted!.instance.setData as (d: never) => void)(d as never); flushSync(); };
  const idle = idleStatusRegions(mounted.target);
  expect(regionSaying("Loading…")).toBeNull();

  // The route moved to another App; the data on screen is still the first App's.
  setData({ ...grantsFixture(), routeRef: "app-other" });
  await tick(3);
  const during = regionSaying("Loading…");
  expect(during, "the line is announced").not.toBeNull();
  expect(idle).toContain(during);

  setData(grantsFixture());
  await tick(3);
  expect(regionSaying("Loading…")).toBeNull();
  expect(during!.isConnected).toBe(true);
  expect(during!.textContent?.trim()).toBe("");
});

it("'Refreshing grants…' (a held list read) is one persistent region", async () => {
  mounted = mountComponent(Harness, { data: grantsFixture(), form: null } as never);
  const form = mounted.target.querySelector<HTMLFormElement>('form[action*="/create"]')!;
  const setForm = (f: unknown) => { (mounted!.instance.setForm as (f: never) => void)(f as never); flushSync(); };
  const idle = idleStatusRegions(mounted.target);
  expect(regionSaying("Refreshing grants…")).toBeNull();

  let resolve!: (v: unknown) => void;
  vi.mocked(fetch).mockImplementationOnce(() => new Promise((r) => (resolve = r)) as never);
  const finish = await beginEnhanced(form, { update: async () => setForm(created.data) });
  const pending = finish(created);
  await tick(3);
  const during = regionSaying("Refreshing grants…");
  expect(during, "the line is announced").not.toBeNull();
  expect(idle).toContain(during);

  resolve({ ok: true, json: async () => payload() });
  await pending;
  flushSync();
  expect(regionSaying("Refreshing grants…")).toBeNull();
  expect(during!.isConnected).toBe(true);
  expect(during!.textContent?.trim()).toBe("");
});

it("'Grant created.' is announced by a region that was mounted before the create (portal#2581)", async () => {
  mounted = mountComponent(Harness, { data: grantsFixture(), form: null } as never);
  const form = mounted.target.querySelector<HTMLFormElement>('form[action*="/create"]')!;
  const setForm = (f: unknown) => { (mounted!.instance.setForm as (f: never) => void)(f as never); flushSync(); };
  const idle = idleStatusRegions(mounted.target);
  expect(regionSaying("Grant created.")).toBeNull();

  const finish = await beginEnhanced(form, { update: async () => setForm(created.data) });
  await finish(created);
  await tick(3);
  const region = regionSaying("Grant created.");
  expect(region, "the confirmation is announced").not.toBeNull();
  expect(idle, "by a region that existed, empty, before it").toContain(region);
});
