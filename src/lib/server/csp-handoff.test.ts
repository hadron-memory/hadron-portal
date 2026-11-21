import { describe, it, expect } from "vitest";
import { appendPublicServerFormAction } from "./csp";
const HEADER =
  "default-src 'self'; script-src 'self' 'nonce-known'; connect-src 'self' http://private.synthetic.test:4000; form-action 'self'; frame-ancestors 'none'";
describe("native server ceremony handoff runtime CSP", () => {
  it("allows only the public server origin for form redirects and preserves other directives/nonces", () => {
    expect(
      appendPublicServerFormAction(
        HEADER,
        "https://ceremony.synthetic.test/a/path",
      ),
    ).toBe(
      "default-src 'self'; script-src 'self' 'nonce-known'; connect-src 'self' http://private.synthetic.test:4000; form-action 'self' https://ceremony.synthetic.test; frame-ancestors 'none'",
    );
  });
  it.each([
    undefined,
    "",
    "*",
    "https://*.synthetic.test",
    "javascript:alert(1)",
    "https://fixture:fixture@api.synthetic.test",
    "https://one.test https://two.test",
  ])("does not widen policy for unsupported config %s", (raw) => {
    expect(appendPublicServerFormAction(HEADER, raw)).toBe(HEADER);
  });
  // portal#2084 §10 F2: URL parsing keeps ; , ' and percent-encoded forms of them in a special-scheme
  // host, and the serialized origin is spliced into a header whose directives are split on ';'.
  it.each([
    "https://a;script-src.example",
    "https://a,b.example",
    "https://a'b.example",
    "https://a%3Bscript-src.example",
    "https://a%2Cb.example",
    "https://a%27b.example",
    "https://a_b.example;frame-ancestors",
    "https://[::1;x]",
  ])("refuses a host with a delimiter character: %s", (raw) => {
    expect(appendPublicServerFormAction(HEADER, raw)).toBe(HEADER);
  });
  it.each([
    ["https://api.example.com:8443/x", "https://api.example.com:8443"],
    ["http://localhost:4000", "http://localhost:4000"],
    ["https://[::1]:8080", "https://[::1]:8080"],
    ["https://b\u00fccher.example", "https://xn--bcher-kva.example"],
    ["https://my_service.internal", "https://my_service.internal"],
  ])("still admits an ordinary host: %s", (raw, origin) => {
    expect(appendPublicServerFormAction(HEADER, raw)).toContain(`form-action 'self' ${origin};`);
  });
  it("never overrides an explicit none or a missing form policy and is idempotent", () => {
    const raw = "https://ceremony.synthetic.test";
    const once = appendPublicServerFormAction(HEADER, raw);
    expect(appendPublicServerFormAction(once, raw)).toBe(once);
    expect(appendPublicServerFormAction("form-action 'none'", raw)).toBe(
      "form-action 'none'",
    );
    expect(appendPublicServerFormAction("script-src 'self'", raw)).toBe(
      "script-src 'self'",
    );
  });
  it("takes the current runtime public value rather than a previous build value", () => {
    expect(
      appendPublicServerFormAction(HEADER, "https://next.synthetic.test"),
    ).toContain("form-action 'self' https://next.synthetic.test");
    expect(
      appendPublicServerFormAction(HEADER, "https://next.synthetic.test"),
    ).not.toContain("https://ceremony.synthetic.test");
  });
});
