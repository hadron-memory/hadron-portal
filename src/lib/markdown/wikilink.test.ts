/**
 * #374 — `[[loc]]` wikilink parsing and rendering.
 *
 * The rules under test come from spec cor:urn:020:01: bare loc = the containing
 * node's memory, an explicit memory prefix for cross-memory, resolve-to-one or
 * show visibly unresolved, never inert. Both URN grammars are accepted — v2
 * flat single-colon and legacy v1 `::` (cor:urn:010:01).
 */
import { describe, expect, it } from 'vitest';
import { Marked } from 'marked';
import {
  extractWikilinks,
  flatV2Candidate,
  parseWikilinkTarget,
  renderWikilink,
  wikilinkExtension,
  type WikilinkMap,
} from './wikilink';

const strings = { unresolvedTitle: 'Unresolved reference: no node at {target}' };

function render(src: string, links: WikilinkMap = {}): string {
  const marked = new Marked({ extensions: [wikilinkExtension(links, strings)] });
  return marked.parse(src, { async: false }) as string;
}

describe('parseWikilinkTarget', () => {
  it('treats a colon-separated target with no `::` as a bare loc', () => {
    expect(parseWikilinkTarget('findings:visibility-enum-cleanup-shipped')).toEqual({
      target: 'findings:visibility-enum-cleanup-shipped',
      memoryUrn: null,
      loc: 'findings:visibility-enum-cleanup-shipped',
    });
  });

  it('splits a fully-qualified target at the LAST `::`', () => {
    expect(parseWikilinkTarget('hadronmemory.com::dev::findings:some:deep:loc')).toEqual({
      target: 'hadronmemory.com::dev::findings:some:deep:loc',
      memoryUrn: 'hadronmemory.com::dev',
      loc: 'findings:some:deep:loc',
    });
  });

  it('keeps a >2-level memory URN intact (per-user install shape)', () => {
    // Memory URNs are not always `org::memory` — splitting at the FIRST `::`
    // would put `coding-app` in the loc and lose the memory.
    expect(parseWikilinkTarget('micromentor.org::coding-app::system::review:sort')).toEqual({
      target: 'micromentor.org::coding-app::system::review:sort',
      memoryUrn: 'micromentor.org::coding-app::system',
      loc: 'review:sort',
    });
  });

  it('strips an explicit hrn:node: / urn:node: prefix', () => {
    expect(parseWikilinkTarget('hrn:node:hadronmemory.com::dev::a:b')?.memoryUrn)
      .toBe('hadronmemory.com::dev');
    expect(parseWikilinkTarget('urn:node:hadronmemory.com::dev::a:b')?.loc).toBe('a:b');
  });

  // cor:urn:010:01 — v2 is flat and single-colon. It carries no marker for
  // where the memory ends, so it is only unambiguously cross-memory when the
  // `hrn:node:` prefix is present; then v2's fixed positional arity applies.
  it('parses a prefixed grammar-v2 flat target positionally', () => {
    expect(parseWikilinkTarget('hrn:node:hadronmemory.com:dev:findings:x')).toEqual({
      target: 'hrn:node:hadronmemory.com:dev:findings:x',
      memoryUrn: 'hadronmemory.com:dev',
      loc: 'findings:x',
    });
  });

  it('keeps a multi-atom loc together in a prefixed v2 target', () => {
    expect(parseWikilinkTarget('hrn:node:acme.com:mem:a:b:c')?.loc).toBe('a:b:c');
  });

  it('rejects a prefixed v2 target too short to carry a loc', () => {
    expect(parseWikilinkTarget('hrn:node:acme.com:mem')).toBeNull();
  });

  it('still reads an UNPREFIXED single-colon target as a bare loc (spec scope rule)', () => {
    // Indistinguishable from a deep loc, so the containing memory wins here.
    // `flatV2Candidate` offers the other reading only after a local miss.
    expect(parseWikilinkTarget('hadronmemory.com:dev:findings:x')).toEqual({
      target: 'hadronmemory.com:dev:findings:x',
      memoryUrn: null,
      loc: 'hadronmemory.com:dev:findings:x',
    });
  });

  it('rejects empty and half-empty targets', () => {
    expect(parseWikilinkTarget('   ')).toBeNull();
    expect(parseWikilinkTarget('::loc')).toBeNull();
    expect(parseWikilinkTarget('org::mem::')).toBeNull();
  });
});

describe('flatV2Candidate', () => {
  it('splits a 3+-atom string positionally into memory + loc', () => {
    expect(flatV2Candidate('hadronmemory.com:dev:findings:x')).toEqual({
      memoryUrn: 'hadronmemory.com:dev',
      loc: 'findings:x',
    });
  });

  it('returns null below 3 atoms — too short to name a memory AND a loc', () => {
    expect(flatV2Candidate('findings:x')).toBeNull();
    expect(flatV2Candidate('top')).toBeNull();
  });

  it('returns null when any atom is empty', () => {
    expect(flatV2Candidate('a::b:c')).toBeNull();
  });
});

describe('extractWikilinks', () => {
  it('collects distinct targets across several sources, in first-seen order', () => {
    const refs = extractWikilinks('see [[a:b]] and [[c:d]]', 'again [[a:b]]', null, undefined);
    expect(refs.map((r) => r.target)).toEqual(['a:b', 'c:d']);
  });

  it('ignores the display-text half when keying the target', () => {
    const refs = extractWikilinks('[[glossary:ns1|NS1]] and [[glossary:ns1]]');
    expect(refs.map((r) => r.target)).toEqual(['glossary:ns1']);
  });

  it('over-extracts rather than under-extracts: code is not skipped here', () => {
    // The RENDERER skips code (marked never descends into code tokens). If
    // extraction skipped it too and the two disagreed at an edge, a real
    // wikilink could go unlisted and render as falsely broken. A wasted map
    // entry is the cheaper side of that trade.
    expect(extractWikilinks('`[[DOPPLER_TOKEN]]`').map((r) => r.target)).toEqual([
      'DOPPLER_TOKEN',
    ]);
  });

  it('does not run away across a paragraph on an unmatched bracket', () => {
    expect(extractWikilinks('[[ unterminated\n\nnext [[a:b]]').map((r) => r.target)).toEqual([
      'a:b',
    ]);
  });
});

describe('renderWikilink', () => {
  it('uses the target node name as link text, and the authored target as the title', () => {
    const html = renderWikilink(
      { target: 'findings:x', label: null },
      { href: '/app/memories/m1/nodes/n1', label: 'Finding X' },
      strings,
    );
    expect(html).toBe(
      '<a class="wikilink" href="/app/memories/m1/nodes/n1" title="findings:x">Finding X</a>',
    );
  });

  it('prefers explicit display text over the node name', () => {
    const html = renderWikilink(
      { target: 'glossary:ns1', label: 'NS1' },
      { href: '/app/memories/m1/nodes/n1', label: 'Nameserver 1' },
      strings,
    );
    expect(html).toContain('>NS1</a>');
  });

  it('renders an unresolved reference visibly, keeping the brackets — never inert', () => {
    const html = renderWikilink({ target: 'findings:gone', label: null }, null, strings);
    expect(html).toBe(
      '<span class="wikilink wikilink-unresolved" ' +
        'title="Unresolved reference: no node at findings:gone">[[findings:gone]]</span>',
    );
  });

  it('keeps the authored TARGET visible on an unresolved labelled link', () => {
    // `[[glossary:gone|NS1]]` must not render as `[[NS1]]` — on a broken
    // reference the target is the half that has to be fixed, so hiding it
    // behind the display text defeats the affordance. PR #684 review, Copilot.
    const html = renderWikilink({ target: 'glossary:gone', label: 'NS1' }, null, strings);
    expect(html).toContain('[[glossary:gone|NS1]]');
  });

  it('treats a target missing from the map exactly like an explicit null', () => {
    expect(renderWikilink({ target: 'a:b', label: null }, undefined, strings)).toContain(
      'wikilink-unresolved',
    );
  });

  it('escapes the target and label into every attribute and the text', () => {
    const html = renderWikilink(
      { target: '"><script>x</script>', label: null },
      null,
      strings,
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
  });
});

describe('wikilinkExtension (marked integration)', () => {
  it('renders a resolved link inline in a paragraph', () => {
    const html = render('See [[findings:x]] for detail.', {
      'findings:x': { href: '/app/memories/m1/nodes/n1', label: 'Finding X' },
    });
    expect(html).toContain('<a class="wikilink" href="/app/memories/m1/nodes/n1"');
    expect(html).toContain('>Finding X</a>');
    expect(html).toContain('See ');
    expect(html).toContain(' for detail.');
  });

  it('leaves `[[…]]` inside an inline code span alone', () => {
    const html = render('Komodo interpolates `[[DOPPLER_TOKEN]]` at deploy time.');
    expect(html).toContain('<code>[[DOPPLER_TOKEN]]</code>');
    expect(html).not.toContain('wikilink');
  });

  it('leaves `[[…]]` inside a fenced code block alone', () => {
    // Bash test syntax — the first false positive found during the corpus sweep.
    const html = render('```bash\nif [[ "$base" == "index" ]]; then\n```');
    expect(html).not.toContain('wikilink');
    expect(html).toContain('if [[ &quot;$base&quot; == &quot;index&quot; ]]');
  });

  it('does not let a markdown link swallow the wikilink brackets', () => {
    const html = render('[[a:b]]', { 'a:b': { href: '/x', label: 'A B' } });
    expect(html).toContain('<a class="wikilink" href="/x"');
  });

  it('renders a plain markdown link unchanged alongside a wikilink', () => {
    const html = render('[docs](https://example.com) and [[a:b]]', {
      'a:b': { href: '/x', label: 'A B' },
    });
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('class="wikilink" href="/x"');
  });
});
