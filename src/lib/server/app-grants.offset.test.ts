import { describe, expect, it } from "vitest";
import { grantOffset } from "./app-grants";
const at = (q: string) => new URL(`http://localhost/grants${q}`);
describe("grantOffset", () => {
  it.each([
    ["", 0],
    ["?offset=", 0],
    ["?offset=0", 0],
    ["?offset=40", 40],
    ["?offset=2147483647", 2147483647],
    ["?offset=2147483648", 0],
    ["?offset=-1", 0],
    ["?offset=1.5", 0],
    ["?offset=abc", 0],
    ["?offset=1e3", 0],
    ["?offset=%2B5", 0],
    ["?offset=99999999999999999999", 0],
  ])("%s -> %d", (q, n) => expect(grantOffset(at(q))).toBe(n));
});
