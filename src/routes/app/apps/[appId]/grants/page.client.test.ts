import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import Page from "./+page.svelte";
import { mountComponent } from "$lib/test/mountComponent";
import { beginEnhanced, submitEnhanced } from "$lib/test/stubs/app-forms";
import { setStubPage, resetStubPage } from "$lib/test/stubs/app-stores";
import {
  navigationCalls,
  resetNavigationGuards,
  navigationHooks,
  resetNavigationCalls,
} from "$lib/test/stubs/app-navigation";
import { grantsFixture, fixtureGrant } from "./grants.fixture";
let mounted: ReturnType<typeof mountComponent> | undefined;
beforeEach(() => {
  setStubPage("http://localhost/app/apps/app-example/grants", {
    appId: "app-example",
  });
  resetNavigationCalls();
  resetNavigationGuards();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => listFixture() }),
  );
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  resetStubPage();
  vi.unstubAllGlobals();
  resetNavigationCalls();
});
const setup = () => {
  mounted = mountComponent(Page, {
    data: grantsFixture(),
    form: null,
  } as never);
  flushSync();
  return mounted.target.querySelector<HTMLFormElement>(
    'form[action*="/create"]',
  )!;
};
const listFixture = () => {
  const d = grantsFixture();
  return {
    appId: d.app.id,
    viewerId: "person-example",
    offset: 0,
    grants: d.grants,
    holders: d.holders,
    nodes: { "node-example": null },
  };
};
const success = {
  type: "success" as const,
  status: 200,
  data: { grant: fixtureGrant, operation: "create", appId: "app-example" },
};
describe("Grants create response boundary", () => {
  it("keeps values on failure and prevents duplicate submits while waiting", async () => {
    const form = setup();
    const update = vi.fn(async () => {});
    const finish = await beginEnhanced(form, { update });
    expect((await submitEnhanced(form)).cancelled).toBe(true);
    await finish({
      type: "failure",
      status: 400,
      data: { error: "Choose a holder" },
    });
    expect(update).toHaveBeenCalledWith({ reset: false, invalidateAll: false });
    expect(navigationCalls).toHaveLength(0);
    expect((await submitEnhanced(form)).cancelled).toBe(false);
  });
  it.each([undefined, "error"])(
    "shows fixed feedback for a non-action %s response without replay",
    async (type) => {
      const form = setup();
      const reason = form.querySelector<HTMLInputElement>('[name="reason"]')!;
      reason.value = "Keep this draft";
      const update = vi.fn(async () => {});
      await (
        await beginEnhanced(form, { update })
      )({ type, status: 403, error: { message: "raw proxy secret" } } as never);
      flushSync();
      expect(mounted!.target.textContent).toContain(
        "The grant request could not be completed. Refresh before trying again.",
      );
      expect(mounted!.target.textContent).not.toContain("raw proxy secret");
      expect(reason.value).toBe("Keep this draft");
      expect(update).not.toHaveBeenCalled();
      expect(navigationCalls).toHaveLength(0);
    },
  );
  it("applies successful response before refreshing and reports a failed refresh without replay", async () => {
    const form = setup();
    const update = vi.fn(async () => {});
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await (
      await beginEnhanced(form, { update })
    )(success);
    flushSync();
    expect(update).toHaveBeenCalledWith({ reset: true, invalidateAll: false });
    expect(mounted!.target.textContent).toContain(
      "Grant created, but the list could not refresh",
    );
    expect(navigationCalls).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["unmount", "App change"])(
    "ignores a response after %s",
    async (kind) => {
      const form = setup();
      const update = vi.fn(async () => {});
      const finish = await beginEnhanced(form, { update });
      if (kind === "unmount") {
        mounted!.unmount();
        mounted = undefined;
      } else
        setStubPage("http://localhost/app/apps/other/grants", {
          appId: "other",
        });
      await finish(success);
      expect(update).not.toHaveBeenCalled();
      expect(navigationCalls).toHaveLength(0);
    },
  );
});

describe("inline grant revoke", () => {
  it("focuses Cancel, shows the returned row in place and exposes detail state", async () => {
    setup();
    const row = mounted!.target.querySelector("tbody tr")!;
    (row.querySelector("form button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    flushSync();
    expect(document.activeElement?.textContent).toBe("Cancel");
    const form = row.querySelector<HTMLFormElement>("form")!;
    const finish = await beginEnhanced(form);
    await finish({
      type: "success",
      status: 200,
      data: { grant: { ...fixtureGrant, revokedAt: "2026-11-12T12:00:00Z" } },
    });
    flushSync();
    expect(row.textContent).toContain("Revoked at 2026-11-12T12:00:00Z");
    expect(document.activeElement?.textContent).toBe("Revoke");
    const details = row.querySelector<HTMLButtonElement>(
      "button[aria-expanded]",
    )!;
    expect(details.getAttribute("aria-expanded")).toBe("false");
    details.click();
    flushSync();
    expect(details.getAttribute("aria-expanded")).toBe("true");
    expect(row.textContent).toContain("2026-11-12T12:00:00Z");
    const repeat = await beginEnhanced(form);
    await repeat({
      type: "success",
      status: 200,
      data: {
        grant: { ...fixtureGrant, revokedAt: "2026-11-12T12:00:00Z" },
        alreadyRevoked: true,
      },
    });
    flushSync();
    expect(row.textContent).toContain(
      "Already revoked at 2026-11-12T12:00:00Z",
    );
  });
});

describe("grant page search", () => {
  it("filters the actual rows and can restore a match by reason", () => {
    setup();
    const root = mounted!.target;
    const toggle = [...root.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Search, views"),
    )!;
    toggle.click();
    flushSync();
    const input = root.querySelector<HTMLInputElement>(
      'input[aria-label="Search grants on this page"]',
    )!;
    input.value = "no-such-grant";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(root.querySelectorAll("tbody tr")).toHaveLength(0);
    input.value = "daily documentation";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(root.querySelectorAll("tbody tr")).toHaveLength(1);
  });
});

describe("returned grant rows survive table filtering", () => {
  it("keeps the revoked timestamp after the row unmounts and remounts", async () => {
    setup();
    let row = mounted!.target.querySelector("tbody tr")!;
    await (
      await beginEnhanced(row.querySelector("form")!)
    )({
      type: "success",
      status: 200,
      data: { grant: { ...fixtureGrant, revokedAt: "2026-11-12T12:34:00Z" } },
    });
    flushSync();
    const root = mounted!.target;
    [...root.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Search, views"))!
      .click();
    flushSync();
    const input = root.querySelector<HTMLInputElement>(
      'input[aria-label="Search grants on this page"]',
    )!;
    input.value = "no-such-grant";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    expect(root.querySelectorAll("tbody tr")).toHaveLength(0);
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    flushSync();
    row = root.querySelector("tbody tr")!;
    (row.querySelector("button[aria-expanded]") as HTMLButtonElement).click();
    flushSync();
    expect(row.textContent).toContain("2026-11-12T12:34:00Z");
  });
});

it("shows the picked holder URN once below its native choice", () => {
  const form = setup();
  expect(form.textContent).not.toContain("example.test:team:docs");
  const select = form.querySelector<HTMLSelectElement>(
    'select[name="holder"]',
  )!;
  select.value = "WORKER:worker-example";
  select.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
  expect(form.textContent).toContain("example.test:team:docs");
});

it("enforces the reason limit by code point and explains an oversized draft", () => {
  const form = setup();
  const input = form.querySelector<HTMLTextAreaElement>('[name="reason"]')!;
  input.value = "a".repeat(2001);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  expect(input.checkValidity()).toBe(false);
  expect(input.validationMessage).toBe(
    "Use at most 2000 characters for the reason.",
  );
  expect(form.textContent).toContain(
    "Use at most 2000 characters for the reason.",
  );
  input.value = "😀".repeat(2000);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
  expect(input.checkValidity()).toBe(true);
});

it("reports the unchanged holder-departure end without claiming a new revocation", async () => {
  setup();
  const row = mounted!.target.querySelector("tbody tr")!;
  await (
    await beginEnhanced(row.querySelector("form")!)
  )({
    type: "success",
    status: 200,
    data: {
      grant: {
        ...fixtureGrant,
        revokedAt: null,
        holderDepartedAt: "2026-11-12T12:00:00Z",
      },
      alreadyRevoked: false,
    },
  });
  flushSync();
  expect(row.textContent).toContain(
    "No change. Holder departed at 2026-11-12T12:00:00Z.",
  );
  expect(row.textContent).not.toContain("Revoked at");
});
