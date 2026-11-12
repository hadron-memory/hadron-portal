import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import Harness from "./Page.harness.svelte";
import { mountComponent, tick } from "$lib/test/mountComponent";
import { beginEnhanced, submitEnhanced } from "$lib/test/stubs/app-forms";
import { setStubPage, resetStubPage } from "$lib/test/stubs/app-stores";
import {
  navigationCalls,
  navigationGuards,
  resetNavigationCalls,
  resetNavigationGuards,
} from "$lib/test/stubs/app-navigation";
import { grantsFixture, fixtureGrant } from "./grants.fixture";
let mounted: ReturnType<typeof mountComponent> | undefined;
const data = () => grantsFixture();
const payload = () => {
  const d = data();
  return {
    appId: d.app.id,
    viewerId: d.viewerId,
    offset: 0,
    grants: d.grants,
    holders: d.holders,
    nodes: { "node-example": null },
  };
};
const result = {
  type: "success" as const,
  status: 200,
  data: { grant: fixtureGrant, operation: "create", appId: "app-example" },
};
const setData = (d: unknown) => {
  (mounted!.instance.setData as (d: never) => void)(d as never);
  flushSync();
};
const setForm = (f: unknown) => {
  (mounted!.instance.setForm as (f: never) => void)(f as never);
  flushSync();
};
const setup = (d = data()) => {
  mounted = mountComponent(Harness, { data: d, form: null } as never);
  return mounted.target.querySelector<HTMLFormElement>(
    'form[action*="/create"]',
  )!;
};
const nav = () => {
  const g = navigationGuards.find((g) => g.fn === "beforeNavigate")!;
  (g.callback as () => void)();
  flushSync();
};
beforeEach(() => {
  setStubPage("http://localhost/app/apps/app-example/grants", {
    appId: "app-example",
  });
  resetNavigationCalls();
  resetNavigationGuards();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => payload() }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  resetStubPage();
  resetNavigationGuards();
});
describe("confirmed Create owns its list read", () => {
  it("acknowledges before a held read, keeps a new draft and applies the fresh list without navigation", async () => {
    const form = setup();
    let resolve!: (v: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise((r) => (resolve = r)) as never,
    );
    const finish = await beginEnhanced(form, {
      update: async () => setForm(result.data),
    });
    const pending = finish(result);
    await tick(3);
    expect(mounted!.target.textContent).toContain("Grant created.");
    expect(mounted!.target.textContent).toContain("Refreshing grants…");
    const reason = form.querySelector<HTMLTextAreaElement>('[name="reason"]')!;
    reason.value = "Next draft";
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    const b = payload();
    b.grants = {
      ...b.grants,
      items: [{ ...fixtureGrant, action: "fresh.list.receipt" }],
    };
    resolve({ ok: true, json: async () => b });
    await pending;
    flushSync();
    expect(mounted!.target.textContent).toContain("fresh.list.receipt");
    expect(reason.value).toBe("Next draft");
    expect(navigationCalls).toHaveLength(0);
  });
  it.each(["HTTP", "JSON"])(
    "retains the confirmation, rows and draft on a %s failure",
    async (kind) => {
      const form = setup();
      vi.mocked(fetch).mockResolvedValueOnce(new Response("invalid JSON", { status: kind === "HTTP" ? 503 : 200 }));
      await (
        await beginEnhanced(form, { update: async () => setForm(result.data) })
      )(result);
      flushSync();
      expect(mounted!.target.textContent).toContain("Grant created.");
      expect(mounted!.target.textContent).toContain(
        "Grant created, but the list could not refresh",
      );
      expect(mounted!.target.querySelectorAll("tbody tr")).toHaveLength(1);
      expect(navigationCalls).toHaveLength(0);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );
  it("discards an old read after navigating away and back, even with the same original data object", async () => {
    const a = data();
    const form = setup(a);
    let resolve!: (v: unknown) => void;
    let signal: AbortSignal;
    vi.mocked(fetch).mockImplementationOnce((_u, opts) => {
      signal = opts!.signal as AbortSignal;
      return new Promise((r) => (resolve = r)) as never;
    });
    const pending = (
      await beginEnhanced(form, { update: async () => setForm(result.data) })
    )(result);
    await tick(3);
    nav();
    setStubPage("http://localhost/app/apps/app-other/grants", {
      appId: "app-other",
    });
    setData({
      ...a,
      routeRef: "app-other",
      app: { ...a.app, id: "app-other", urn: "hrn:app:example.test:other" },
      grants: { items: [], total: 0 },
      holders: {},
      nodes: {},
      choices: { failed: false, workers: [], agents: [] },
    });
    setForm(null);
    nav();
    setStubPage("http://localhost/app/apps/app-example/grants", {
      appId: "app-example",
    });
    setData(a);
    const stale = payload();
    stale.grants = {
      ...stale.grants,
      items: [{ ...fixtureGrant, action: "STALE-READ" }],
    };
    resolve({ ok: true, json: async () => stale });
    await pending;
    await tick(3);
    expect(signal!.aborted).toBe(true);
    expect(mounted!.target.textContent).not.toContain("STALE-READ");
    expect(mounted!.target.textContent).not.toContain("could not refresh");
    expect(navigationCalls).toHaveLength(0);
  });
  it("a newer same-owner loader result wins while preserving the draft", async () => {
    const a = data();
    const form = setup(a);
    let resolve!: (v: unknown) => void;
    vi.mocked(fetch).mockImplementationOnce(
      () => new Promise((r) => (resolve = r)) as never,
    );
    const pending = (
      await beginEnhanced(form, { update: async () => setForm(result.data) })
    )(result);
    await tick(3);
    const reason = form.querySelector<HTMLTextAreaElement>('[name="reason"]')!;
    reason.value = "new draft after acknowledgement";
    reason.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    setData({
      ...a,
      app: { ...a.app },
      grants: { items: [{ ...fixtureGrant, action: "NEW-LOADER" }], total: 1 },
    });
    const stale = payload();
    stale.grants = {
      ...stale.grants,
      items: [{ ...fixtureGrant, action: "OLD-READ" }],
    };
    resolve({ ok: true, json: async () => stale });
    await pending;
    flushSync();
    expect(mounted!.target.textContent).toContain("NEW-LOADER");
    expect(mounted!.target.textContent).not.toContain("OLD-READ");
    expect(reason.value).toBe("new draft after acknowledgement");
    expect(mounted!.target.textContent).not.toContain("Refreshing grants…");
  });
  it("blocks a conflicting Create only while a row write owns its receipt", async () => {
    const form = setup();
    const row = mounted!.target.querySelector("tbody tr")!;
    const finish = await beginEnhanced(row.querySelector("form")!);
    flushSync();
    expect((await submitEnhanced(form)).cancelled).toBe(true);
    await finish({
      type: "success",
      status: 200,
      data: { grant: { ...fixtureGrant, revokedAt: "2026-11-12T12:00:00Z" } },
    });
    flushSync();
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });
});
