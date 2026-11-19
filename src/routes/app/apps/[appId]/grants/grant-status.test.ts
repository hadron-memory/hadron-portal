import { describe, expect, it } from "vitest";
import { render } from "svelte/server";
import Record from "./GrantRecord.svelte";
import { fixtureGrant } from "./grants.fixture";
const now = Date.parse("2026-11-13T01:00:00Z");
const past = "2026-11-12T11:00:00Z";
const future = "2026-12-01T00:00:00Z";
const row = (changes: object = {}, approvalStatus = true) =>
  render(Record, {
    props: {
      grant: { ...fixtureGrant, ...changes },
      approvalStatus,
      now,
    } as never,
  }).body;
describe("collapsed approval row states are named from server facts", () => {
  it("names a pending grant without requiring expanded details", () => {
    const html = row();
    expect(html).toContain("Waiting for approval");
    expect(html).not.toContain("Approved on");
    expect(html).not.toContain("Grant ID");
  });
  it("names pending pre-start status and its start without implying activation", () => {
    const html = row({ startsAt: future });
    expect(html).toContain("Waiting for approval");
    expect(html).toContain("Starts");
    expect(html).toContain(future);
    expect(html).not.toContain("Approved on");
  });
  it("names expired pending status without calling it signable", () => {
    const html = row({ expiresAt: past });
    expect(html).toContain("Expired on");
    expect(html).toContain(past);
    expect(html).toContain("cannot be approved");
    expect(html).not.toContain("Waiting for approval");
  });
  it.each([
    [{ activatedAt: past, allows: true }, "Approved on", past],
    [{ activatedAt: past, startsAt: future }, "Approved on", future],
    [{ revokedAt: past }, "Revoked at", past],
    [{ holderDepartedAt: past }, "Holder departed at", past],
  ])(
    "distinguishes a nonpending row from awaiting approval",
    (changes, label, stamp) => {
      const html = row(changes);
      expect(html).toContain(label);
      expect(html).toContain(stamp);
      expect(html).not.toContain("Waiting for approval");
    },
  );
  it("keeps approval status hints absent when signing is unavailable", () => {
    expect(row({}, false)).not.toContain("Waiting for approval");
    expect(row({ expiresAt: past }, false)).not.toContain("cannot be approved");
  });
});
