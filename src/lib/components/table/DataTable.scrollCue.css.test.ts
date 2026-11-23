/** #2461 — the scroll cue's CSS is linked to the markup only by class names and a sibling selector, and
 *  jsdom loads no stylesheet, so pin that linkage on the sources.
 *  #2503 — sources are read relative to this file (not the process CWD), and matched on whitespace-normalised
 *  text so reformatting a rule cannot break or fake a pin. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const squash = (s: string) => s.replace(/\s+/g, ' ');
// Comments are stripped first: a comment between two rules must not become part of the next selector.
const css = squash(read('../../../app.css').replace(/\/\*[\s\S]*?\*\//g, ''));
const table = read('./DataTable.svelte');

/** Every rule body whose selector names the table scroll cue, keyed by selector. */
function cueRules(): Array<{ selector: string; body: string }> {
  return [...css.matchAll(/([^{}]*\.table-scroll-cue[^{}]*)\{([^}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2].trim() }));
}

describe('DataTable scroll cue CSS (#2461)', () => {
  it('shows each cue only when the scroller before it carries that edge mark', () => {
    expect(css).toContain('[data-overflow-end] ~ .table-scroll-cue-end');
    expect(css).toContain('[data-overflow-start] ~ .table-scroll-cue-start');
  });
  it('is hidden by default and themed for dark', () => {
    expect(css).toMatch(/\.table-scroll-cue \{ [^}]*opacity: 0;/);
    expect(cueRules().some((r) => r.selector.startsWith('.dark .table-scroll-cue'))).toBe(true);
  });
  it('is an overlay, not a mask: no cue rule masks anything, and the scroller carries no mask class', () => {
    const rules = cueRules();
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r.body, r.selector).not.toMatch(/mask/);
    const scrollerClass = table.match(/data-testid="data-table-scroller" class="([^"]*)"/)?.[1];
    expect(scrollerClass, 'the scroller element is found').toBeTruthy();
    expect(scrollerClass).not.toMatch(/scroll-hint/);
    expect(table).toContain('pointer-events-none');
  });
  it('the cues use the classes the stylesheet defines', () => {
    for (const c of ['table-scroll-cue-start', 'table-scroll-cue-end']) {
      expect(table).toContain(c);
      expect(css).toContain(`.${c}`);
    }
  });
});

describe('DataTable scroll cue colour (#2503, item 6)', () => {
  it('is a shade from the palette in both themes, never a hardcoded white', () => {
    const colours = cueRules().map((r) => r.body).join(' ');
    expect(colours).not.toMatch(/255 255 255|#fff\b|#ffffff|rgb\(255,\s*255,\s*255|\bwhite\b/i);
    expect(colours).toContain('var(--color-zinc-900');
    expect(colours).toContain('var(--color-zinc-950');
  });
});
