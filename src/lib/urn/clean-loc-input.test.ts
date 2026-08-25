import { describe, it, expect } from 'vitest';
import { cleanLocInput } from './clean-loc-input';
import { splitNodeUrn } from './parse-urn';

describe('cleanLocInput', () => {
  it('passes through a bare loc', () => {
    expect(cleanLocInput('review:render-urn')).toBe('review:render-urn');
  });

  it('strips canonical urn:node: prefix', () => {
    expect(cleanLocInput('urn:node:hadronmemory.com:dev:review:render-urn'))
      .toBe('review:render-urn');
  });

  it('strips wrong-type urn:memory: prefix (the #100 #4 bug)', () => {
    expect(cleanLocInput('urn:memory:hadronmemory.com:dev:review:render-urn'))
      .toBe('review:render-urn');
  });

  it('strips legacy loc: prefix', () => {
    expect(cleanLocInput('loc:review:render-urn')).toBe('review:render-urn');
  });

  it('strips bare memory-prefixed loc', () => {
    expect(cleanLocInput('hadronmemory.com:dev:review:render-urn'))
      .toBe('review:render-urn');
  });

  it('handles a single-segment loc with no prefix', () => {
    expect(cleanLocInput('urn-format')).toBe('urn-format');
  });

  it('trims surrounding whitespace', () => {
    expect(cleanLocInput('  review:render-urn  ')).toBe('review:render-urn');
  });

  it('normalizes forward slashes to colons (legacy path-style locs)', () => {
    expect(cleanLocInput('review/render-urn')).toBe('review:render-urn');
  });

  it('normalizes mixed path-style + colon legacy artifacts', () => {
    expect(cleanLocInput('foo/bar:baz')).toBe('foo:bar:baz');
  });

  it('does not strip memory prefix when first segment has no dot', () => {
    expect(cleanLocInput('section:nested:leaf')).toBe('section:nested:leaf');
  });

  // Asymmetric prefix handling (intentional): only node and memory URNs
  // get stripped to a bare loc. Other URN types pasted into a loc field
  // are user-paste mistakes — leave them so the server rejects clearly.
  it('does not strip urn:agent: prefix (left for server to reject)', () => {
    expect(cleanLocInput('urn:agent:micromentor.org:mmcoding-agent'))
      .toBe('urn:agent:micromentor.org:mmcoding-agent');
  });

  it('does not strip urn:app: prefix (left for server to reject)', () => {
    expect(cleanLocInput('urn:app:micromentor.org:mmcoding'))
      .toBe('urn:app:micromentor.org:mmcoding');
  });

  it('does not strip urn:org: prefix (left for server to reject)', () => {
    expect(cleanLocInput('urn:org:micromentor.org')).toBe('urn:org:micromentor.org');
  });

  // Spec 021 grammar — `::` separates hierarchy levels; the node loc is
  // the FINAL `::`-segment. Codex review on PR #222 caught that the
  // pre-fix logic mangled spec-021 inputs by splitting on every `:` and
  // slicing only two atoms — leaving most of the URN path in the loc.
  describe('spec 021 — `::` grammar', () => {
    it('extracts the loc from a spec-021 node URN', () => {
      // The 4-segment memory + single-segment leaf shape.
      expect(
        cleanLocInput('urn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports'),
      ).toBe('review:sort-imports');
    });

    it('extracts a single-atom leaf from a spec-021 node URN', () => {
      expect(
        cleanLocInput('urn:node:micromentor.org::coding-app::coding-agent::system::notify'),
      ).toBe('notify');
    });

    it('extracts a multi-atom leaf preserving intra-leaf colons', () => {
      expect(
        cleanLocInput('urn:node:hadronmemory.com::dev::a:b:c:d:e'),
      ).toBe('a:b:c:d:e');
    });

    it('handles a bare spec-021-shape value (no urn:node: prefix)', () => {
      // After `parseDisplayUrn` returns type='unknown' for a non-prefixed
      // value, the `::` split still extracts the last segment.
      expect(
        cleanLocInput('hadronmemory.com::dev::review:render-urn'),
      ).toBe('review:render-urn');
    });

    it('extracts the role-marker segment when a memory URN is pasted (server rejects as wrong shape)', () => {
      // Memory URN pasted into a loc field is a user-paste mistake.
      // The final `::`-segment is the role marker (e.g., `system`); the
      // server-side mutation will reject it with a clear loc-shape error
      // — better than silently coercing the wrong-shape input.
      expect(
        cleanLocInput('urn:memory:micromentor.org::coding-app::coding-agent::system'),
      ).toBe('system');
    });

    // #777 / urn-lib-js 0.0.15. This branch existed because the lib MIS-SPLIT a
    // deep v1 `::` node URN — it took the first two atoms as the memory. 0.0.15
    // settled the grammar the other way, so for a deep NODE URN the lib now
    // returns what this branch does.
    //
    // Pinned rather than assumed, and pinned rather than acted on: the branch
    // was NOT removed, because it also answers shapes `splitNodeUrn` refuses
    // (the memory URN above, and a too-short node URN). This test is what makes
    // a later removal a decision with evidence instead of a guess.
    it('now AGREES with the library for a deep node URN — which is what makes the branch redundant HERE', () => {
      const deep = 'hrn:node:micromentor.org::coding-app::coding-agent::system::review:sort-imports';
      expect(splitNodeUrn(deep)).toEqual({
        memoryUrn: 'micromentor.org:coding-app:coding-agent:system',
        loc: 'review:sort-imports',
      });
      expect(cleanLocInput(deep)).toBe(splitNodeUrn(deep).loc);
    });

    // Which cases actually KEEP the branch alive was measured, not argued:
    // deleting it reds exactly two of the tests above — the bare spec-021
    // value and the pasted memory URN — and nothing else in this file.
    //
    // An earlier draft of the test above also asserted `hrn:node:acme.com::kb`
    // → `kb` as evidence the branch was load-bearing. It is not: with the
    // branch deleted the tolerant heuristic returns `kb` as well, so that
    // assertion held for the wrong reason and would have overstated the case
    // for keeping the code. Removed rather than left decorative
    // (review:a-spare-test-must-reach-the-matcher).
  });

  // #777 / urn-lib-js 0.0.15 — fragments. The lib now strips a REGISTERED
  // `#data` before splitting and REFUSES an unregistered fragment. Both
  // behaviours reach this function, and they land on opposite paths.
  describe('a `#` fragment', () => {
    it('drops a registered `#data`, because the LOC is the parent', () => {
      // `#data` addresses the node's data, so the node's loc is what precedes
      // it. 0.0.13 returned `some:loc#data`, which is not a valid loc at all —
      // this is the bump improving the answer, not changing it arbitrarily.
      expect(cleanLocInput('hrn:node:acme.com:mmdata:some:loc#data')).toBe('some:loc');
    });

    it('PRESERVES a loc that merely contains a `#`, via the fall-through', () => {
      // The hazard hadron-server#1088 needed a tolerant wrapper for: a stored
      // `Node.loc` may already contain a `#`, and 0.0.15 refuses it outright —
      // so a strict path would make the row you most need to see the row you
      // cannot read. Here `splitNodeUrn`'s try/catch already absorbs it and the
      // heuristic passes the value through intact.
      //
      // This test exists because that catch was written for a DIFFERENT reason
      // (a too-short value) and now carries this one. Deleting it as dead
      // safety would silently reintroduce the server's bug.
      expect(splitNodeUrn).toBeTypeOf('function');
      expect(() => splitNodeUrn('hrn:node:acme.com:mmdata:some:loc#unregistered')).toThrow();
      expect(cleanLocInput('hrn:node:acme.com:mmdata:some:loc#unregistered')).toBe(
        'some:loc#unregistered',
      );
    });
  });

  // Grammar-v2 flat node URNs (#697): single colon, pool-rooted. The lib
  // splitter extracts the loc across both root kinds — a dotted org root and
  // an undotted user-handle root (the latter defeats the dotted-org heuristic).
  describe('grammar v2 — flat node URNs (#697)', () => {
    it('extracts the loc from a v2 node URN with a dotted org root', () => {
      expect(
        cleanLocInput('hrn:node:hadronmemory.com:dev:review:render-urn'),
      ).toBe('review:render-urn');
    });

    it('extracts the loc from a v2 node URN with an undotted user-handle root', () => {
      // The old dotted-org heuristic (parts[0].includes('.')) could NOT strip a
      // user-handle root; the lib splitter does.
      expect(
        cleanLocInput('hrn:node:holger:notes:review:render-urn'),
      ).toBe('review:render-urn');
    });

    it('extracts a single-atom loc from a v2 node URN', () => {
      expect(cleanLocInput('hrn:node:holger:notes:notify')).toBe('notify');
    });
  });
});
