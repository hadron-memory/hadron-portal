// portal#2088 / #2090: AgentChat switches panes on its OWN width (`@container`
// on its root, `@2xl:` variants), because on the App page the app nav takes
// ~220px from `sm` up and a viewport breakpoint can't see it (Celine's QA P2).
// These pins keep that true as the component grows (Gabriel's blind delta P2s):
//  - no viewport breakpoint variant (sm:/md:/lg:/xl:/2xl:) in AgentChat or any
//    component it renders: one would fire on the window while the chat is
//    phone-sized;
//  - no `fixed` class inside the size container: a size container is the
//    containing block for position:fixed descendants, so an overlay there
//    would anchor to and clip at the panel (the delete dialog is a sibling);
//  - AgentChat mounts only under src/routes/app/, i.e. inside the app layout
//    the Chromium oracle reproduces.
// The computed-style twin of the `fixed` pin runs in
// scripts/test-agent-chat-phone-layout.mjs at every width.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const LIB = resolve(ROOT, 'src/lib');
const AGENT_CHAT = resolve(LIB, 'components/AgentChat.svelte');

const read = (file: string) => readFileSync(file, 'utf8');
const markup = (source: string) => source.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');

/** AgentChat plus every $lib .svelte component it renders, transitively. */
function renderedComponents(entry: string): string[] {
  const seen = new Set<string>();
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const m of read(file).matchAll(/from '\$lib\/([^']+\.svelte)'/g)) walk(resolve(LIB, m[1]));
  };
  walk(entry);
  return [...seen];
}

// A Tailwind viewport variant: `sm:` etc. at a class-token start. `@2xl:` (a
// container variant) is excluded by the preceding-character class.
const VIEWPORT_VARIANT = /(?<![\w@-])(?:max-)?(?:sm|md|lg|xl|2xl):[\w[]/g;

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

describe('AgentChat breakpoints are the container’s, not the viewport’s (portal#2088)', () => {
  const components = renderedComponents(AGENT_CHAT);

  it('walks the components AgentChat renders', () => {
    expect(components.map((f) => relative(LIB, f))).toEqual(
      expect.arrayContaining(['components/AgentChat.svelte', 'components/ServedPrompt.svelte', 'components/Urn.svelte']),
    );
  });

  it('the pattern catches viewport variants and skips container ones', () => {
    const hits = (s: string) => [...s.matchAll(VIEWPORT_VARIANT)].map((m) => m[0]);
    expect(hits('class="flex sm:hidden md:w-64 max-sm:p-2 lg:[x]"')).toEqual(['sm:h', 'md:w', 'max-sm:p', 'lg:[']);
    expect(hits('class="@container hidden @2xl:flex @sm:p-1 focus:outline-none dark:bg-zinc-900"')).toEqual([]);
  });

  it.each(renderedComponents(AGENT_CHAT).map((f) => [relative(LIB, f), f]))('%s has no viewport breakpoint variant', (_name, file) => {
    expect([...markup(read(file)).matchAll(VIEWPORT_VARIANT)].map((m) => m[0])).toEqual([]);
  });

  it('the root is the size container and nothing inside it is position:fixed', () => {
    const body = markup(read(AGENT_CHAT));
    const open = body.indexOf('class="@container ');
    expect(open, 'AgentChat root lost @container').toBeGreaterThan(-1);
    // The root is the first top-level <div>; its subtree ends at the first
    // top-level </div> (a line starting with it, no indent).
    const close = body.indexOf('\n</div>', open);
    expect(close).toBeGreaterThan(open);
    const inside = body.slice(open, close);
    expect(inside.match(/(?<![\w-])fixed(?![\w-])/g) ?? []).toEqual([]);
    // The delete dialog is still there, as the root's sibling.
    expect(body.slice(close)).toMatch(/class="fixed inset-0/);
    for (const file of components.filter((f) => f !== AGENT_CHAT)) {
      expect(markup(read(file)).match(/(?<![\w-])fixed(?![\w-])/g) ?? [], relative(LIB, file)).toEqual([]);
    }
  });

  it('mounts only inside the app layout (src/routes/app/)', () => {
    const importers = [...filesUnder(resolve(ROOT, 'src')).filter((f) => f.endsWith('.svelte'))]
      .filter((f) => f !== AGENT_CHAT && /from '\$lib\/components\/AgentChat\.svelte'/.test(read(f)))
      .map((f) => relative(ROOT, f));
    expect(importers.length).toBeGreaterThan(0);
    expect(importers.filter((f) => !f.startsWith('src/routes/app/'))).toEqual([]);
  });
});
