/** #1974 — the pager control markup is declared ONCE.
 *
 * ListPageNav used to carry First, Previous and Next as three parallel
 * `{#if disabled}<span …>{:else}<a …>{/if}` blocks, so any semantic or styling
 * change (the #1973 `role="link"` edit) had to be repeated three times and
 * nothing noticed a direction that was missed. The behavioural pins in
 * ListPageNav.client.test.ts hold each direction's rendered semantics; this
 * pin holds the SOURCE shape that makes drift impossible: one disabled span
 * and one enabled anchor, shared by every direction.
 *
 * Comments are stripped first, because the component's own prose names the
 * very attributes asserted on (hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail).
 * The exactly-one counts double as the positive control: a count of 0 means the
 * pattern no longer finds the markup, which is as wrong as 3.
 */
import { describe, expect, it } from 'vitest';
import source from './ListPageNav.svelte?raw';

const markup = source
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');
const count = (re: RegExp) => (markup.match(re) ?? []).length;

describe('ListPageNav control markup is declared once (#1974)', () => {
  it('has exactly one disabled-link span and one enabled anchor', () => {
    expect(count(/aria-disabled="true"/g)).toBe(1);
    expect(count(/role="link"/g)).toBe(1);
    expect(count(/cursor-not-allowed/g)).toBe(1);
    expect(count(/<a\s/g)).toBe(1);
  });
  it('names each of the three directions exactly once (rel is pinned in the client test)', () => {
    expect(count(/app\.list-page\.first/g)).toBe(1);
    expect(count(/app\.list-page\.previous/g)).toBe(1);
    expect(count(/app\.list-page\.next/g)).toBe(1);
  });
});
