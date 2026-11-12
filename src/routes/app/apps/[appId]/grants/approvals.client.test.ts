import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import Page from "./Page.harness.svelte";
import { mountComponent, tick } from "$lib/test/mountComponent";
import { setStubPage, resetStubPage } from "$lib/test/stubs/app-stores";
import { grantsFixture, fixtureGrant } from "./grants.fixture";
let mounted: ReturnType<typeof mountComponent> | undefined;
const setup = (extra: Record<string, unknown> = {}) => {
  mounted = mountComponent(Page, {
    data: { ...grantsFixture(), ...extra },
    form: null,
  } as never);
  flushSync();
  return mounted.target;
};
const filter = (target: HTMLElement, value: string) => {
  const s = target.querySelector<HTMLSelectElement>(
    'select[aria-label="Show grants on this page"]',
  )!;
  expect(s).not.toBeNull();
  s.value = value;
  s.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
  setStubPage("http://localhost/app/apps/app-example/grants?offset=20", {
    appId: "app-example",
  });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  mounted?.unmount();
  mounted = undefined;
  vi.unstubAllGlobals();
  vi.useRealTimers();
  resetStubPage();
});
describe("App manager single-grant approval", () => {
  it("offers native exact-row Approve with new-tab disclosure and the current page offset", () => {
    const root = setup({ offset: 20 });
    const f = root.querySelector<HTMLFormElement>('form[action*="/approve"]');
    expect(f).not.toBeNull();
    expect(f!.getAttribute("action")).toBe("?/approve&offset=20");
    expect(f!.target).toBe("_blank");
    const rel = (f!.getAttribute("rel") ?? "").split(/\s+/);
    expect(rel).toContain("noopener");
    expect(rel).not.toContain("noreferrer");
    expect(f!.querySelector<HTMLInputElement>('[name="ref"]')!.value).toBe(
      fixtureGrant.id,
    );
    expect(f!.textContent).toContain("Approve");
    expect(root.textContent).toMatch(/new tab/);
  });
  it.each(["revokedAt", "holderDepartedAt", "activatedAt"])(
    "offers no Approve when %s is set even if allows is false",
    (key) => {
      const root = setup({
        grants: {
          items: [
            { ...fixtureGrant, [key]: "2026-11-12T11:00:00Z", allows: false },
          ],
          total: 1,
        },
      });
      expect(root.querySelector('form[action*="/approve"]')).toBeNull();
    },
  );
  it("shows the expiry fact without Approve; a future start remains signable", () => {
    const expired = {
      ...fixtureGrant,
      id: "expired",
      expiresAt: "2026-11-12T11:00:00Z",
    };
    const future = {
      ...fixtureGrant,
      id: "future",
      startsAt: "2026-12-01T00:00:00Z",
    };
    const root = setup({ grants: { items: [expired, future], total: 2 } });
    const forms = [
      ...root.querySelectorAll<HTMLFormElement>('form[action*="/approve"]'),
    ];
    expect(forms).toHaveLength(1);
    expect(
      forms[0].querySelector<HTMLInputElement>('[name="ref"]')!.value,
    ).toBe("future");
    expect(root.textContent).toContain("Expired on");
    expect(root.textContent).toContain("cannot be approved");
  });
  it("hides signing controls while the capability is off", () => {
    const root = setup({ signing: false });
    expect(root.querySelector('form[action*="/approve"]')).toBeNull();
  });
  it("keeps approval hints absent even for expired rows when signing is off", () => {
    const root = setup({
      signing: false,
      grants: {
        items: [{ ...fixtureGrant, expiresAt: "2026-11-12T11:00:00Z" }],
        total: 1,
      },
    });
    expect(root.textContent).not.toContain("cannot be approved");
    expect(root.textContent).not.toContain("server signing page");
    expect(root.querySelector('form[action*="/approve"]')).toBeNull();
  });

  it("keeps later pages reachable when the current page has no pending match", () => {
    const root = setup({
      grants: {
        items: Array.from({ length: 20 }, (_, i) => ({
          ...fixtureGrant,
          id: "page-one-" + i,
          activatedAt: "2026-11-12T11:00:00Z",
        })),
        total: 21,
      },
    });
    filter(root, "pending");
    expect(root.querySelectorAll("tbody tr")).toHaveLength(0);
    expect(root.textContent).toContain("No pending grants on this page.");
    expect(root.querySelector('a[href="?offset=20"]')).not.toBeNull();
    expect(root.textContent).not.toContain("No pending grants in this App");
    // The matching pending grant exists only in the later server page, not in
    // the first response; filtering must neither drain nor block that page.
    const next = {
      ...grantsFixture(),
      offset: 20,
      grants: {
        items: [{ ...fixtureGrant, id: "pending-on-page-two" }],
        total: 21,
      },
    };
    setStubPage("http://localhost/app/apps/app-example/grants?offset=20", {
      appId: "app-example",
    });
    (mounted!.instance.setData as (d: unknown) => void)(next);
    flushSync();
    expect(root.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(
      root.querySelector<HTMLInputElement>(
        'form[action*="/approve"] [name="ref"]',
      )!.value,
    ).toBe("pending-on-page-two");
    expect(
      root.querySelector('form[action="?/approve&offset=20"]'),
    ).not.toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("uses issuerUserId for approved-by-me, without widening the list", () => {
    const root = setup({
      grants: {
        items: [
          {
            ...fixtureGrant,
            id: "mine",
            issuerUserId: "person-example",
            activatedAt: "2026-11-12T10:01:00Z",
          },
          {
            ...fixtureGrant,
            id: "other",
            issuerUserId: "person-other",
            activatedAt: "2026-11-12T10:01:00Z",
          },
        ],
        total: 2,
      },
    });
    filter(root, "mine");
    expect(root.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("re-reads state on returning from a signing tab, without assuming activation", async () => {
    const d = grantsFixture();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          appId: d.app.id,
          viewerId: d.viewerId,
          offset: 0,
          grants: d.grants,
          holders: d.holders,
          nodes: { "node-example": null },
        }),
      ),
    );
    const root = setup();
    const f = root.querySelector<HTMLFormElement>('form[action*="/approve"]')!;
    expect(f).not.toBeNull();
    f.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event("focus"));
    await tick(8);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('form[action*="/approve"]')).not.toBeNull();
    expect(root.textContent).not.toContain("Approval succeeded");
  });
  it("shows the server-approved row only after a fresh read on return", async () => {
    const d = grantsFixture();
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          appId: d.app.id,
          viewerId: d.viewerId,
          offset: 0,
          grants: {
            items: [
              {
                ...fixtureGrant,
                activatedAt: "2026-11-12T12:00:01Z",
                issuerUserId: d.viewerId,
                allows: true,
              },
            ],
            total: 1,
          },
          holders: d.holders,
          nodes: { "node-example": null },
        }),
      ),
    );
    const root = setup();
    (mounted!.instance.setForm as (f: unknown) => void)({
      grant: fixtureGrant,
      appId: "app-example",
      operation: "create",
    });
    flushSync();
    root
      .querySelector<HTMLFormElement>('form[action*="/approve"]')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() =>
      expect(root.textContent).toContain("Allows now: Yes"),
    );
    expect(
      root.querySelector('section[aria-label="Request result"]')!.textContent,
    ).toContain("Allows now: Yes");
    expect(
      root.querySelector('section[aria-label="Request result"]')!.textContent,
    ).not.toContain("It needs a signature");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(root.querySelector('form[action*="/approve"]')).toBeNull();
  });
  it("does not claim Create or approval success if the return read fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );
    const root = setup();
    root
      .querySelector<HTMLFormElement>('form[action*="/approve"]')!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() =>
      expect(root.textContent).toContain("The grants could not refresh."),
    );
    expect(root.textContent).not.toContain("Grant created");
    expect(root.querySelector('form[action*="/approve"]')).not.toBeNull();
  });
  it("stops offering Approve when the pending grant expires while the page is open", async () => {
    const root = setup({
      grants: {
        items: [{ ...fixtureGrant, expiresAt: "2026-11-12T12:00:02Z" }],
        total: 1,
      },
    });
    expect(root.querySelector('form[action*="/approve"]')).not.toBeNull();
    await vi.advanceTimersByTimeAsync(3000);
    flushSync();
    expect(root.querySelector('form[action*="/approve"]')).toBeNull();
    expect(root.textContent).toContain("Expired on");
  });
});
