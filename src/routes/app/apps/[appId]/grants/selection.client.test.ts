import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushSync } from "svelte";
import Page from "./Page.harness.svelte";
import { mountComponent } from "$lib/test/mountComponent";
import { setStubPage, resetStubPage } from "$lib/test/stubs/app-stores";
import { beginEnhanced, submitEnhancedWithResult } from "$lib/test/stubs/app-forms";
import { grantsFixture, fixtureGrant } from "./grants.fixture";
let mounted: ReturnType<typeof mountComponent> | undefined;
const grant = (id: string, over: Record<string, unknown> = {}) => ({ ...fixtureGrant, id, reason: `reason ${id}`, ...over });
const three = [grant("g1"), grant("g2"), grant("g3")];
const setup = (extra: Record<string, unknown> = {}) => {
  mounted = mountComponent(Page, { data: { ...grantsFixture(), grants: { items: three, total: 3 }, ...extra }, form: null } as never);
  flushSync();
  return mounted.target;
};
const boxes = (root: HTMLElement) => [...root.querySelectorAll<HTMLInputElement>("tbody input[type=checkbox]")];
const signBtn = (root: HTMLElement) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Sign selected") as HTMLButtonElement | undefined;
const selectionForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action*="signSelection"]')!;
const tick = (el: HTMLInputElement, on: boolean) => { el.checked = on; el.dispatchEvent(new Event("change", { bubbles: true })); flushSync(); };
const CEREMONY = "https://signing.example.test/grant-selection-signing/abc123";
const opened = (root: HTMLElement) => submitEnhancedWithResult(selectionForm(root), { type: "success", status: 200, data: { operation: "signSelection", selection: { id: "sel1", ceremonyUrl: CEREMONY, expiresAt: "x", refs: ["g1", "g2"] } } });
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-12T12:00:00Z"));
  setStubPage("http://localhost/app/apps/app-example/grants?offset=0", { appId: "app-example" });
  vi.stubGlobal("fetch", vi.fn());
  vi.spyOn(window, "open").mockReturnValue(null);
  vi.spyOn(HTMLFormElement.prototype, "requestSubmit").mockImplementation(() => {});
});
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); resetStubPage(); });
describe("selecting several pending grants (portal#2638 item 1)", () => {
  it("offers a checkbox on each signable row and Sign selected, disabled until something is selected", () => {
    const root = setup();
    expect(boxes(root)).toHaveLength(3);
    expect(signBtn(root)!.disabled).toBe(true);
    tick(boxes(root)[0], true); tick(boxes(root)[2], true);
    expect(signBtn(root)!.disabled).toBe(false);
    expect(root.textContent).toContain("2 selected");
  });
  it("sends exactly the selected refs, as repeated form fields", () => {
    const root = setup();
    tick(boxes(root)[0], true); tick(boxes(root)[2], true);
    const refs = [...selectionForm(root).querySelectorAll<HTMLInputElement>('input[name="ref"]')].map((i) => i.value);
    expect(refs).toEqual(["g1", "g3"]);
    expect(selectionForm(root).getAttribute("action")).toBe("?/signSelection&offset=0");
  });
  it("select all covers every signable row on the page and nothing else", () => {
    const root = setup({ grants: { items: [grant("g1"), grant("g2", { activatedAt: "2026-11-01T00:00:00Z" }), grant("g3", { expiresAt: "2026-11-01T00:00:00Z" }), grant("g4", { revokedAt: "2026-11-01T00:00:00Z" })], total: 4 } });
    expect(boxes(root)).toHaveLength(1);
    const all = root.querySelector<HTMLInputElement>('section input[type=checkbox]')!;
    tick(all, true);
    expect([...selectionForm(root).querySelectorAll<HTMLInputElement>('input[name="ref"]')].map((i) => i.value)).toEqual(["g1"]);
  });
  it("keeps the per-grant Approve unchanged beside the selection", () => {
    const root = setup();
    expect(root.querySelectorAll('form[action="?/approve&offset=0"]')).toHaveLength(3);
  });
  it("offers no selection without signing, or while impersonating", () => {
    for (const extra of [{ signing: false }, { impersonating: true }]) {
      const root = setup(extra);
      expect(boxes(root)).toHaveLength(0); expect(signBtn(root)).toBeUndefined();
      mounted!.unmount(); mounted = undefined;
    }
  });
  it("a refresh that retires a selected grant stops sending it", () => {
    const root = setup(); tick(boxes(root)[0], true); tick(boxes(root)[1], true);
    (mounted!.instance.setData as (d: unknown) => void)({ ...grantsFixture(), grants: { items: [grant("g1", { activatedAt: "2026-11-12T11:00:00Z" }), grant("g2")], total: 2 } });
    flushSync();
    expect([...selectionForm(root).querySelectorAll<HTMLInputElement>('input[name="ref"]')].map((i) => i.value)).toEqual(["g2"]);
  });
});
describe("after the server answers (items 2, 3, 4, 5)", () => {
  it("opens the server's link in a new tab, unmodified, and keeps the way to open it again", async () => {
    const root = setup(); tick(boxes(root)[0], true); tick(boxes(root)[1], true);
    await opened(root); flushSync();
    expect(window.open).toHaveBeenCalledWith(CEREMONY, "_blank", "noopener");
    const link = [...root.querySelectorAll("a")].find((a) => a.textContent?.includes("Open the signing page"))!;
    expect(link.getAttribute("href")).toBe(CEREMONY); expect(link.getAttribute("rel")).toContain("noopener");
  });
  it("shows the server's refusal in words, keeps the selection, and does not re-send on its own", async () => {
    const root = setup(); tick(boxes(root)[0], true); tick(boxes(root)[1], true);
    await submitEnhancedWithResult(selectionForm(root), { type: "failure", status: 400, data: { operation: "signSelection", error: "A selection can name at most 7 grants." } });
    flushSync();
    expect(root.querySelector("[role=alert]")!.textContent).toBe("A selection can name at most 7 grants.");
    expect(boxes(root).filter((b) => b.checked)).toHaveLength(2);
    expect(window.open).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("withdraws the open selection and says so", async () => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    const form = root.querySelector<HTMLFormElement>('form[action*="withdrawSelection"]')!;
    expect(form.querySelector<HTMLInputElement>('input[name="id"]')!.value).toBe("sel1");
    await submitEnhancedWithResult(form, { type: "success", status: 200, data: { operation: "withdrawSelection", withdrawn: "sel1" } });
    flushSync();
    expect(root.textContent).toContain("Selection withdrawn.");
    expect(root.querySelector('form[action*="withdrawSelection"]')).toBeNull();
  });
  it("a refused withdraw shows the server's message and leaves the selection open", async () => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('form[action*="withdrawSelection"]')!, { type: "failure", status: 400, data: { operation: "withdrawSelection", error: "That selection has ended." } });
    flushSync();
    expect(root.querySelector("[role=alert]")!.textContent).toBe("That selection has ended.");
    expect(root.querySelector('form[action*="withdrawSelection"]')).not.toBeNull();
  });
});
describe("what the page offers as visible (portal#2648 reviews)", () => {
  it("Select all counts and sends only the rows the search leaves visible", () => {
    const root = setup();
    const search = root.querySelector<HTMLInputElement>('input[aria-label="Search grants on this page"]')!;
    search.value = "reason g2"; search.dispatchEvent(new Event("input", { bubbles: true })); flushSync();
    expect(boxes(root)).toHaveLength(1);
    tick(root.querySelector<HTMLInputElement>("section input[type=checkbox]")!, true);
    expect([...selectionForm(root).querySelectorAll<HTMLInputElement>('input[name="ref"]')].map((i) => i.value)).toEqual(["g2"]);
    expect(root.textContent).toContain("1 selected");
  });
  it("a row ticked and then hidden by the search is not sent", () => {
    const root = setup(); tick(boxes(root)[0], true);
    const search = root.querySelector<HTMLInputElement>('input[aria-label="Search grants on this page"]')!;
    search.value = "reason g3"; search.dispatchEvent(new Event("input", { bubbles: true })); flushSync();
    expect(selectionForm(root).querySelectorAll('input[name="ref"]')).toHaveLength(0);
  });
  it("each row's checkbox names its grant", () => {
    const root = setup();
    expect(boxes(root).map((b) => b.getAttribute("aria-label"))).toEqual(["Select to sign together: reason g1", "Select to sign together: reason g2", "Select to sign together: reason g3"]);
  });
  it("moving to another App's grants drops the open selection and its Withdraw", async () => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    expect(root.querySelector('form[action*="withdrawSelection"]')).not.toBeNull();
    setStubPage("http://localhost/app/apps/app-other/grants?offset=0", { appId: "app-other" });
    (mounted!.instance.setData as (d: unknown) => void)({ ...grantsFixture(), routeRef: "app-other", app: { ...grantsFixture().app, id: "app-other" }, grants: { items: [grant("o1")], total: 1 } });
    flushSync();
    expect(root.querySelector('form[action*="withdrawSelection"]')).toBeNull();
    expect(root.textContent).not.toContain("opened in a new tab");
  });
  it("Check result reads the list again and states each grant's own result: two approved, one still waiting", async () => {
    const d = grantsFixture();
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ appId: d.app.id, viewerId: d.viewerId, offset: 0, grants: { items: [grant("g1", { activatedAt: "2026-11-12T12:00:01Z" }), grant("g2", { activatedAt: "2026-11-12T12:00:02Z" }), grant("g3")], total: 3 }, holders: d.holders, nodes: { "node-example": null }, actionDefinitions: d.actionDefinitions, actionDefinitionsFailed: false })));
    const root = setup(); tick(boxes(root)[0], true); tick(boxes(root)[1], true); tick(boxes(root)[2], true);
    await submitEnhancedWithResult(selectionForm(root), { type: "success", status: 200, data: { operation: "signSelection", selection: { id: "sel1", ceremonyUrl: CEREMONY, expiresAt: "x", refs: ["g1", "g2", "g3"] } } });
    flushSync();
    expect(root.textContent).not.toContain("still waiting");
    [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Check result")!.click();
    await vi.waitFor(() => { flushSync(); expect(root.textContent).toContain("2 approved, 1 still waiting"); });
    expect(root.textContent).not.toMatch(/all (the )?(grants )?(were |are )?approved/i);
  });
});
describe("keyboard focus after the result (portal#2648 QA)", () => {
  it("lands on the signing-page link after Sign selected", async () => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); await Promise.resolve(); flushSync();
    await vi.waitFor(() => { expect(document.activeElement?.tagName).toBe("A"); expect(document.activeElement?.textContent?.trim()).toBe("Open the signing page"); });
  });
  it.each(["withdraw", "dismiss"])("lands on Select all after %s", async (how) => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    if (how === "withdraw") await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('form[action*="withdrawSelection"]')!, { type: "success", status: 200, data: { operation: "withdrawSelection", withdrawn: "sel1" } });
    else [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Dismiss")!.click();
    await vi.waitFor(() => expect((document.activeElement as HTMLInputElement | null)?.closest("label")?.textContent).toContain("Select all pending"));
  });
  it("with no row left to sign, focus lands on the section title, not the page body", async () => {
    const root = setup({ grants: { items: [grant("g1")], total: 1 } }); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    (mounted!.instance.setData as (d: unknown) => void)({ ...grantsFixture(), grants: { items: [grant("g1", { activatedAt: "2026-11-12T11:59:00Z" })], total: 1 } });
    flushSync();
    await submitEnhancedWithResult(root.querySelector<HTMLFormElement>('form[action*="withdrawSelection"]')!, { type: "success", status: 200, data: { operation: "withdrawSelection", withdrawn: "sel1" } });
    await vi.waitFor(() => { expect(document.activeElement?.tagName).toBe("H2"); expect(document.activeElement?.textContent).toBe("Sign several grants"); });
    expect(root.textContent).toContain("Selection withdrawn.");
  });
  it("Dismiss with no row left to sign puts focus on the page's grant filter, not the body", async () => {
    const root = setup({ grants: { items: [grant("g1")], total: 1 } }); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    (mounted!.instance.setData as (d: unknown) => void)({ ...grantsFixture(), grants: { items: [grant("g1", { activatedAt: "2026-11-12T11:59:00Z" })], total: 1 } });
    flushSync();
    [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Dismiss")!.click();
    await vi.waitFor(() => { expect(document.activeElement?.tagName).toBe("SELECT"); expect(document.activeElement?.getAttribute("aria-label")).toBe("Show grants on this page"); });
    expect(root.textContent).not.toContain("Sign several grants");
  });
  it("an empty reason names the checkbox by the action instead", () => {
    const root = setup({ grants: { items: [grant("g1", { reason: "" })], total: 1 } });
    expect(boxes(root)[0].getAttribute("aria-label")).toBe("Select to sign together: schedule.create");
  });
  it("shows the section's own visible title", () => {
    expect(setup().querySelector("section h2")?.textContent).toBe("Sign several grants");
  });
});
describe("the selection's own state (portal#2650)", () => {
  const stateForm = (root: HTMLElement) => root.querySelector<HTMLFormElement>('form[action*="readSelection"]')!;
  const withdrawForm = (root: HTMLElement) => root.querySelector('form[action*="withdrawSelection"]');
  const answer = (root: HTMLElement, data: Record<string, unknown>, type: "success" | "failure" = "success") => submitEnhancedWithResult(stateForm(root), { type, status: type === "success" ? 200 : 400, data: { operation: "readSelection", id: "sel1", ...data } });
  const listBody = (items: unknown[]) => { const d = grantsFixture(); return new Response(JSON.stringify({ appId: d.app.id, viewerId: d.viewerId, offset: 0, grants: { items, total: items.length }, holders: d.holders, nodes: { "node-example": null }, actionDefinitions: d.actionDefinitions, actionDefinitionsFailed: false })); };
  const check = (root: HTMLElement) => [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Check result")!.click();
  it.each([["DECLINED", "was declined"], ["EXPIRED", "expired"], ["WITHDRAWN", "was withdrawn"]])("%s elsewhere: says so, offers no Withdraw, and no longer says anything is still waiting", async (state, word) => {
    const root = setup(); tick(boxes(root)[0], true); tick(boxes(root)[1], true);
    await opened(root); flushSync();
    expect(withdrawForm(root)).not.toBeNull();
    await answer(root, { state }); flushSync();
    expect(root.textContent).toContain(`The signing request ${word}.`);
    expect(withdrawForm(root)).toBeNull();
    expect(root.textContent).not.toContain("still waiting");
  });
  it("COMPLETED offers no Withdraw either, and still counts each grant", async () => {
    vi.mocked(fetch).mockResolvedValue(listBody([grant("g1", { activatedAt: "2026-11-12T12:00:01Z" }), grant("g2"), grant("g3")]));
    const root = setup(); tick(boxes(root)[0], true); tick(boxes(root)[1], true);
    await opened(root); flushSync();
    check(root);
    await vi.waitFor(() => { flushSync(); expect(root.textContent).toContain("1 approved, 1 still waiting"); });
    await answer(root, { state: "COMPLETED" }); flushSync();
    expect(withdrawForm(root)).toBeNull();
    expect(root.textContent).toContain("The signing request is complete.");
  });
  it("an OPEN selection keeps Withdraw", async () => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    await answer(root, { state: "OPEN" }); flushSync();
    expect(withdrawForm(root)).not.toBeNull();
    expect(root.textContent).not.toContain("The signing request");
  });
  it.each([["a failed read", { error: "nope" }, "failure" as const], ["a null state", { state: null }, "success" as const], ["an unknown word", { state: "STALE" }, "success" as const]])("%s claims no end", async (_n, data, type) => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    await answer(root, data, type); flushSync();
    expect(withdrawForm(root)).not.toBeNull();
    expect(root.textContent).not.toContain("The signing request");
    expect(root.querySelector("[role=alert]")).toBeNull();
  });
  it("an answer for another selection is ignored", async () => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    await answer(root, { id: "other", state: "DECLINED" }); flushSync();
    expect(withdrawForm(root)).not.toBeNull();
  });
  it("a late answer after Dismiss does not come back with the next selection", async () => {
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    const late = await beginEnhanced(stateForm(root));
    [...root.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Dismiss")!.click(); flushSync();
    tick(boxes(root)[0], true);
    await opened(root); flushSync();
    await late({ type: "success", status: 200, data: { operation: "readSelection", id: "sel1", state: "DECLINED" } }); flushSync();
    expect(withdrawForm(root)).not.toBeNull();
  });
  it("a list read that completes after the request resolved asks for the selection's state", async () => {
    vi.mocked(fetch).mockResolvedValue(listBody(three));
    const asked = vi.mocked(HTMLFormElement.prototype.requestSubmit);
    const root = setup(); tick(boxes(root)[0], true);
    await opened(root); flushSync();
    expect(asked).not.toHaveBeenCalled();
    check(root);
    await vi.waitFor(() => { flushSync(); expect(asked).toHaveBeenCalledTimes(1); });
    expect(asked.mock.contexts[0]).toBe(stateForm(root));
  });
  it("a list read that started while the request was still pending does not mark the selection fresh", async () => {
    let finish!: (r: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise<Response>((r) => { finish = r; }));
    const asked = vi.mocked(HTMLFormElement.prototype.requestSubmit);
    const root = setup(); tick(boxes(root)[0], true); tick(boxes(root)[1], true);
    // A row's own ceremony is awaited, so a focus return reads the list while Sign selected is still out.
    root.querySelector<HTMLFormElement>('form[action*="/approve"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    const deliver = await beginEnhanced(selectionForm(root));
    window.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await deliver({ type: "success", status: 200, data: { operation: "signSelection", selection: { id: "sel1", ceremonyUrl: CEREMONY, expiresAt: "x", refs: ["g1", "g2"] } } });
    flushSync();
    finish(listBody([grant("g1", { activatedAt: "2026-11-12T12:00:01Z" }), grant("g2", { activatedAt: "2026-11-12T12:00:02Z" }), grant("g3")]));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    flushSync();
    expect(root.textContent).toContain("opened in a new tab");
    expect(root.textContent).not.toContain("approved,");
    expect(asked).not.toHaveBeenCalled();
  });
  it("announces that the signing page opened through the section's live region", async () => {
    const root = setup(); tick(boxes(root)[0], true); tick(boxes(root)[1], true);
    await opened(root); flushSync();
    const region = [...root.querySelectorAll('section [role=status]')].find((r) => r.textContent?.includes("opened in a new tab"));
    expect(region?.textContent).toContain("The signing page for 2 grants opened in a new tab.");
  });
});
