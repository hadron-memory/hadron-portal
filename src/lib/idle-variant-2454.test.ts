import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('.', new URL('..', import.meta.url)).pathname.replace(/\/$/, '');

function svelteFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) svelteFiles(p, out);
    else if (e.name.endsWith('.svelte')) out.push(p);
  }
  return out;
}

describe('portal#2454: LiveRegion goes out of flow on idle, not on :empty', () => {
  // The pins elsewhere assert the class a LiveRegion carries, not that Tailwind defines the variant. An undefined
  // `idle` variant would leave `idle:absolute` a silent no-op. The `:empty` arm covers the server-rendered first
  // paint (the region renders comment-only, so no `data-idle` yet); `[data-idle]` takes over once mounted.
  it('app.css defines the idle variant as :empty or [data-idle]', () => {
    const css = readFileSync(join(SRC, 'app.css'), 'utf8');
    expect(css).toMatch(/@custom-variant\s+idle\s*\(\s*&:is\(\s*:empty\s*,\s*\[data-idle\]\s*\)\s*\)/);
  });

  // A whitespace text node is idle to LiveRegion (`data-idle`) but breaks CSS `:empty`, so `empty:` on a call site
  // never applies (portal#2394). Zero matches is the sweep: the three sites #2454 converted were exhaustive, and a
  // fourth cannot return.
  it('no LiveRegion call site under src carries an empty: variant', () => {
    const hits = svelteFiles(SRC).filter((f) => /<LiveRegion\b[^>]*\bclass="[^"]*\bempty:/.test(readFileSync(f, 'utf8')));
    expect(hits.map((f) => f.slice(SRC.length + 1))).toEqual([]);
  });
});
