import { describe, expect, it } from 'vitest';
import { conditionalStatusIdentities, nextBaseline, ratchetDiff } from './live-region-sites.scan';

/**
 * portal#2391: the live-region ratchet tracks each site by an identity, not a per-file count, so a
 * replacement inside one file is an addition plus a removal, and a status nested in a plain wrapper is seen.
 */
const one = (src: string) => conditionalStatusIdentities(src);

describe('portal#2391: site identity', () => {
  it('fixing one site and adding another in the same file is an addition and a removal, not no change', () => {
    const before = one('{#if a}<p role="status">{a}</p>{/if}{#if b}<p role="status" class="x">{b}</p>{/if}');
    // `a`'s site is converted to a persistent region and a NEW site on `c` appears: the count stays 2 either way.
    const after = one('<LiveRegion>{#if a}<p>{a}</p>{/if}</LiveRegion>{#if b}<p role="status" class="x">{b}</p>{/if}{#if c}<p role="status">{c}</p>{/if}');
    expect(before).toHaveLength(2);
    expect(after).toHaveLength(2);
    const d = ratchetDiff(before, after);
    expect(d.added).toHaveLength(1);
    expect(d.removed).toHaveLength(1);
  });

  it('an unchanged site keeps its identity when lines move or unrelated markup changes', () => {
    const a = one('{#if a}<p role="status">{a}</p>{/if}');
    const b = one('<h1>title</h1>\n\n<div>more</div>\n{#if a}\n  <p role="status">{a}</p>\n{/if}');
    expect(b).toEqual(a);
  });

  it('a site with a data-testid is identified by it, and survives a change to its other attributes', () => {
    const a = one('{#if a}<p role="status" data-testid="saved-note" class="x">{a}</p>{/if}');
    const b = one('{#if a}<p role="status" data-testid="saved-note" class="y">{a}</p>{/if}');
    expect(a).toEqual(['testid:saved-note']);
    expect(b).toEqual(a);
  });

  it('two sites with the same tag and condition stay distinct', () => {
    const ids = one('{#if a}<p role="status">x</p>{/if}{#if a}<p role="status">x</p>{/if}');
    expect(new Set(ids).size).toBe(2);
  });

  it('the branch condition is part of the identity, and the else arm differs from the then arm', () => {
    const [then] = one('{#if a}<p role="status">x</p>{:else}y{/if}');
    const [other] = one('{#if b}<p role="status">x</p>{/if}');
    const [orElse] = one('{#if a}y{:else}<p role="status">x</p>{/if}');
    expect(new Set([then, other, orElse]).size).toBe(3);
  });

  it('known limit: a swap between two sites that share tag and condition is invisible', () => {
    const a = one('{#if a}<p role="status">{one}</p>{/if}');
    const b = one('{#if a}<p role="status">{other}</p>{/if}');
    expect(ratchetDiff(a, b)).toEqual({ added: [], removed: [] });
  });

  it('ratchetDiff reports additions and removals separately', () => {
    expect(ratchetDiff(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
    expect(ratchetDiff(['a'], ['a'])).toEqual({ added: [], removed: [] });
  });
});

describe('portal#2391: a status nested in a plain wrapper inside a branch', () => {
  it('is counted', () => {
    expect(one('{#if a}<div><p role="status">x</p></div>{/if}')).toHaveLength(1);
    expect(one('{#if a}<section><div><p role="status">x</p></div></section>{/if}')).toHaveLength(1);
    expect(one('{#if a}{#key a}<div><p role={a.role}>x</p></div>{/key}{/if}')).toHaveLength(1);
  });

  it('is not counted when the {#if} is inside its own persistent region', () => {
    expect(one('<div><p role="status">{#if a}x{/if}</p></div>')).toHaveLength(0);
    expect(one('<div role="status">{#if a}<p>x</p>{/if}</div>')).toHaveLength(0);
  });

  it('is counted once when the wrapper is itself a status region', () => {
    expect(one('{#if a}<div role="status"><p role="status">x</p></div>{/if}')).toHaveLength(1);
  });

  it('does not search through a component from a branch, but still walks a branch inside its slot', () => {
    expect(one('{#if a}<LiveRegion><p role="status">x</p></LiveRegion>{/if}')).toHaveLength(0);
    // The recommended shape with the role left on the inner element: the inner {#if} is a branch of its own.
    expect(one('<LiveRegion>{#if a}<p role="status">x</p>{/if}</LiveRegion>')).toHaveLength(1);
  });
});

describe('portal#2391: regenerating the baseline', () => {
  const now = new Map([['a.svelte', ['x', 'y']], ['b.svelte', ['z']]]);
  const base = { 'a.svelte': ['x', 'gone'], 'c.svelte': ['old'] };

  it('lowers and drops what is gone, but leaves an addition out unless accepted', () => {
    expect(nextBaseline(base, now, false)).toEqual({ 'a.svelte': ['x'] });
  });

  it('takes the additions when accepted', () => {
    expect(nextBaseline(base, now, true)).toEqual({ 'a.svelte': ['x', 'y'], 'b.svelte': ['z'] });
  });
});
