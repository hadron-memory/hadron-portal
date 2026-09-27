/**
 * #858 — the tab-strip gate's own suite.
 *
 * Every case runs the REAL `offences()` over source, because the stop-gap this
 * gate replaces failed precisely by not doing that: it matched tokens against
 * whole files, so the comments explaining each fix satisfied the assertions and
 * deleting a real class left it green.
 *
 * `hrn:node:hadronmemory.com:hadron-portal:review:guard-must-be-proven-to-fail`
 * — the FLAGS cases below are the point of this file. A gate exercised only
 * against a clean tree is decoration, and #849 shipped one with three holes of
 * the class it was written for.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyse, offences, svelteFilesUnder } from './check-tab-strips.mjs';

/** A strip with everything right — the shape the repo now has everywhere. */
const FIXED = `
<div class="mb-3 flex gap-0 overflow-x-auto border-b border-zinc-200">
  <button class="shrink-0 whitespace-nowrap border-b-2 px-3 py-1.5">One</button>
  <button class="shrink-0 whitespace-nowrap border-b-2 px-3 py-1.5">Two</button>
</div>`;

const kinds = (src: string) => offences(src).map((o) => o.kind);

describe('the gate passes what it should', () => {
  it('a strip that scrolls with non-shrinking tabs', () => {
    expect(offences(FIXED)).toEqual([]);
  });

  it('a strip whose SCROLLER is an inner element, not the rail', () => {
    // `/app/assets` in the wild: the rail is a justify-between row and the
    // scrolling element is the inner <nav> holding the tabs. A check that only
    // looked at the rail would report a false positive here.
    expect(
      offences(`
      <div class="flex items-end justify-between border-b border-zinc-200">
        <nav class="flex min-w-0 gap-0 overflow-x-auto">
          <a class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2">One</a>
          <a class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2">Two</a>
        </nav>
        <span class="shrink-0 text-xs">3 files</span>
      </div>`),
    ).toEqual([]);
  });

  it('a static required class beside an interpolation is fine', () => {
    // The normal shape in this repo: layout classes static, colour classes
    // interpolated. Nothing here is conditional about whether the strip
    // scrolls or its tabs are pinned.
    expect(
      offences(`
      <div class="flex gap-0 overflow-x-auto border-b">
        {#each tabs as tab (tab.id)}
          <a class="shrink-0 whitespace-nowrap border-b-2 px-4
            {active === tab.id ? 'border-indigo-500 text-indigo-600' : 'border-transparent text-zinc-500'}">{tab.label}</a>
        {/each}
      </div>`),
    ).toEqual([]);
  });

  it('a SEGMENTED CONTROL is not a tab strip', () => {
    // Two buttons, no bottom rail — the Rendered/Source toggle shape. Demanding
    // `overflow-x-auto` here would be noise, and noise is how a gate grows an
    // exclusion list
    // (hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven).
    expect(
      offences(`
      <div role="group" class="flex shrink-0 overflow-hidden rounded-md border">
        <button class="px-2 py-1 text-xs">Rendered</button>
        <button class="px-2 py-1 text-xs">Source</button>
      </div>`),
    ).toEqual([]);
  });

  it('a rail with only ONE tab is not a strip', () => {
    expect(
      offences(`
      <div class="flex gap-0 border-b">
        <button class="border-b-2 px-3">Only</button>
      </div>`),
    ).toEqual([]);
  });

  it('an {#each} strip that scrolls is accepted', () => {
    // The shape eight rails use, and the one the gate could not see at all
    // until `repeats` existed. ONE <a> node, many runtime tabs.
    expect(
      offences(`
      <div class="flex gap-0 overflow-x-auto border-b border-zinc-200">
        {#each tabs as tab (tab.id)}
          <a href={tab.href} class="shrink-0 whitespace-nowrap border-b-2 px-4 py-2">{tab.label}</a>
        {/each}
      </div>`),
    ).toEqual([]);
  });

  it('a wrapping rail whose REPEATED UNIT is a wrapper still counts', () => {
    // The real shape on the agent page: the {#each} repeats a <div> and THOSE
    // are the wrapping container's direct flex items, so each tab is its own
    // item and they wrap. Measured in the running app — 637px of tabs in a
    // 308px rail landed on three rows.
    expect(
      offences(`
      <div class="flex flex-wrap items-center gap-1 border-b border-zinc-200">
        {#each subTabs as subTab (subTab.id)}
          <div class="flex items-center">
            <button class="border-b-2 px-3 py-1.5">{subTab.label}</button>
          </div>
        {/each}
      </div>`),
    ).toEqual([]);
  });

  it('a WRAPPING rail is satisfied without the scroll classes', () => {
    // `flex-wrap` is the other correct answer to #858 — the agent page's
    // chatbot sub-tab bar. Measured in the running app at 390px: 637px of tabs
    // in a 308px rail wrap onto THREE rows, rail 111px tall, document overflow
    // 0. Demanding `overflow-x-auto` here would be a false positive, and
    // demanding `whitespace-nowrap` would REINTRODUCE the overflow.
    expect(
      offences(`
      <div class="flex flex-wrap items-center gap-1 border-b border-zinc-200">
        {#each subTabs as subTab (subTab.id)}
          <button class="border-b-2 px-3 py-1.5">{subTab.label}</button>
        {/each}
      </div>`),
    ).toEqual([]);
  });

  it('an {:else} fallback tab is NOT treated as repeated', () => {
    // Only the each block's BODY repeats. Its fallback renders at most once,
    // so a lone tab there leaves the rail a one-tab rail, not a strip.
    expect(
      offences(`
      <div class="flex gap-0 border-b">
        {#each [] as tab}
          <span>{tab}</span>
        {:else}
          <button class="border-b-2 px-3">Empty</button>
        {/each}
      </div>`),
    ).toEqual([]);
  });
});

describe('the gate FLAGS what it should — the half that makes it real', () => {
  it('a rail with no overflow-x-auto anywhere above its tabs', () => {
    expect(kinds(FIXED.replace(' overflow-x-auto', ''))).toContain('strip-does-not-scroll');
  });

  it('a tab that can shrink', () => {
    expect(kinds(FIXED.replace(/shrink-0 /g, ''))).toContain('tab-can-shrink');
  });

  it('a tab that can wrap — INDEPENDENTLY of shrink-0', () => {
    // Each required token needs a fixture omitting only IT. A case missing both
    // stays green if the gate quietly stops checking one of them, which is half
    // a requirement proven (@copilot on #859).
    const wrapOnly = FIXED.replace(/whitespace-nowrap /g, '');
    expect(kinds(wrapOnly)).toContain('tab-can-wrap');
    expect(kinds(wrapOnly)).not.toContain('tab-can-shrink');
  });

  it('is NOT fooled by a comment naming every class — the stop-gap’s defect', () => {
    // The exact shape that made #859's source-grep worthless: markup stripped
    // of the classes, beside a comment mentioning all of them. A parser reads
    // the tree, so a comment is not an attribute.
    const commented = `
      <!-- #858 — overflow-x-auto, with shrink-0 whitespace-nowrap on each tab -->
      <div class="flex gap-0 border-b border-zinc-200">
        <button class="border-b-2 px-3">One</button>
        <button class="border-b-2 px-3">Two</button>
      </div>`;
    expect(kinds(commented)).toContain('strip-does-not-scroll');
    expect(kinds(commented)).toContain('tab-can-shrink');
  });

  it('is not fooled by the token sitting on an UNRELATED element', () => {
    // The question a regex cannot answer, and the reason this gate parses:
    // `overflow-x-auto` is present in the file, on a row that is not the strip.
    expect(
      kinds(`
      <div class="flex overflow-x-auto">a scrolling row that is not the strip</div>
      <div class="flex gap-0 border-b border-zinc-200">
        <button class="shrink-0 whitespace-nowrap border-b-2 px-3">One</button>
        <button class="shrink-0 whitespace-nowrap border-b-2 px-3">Two</button>
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('survives a class attribute wrapped across lines', () => {
    // prettier wraps at 100 columns, and a line-based scan walks straight
    // through the wrapped form — the bare-loc gate's sibling problem, named on
    // #849. The parser takes the attribute as a unit.
    expect(
      kinds(`
      <div
        class="mb-3 flex gap-0 border-b border-zinc-200 dark:border-zinc-800 lg:mb-4 xl:mb-5"
      >
        <button class="shrink-0 whitespace-nowrap border-b-2 px-3">One</button>
        <button class="shrink-0 whitespace-nowrap border-b-2 px-3">Two</button>
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('an {#each} strip with NO overflow-x-auto — the eight-rail blind spot', () => {
    // The fire half of the each-block repair. Before `repeats`, this returned
    // [] because one AST node read as one tab, and the rail was skipped as "not
    // a strip" — which is how all three strips #859 fixed stayed invisible.
    const looped = `
      <div class="flex gap-0 border-b border-zinc-200">
        {#each tabs as tab (tab.id)}
          <a href={tab.href} class="border-b-2 px-4 py-2">{tab.label}</a>
        {/each}
      </div>`;
    expect(kinds(looped)).toContain('strip-does-not-scroll');
    expect(kinds(looped)).toContain('tab-can-shrink');
    expect(kinds(looped)).toContain('tab-can-wrap');
  });

  it('a WRAPPING rail is still required to be a rail — flex-wrap is not a blanket pass', () => {
    // The spare above must not become an escape hatch: `flex-wrap` excuses the
    // scroll classes, it does not excuse a strip that neither wraps NOR
    // scrolls. Same markup, wrap removed.
    expect(
      kinds(`
      <div class="flex items-center gap-1 border-b border-zinc-200">
        {#each subTabs as subTab (subTab.id)}
          <button class="border-b-2 px-3 py-1.5">{subTab.label}</button>
        {/each}
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('flex-wrap on a NON-FLEX element does not excuse an overflowing strip', () => {
    // @copilot on #863: `flex-wrap` is ignored outside a flex container, so a
    // bare `flex-wrap` on an intermediate <div> changes nothing about the
    // layout. Accepting it would let a token with no effect silence the gate.
    const bogus = `
      <div class="flex gap-0 border-b border-zinc-200">
        <div class="flex-wrap">
          {#each tabs as tab (tab.id)}
            <a href={tab.href} class="border-b-2 px-4 py-2">{tab.label}</a>
          {/each}
        </div>
      </div>`;
    expect(kinds(bogus)).toContain('strip-does-not-scroll');
    // and the tab classes are still required, since nothing wraps
    expect(kinds(bogus)).toContain('tab-can-shrink');
  });

  it.each([
    ['sm:overflow-x-auto on the rail', 'flex gap-0 sm:overflow-x-auto border-b', 'shrink-0 whitespace-nowrap border-b-2'],
    ['md:overflow-x-auto on the rail', 'flex gap-0 md:overflow-x-auto border-b', 'shrink-0 whitespace-nowrap border-b-2'],
    ['a dark: variant', 'flex gap-0 dark:overflow-x-auto border-b', 'shrink-0 whitespace-nowrap border-b-2'],
  ])('%s does not satisfy the scroll requirement', (_what, railCls, tabCls) => {
    // This gate protects ONE viewport — ~308px at 390px wide — and `:` is a
    // word boundary, so a variant-prefixed class satisfies a naive \b regex
    // while being inactive at exactly that width (@codex on #860, @copilot on
    // #863). A required class that only applies from 640px up does not fix a
    // 390px overflow.
    expect(
      kinds(`
      <div class="${railCls}">
        {#each tabs as tab (tab.id)}<a class="${tabCls} px-4 py-2">{tab.label}</a>{/each}
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('sm:flex-wrap does not satisfy the WRAP requirement either', () => {
    expect(
      kinds(`
      <div class="flex items-center gap-1 sm:flex-wrap border-b">
        {#each subTabs as subTab (subTab.id)}<button class="border-b-2 px-3">{subTab.label}</button>{/each}
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('a variant-prefixed shrink-0 / whitespace-nowrap does not pin a tab', () => {
    const k = kinds(`
      <div class="flex gap-0 overflow-x-auto border-b">
        {#each tabs as tab (tab.id)}<a class="sm:shrink-0 lg:whitespace-nowrap border-b-2 px-4">{tab.label}</a>{/each}
      </div>`);
    expect(k).toContain('tab-can-shrink');
    expect(k).toContain('tab-can-wrap');
  });

  it('variant tokens on a rail do not stop it being DETECTED as a rail', () => {
    // The split that makes the rule safe: detection reads the RAW class text
    // and only the REQUIREMENTS read the unconditional subset. A rail carrying
    // responsive tweaks alongside its base classes is still found and still
    // checked, rather than being dropped because some of its tokens are
    // prefixed.
    //
    // A rail whose flex/border are ONLY variant-prefixed is also still
    // detected. That is a deliberate choice and not obviously free: at 390px
    // such an element is not a flex row at all, so flagging it is arguably a
    // false positive. It is left permissive because a false positive is LOUD
    // and gets fixed, while the alternative fails silently — which is the
    // defect this whole gate exists to stop. No instance exists in the repo.
    expect(
      kinds(`
      <div class="flex gap-0 border-b sm:gap-2 dark:border-zinc-800">
        {#each tabs as tab (tab.id)}<a class="border-b-2 px-4">{tab.label}</a>{/each}
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('a required class supplied by ONE ARM of a ternary is reported', () => {
    // @copilot on #863, and a REVERSAL of #860's decision to count interpolated
    // tokens. That decision was defensible only while every branch supplied the
    // token, and nothing checked it — so `{compact ? 'overflow-x-auto' : ''}`
    // satisfied the gate while the false arm rendered a strip that overflows.
    expect(
      kinds(`
      <div class="flex gap-0 border-b {compact ? 'overflow-x-auto' : ''}">
        {#each tabs as tab (tab.id)}<a class="shrink-0 whitespace-nowrap border-b-2 px-4">{tab.label}</a>{/each}
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('tab classes supplied only inside an interpolation are reported', () => {
    // The same rule on the other two tokens. Note this fixture has the classes
    // in BOTH arms — it is still reported, because requiring the static part is
    // deliberately blunt and errs toward reporting. Measured: no strip in src/
    // supplies a required class this way, so it costs nothing today.
    const k = kinds(`
      <div class="flex gap-0 overflow-x-auto border-b">
        {#each tabs as tab (tab.id)}<a class="border-b-2 px-4 {compact ? 'shrink-0 whitespace-nowrap' : 'shrink-0 whitespace-nowrap'}">{tab.label}</a>{/each}
      </div>`);
    expect(k).toContain('tab-can-shrink');
    expect(k).toContain('tab-can-wrap');
  });

  it('an interpolated border-b-2 is still DETECTED as a tab', () => {
    // Detection still reads the raw text, so tightening the REQUIREMENTS did
    // not shrink what the gate looks at. A tab whose underline class is
    // interpolated is found, and then reported for the classes it lacks.
    expect(
      kinds(`
      <div class="flex gap-0 border-b">
        {#each tabs as tab (tab.id)}<a class="px-4 {active ? 'border-b-2' : 'border-b-2'}">{tab.label}</a>{/each}
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('a flex-wrap WRAPPER around a single non-wrapping row does not count', () => {
    // @copilot on #863. CSS wrapping lays out only an element's DIRECT flex
    // items, so this rail wraps exactly one item — the inner row — and the tabs
    // inside it stay on one line and overflow. A path-shaped test called this
    // satisfied; the layout-container rule does not.
    const k = kinds(`
      <div class="flex flex-wrap gap-1 border-b border-zinc-200">
        <div class="flex">
          {#each tabs as tab (tab.id)}<button class="border-b-2 px-3">{tab.label}</button>{/each}
        </div>
      </div>`);
    expect(k).toContain('strip-does-not-scroll');
    expect(k).toContain('tab-can-shrink');
  });

  it('STATIC tabs nested in a wrapper do not count as wrapping either', () => {
    // @copilot on #863, second time on this rule. With no {#each} every element
    // shares a repeat depth, so a container chosen by repeat depth alone picked
    // the rail and called this wrapped. The two buttons are direct children of
    // ONE non-wrapping row, which is a single flex item of the wrapping rail —
    // so they stay on one line.
    const k = kinds(`
      <div class="flex flex-wrap border-b border-zinc-200">
        <div class="flex">
          <button class="border-b-2 px-3">One</button>
          <button class="border-b-2 px-3">Two</button>
        </div>
      </div>`);
    expect(k).toContain('strip-does-not-scroll');
    expect(k).toContain('tab-can-shrink');
  });

  it.each([
    ['whitespace-nowrap', 'whitespace-nowrap border-b-2', 'wrapping-tab-cannot-break'],
    ['shrink-0', 'shrink-0 border-b-2', 'wrapping-tab-cannot-shrink'],
  ])('a WRAPPING strip whose tabs carry %s is reported', (_what, tabCls, kind) => {
    // @copilot on #863: skipping the tab checks whenever `wraps` accepted a
    // strip that overflows, while the comment above the branch said those
    // classes were wrong here. Measured on the agent sub-tab bar at 390px, one
    // 46-char label in a 308px rail:
    //
    //   plain              308px, two lines, document overflow 0
    //   shrink-0           342px, one line,  document overflow 17px
    //   whitespace-nowrap  342px, one line,  document overflow 17px
    //
    // Either class alone reintroduces the defect, so both are reported.
    expect(
      kinds(`
      <div class="flex flex-wrap items-center gap-1 border-b border-zinc-200">
        {#each subTabs as subTab (subTab.id)}
          <div class="flex items-center"><button class="${tabCls} px-3">{subTab.label}</button></div>
        {/each}
      </div>`),
    ).toContain(kind);
  });

  it.each([
    ['whitespace-nowrap on the repeated WRAPPER', 'flex items-center whitespace-nowrap', 'wrapping-tab-cannot-break'],
    ['shrink-0 on the repeated WRAPPER', 'flex items-center shrink-0', 'wrapping-tab-cannot-shrink'],
  ])('%s is reported', (_what, wrapperCls, kind) => {
    // @codex on #863: these checks inspected only the nested <button>, so the
    // same two classes on the repeated wrapper passed. `white-space` is
    // INHERITED, and the wrapper is the direct flex item that has to fit.
    // Measured on the agent sub-tab bar at 390px, one 46-char label: either
    // class on the WRAPPER takes document overflow 0 -> 17px, with the
    // button's computed `white-space` reading `nowrap`.
    expect(
      kinds(`
      <div class="flex flex-wrap items-center gap-1 border-b border-zinc-200">
        {#each subTabs as subTab (subTab.id)}
          <div class="${wrapperCls}"><button class="border-b-2 px-3">{subTab.label}</button></div>
        {/each}
      </div>`),
    ).toContain(kind);
  });

  it('an intermediate flex item between rail and scroller needs min-w-0', () => {
    // @codex on #863, scoped by measurement. A flex item's `min-width: auto`
    // resolves to its content width, so it refuses to shrink and the page
    // overflows instead of the strip scrolling — 580px at 390px when I built
    // this shape in the running app.
    expect(
      kinds(`
      <div class="flex gap-0 border-b border-zinc-200">
        <div class="flex">
          <nav class="flex gap-0 overflow-x-auto">
            {#each tabs as tab (tab.id)}<a class="shrink-0 whitespace-nowrap border-b-2 px-4">{tab.label}</a>{/each}
          </nav>
        </div>
      </div>`),
    ).toContain('scroller-cannot-shrink');
  });

  it('the SCROLLER itself does not need min-w-0 — it is a scroll container', () => {
    // The exception, and the reason the rule is scoped to INTERMEDIATE
    // elements. Per the flexbox spec a flex item that is a scroll container has
    // an automatic minimum size of zero. Measured: forcing `min-width: auto` on
    // the scroller in both `/app/assets` and `/app/orgs/[id]` left document
    // overflow at 0, unchanged. Demanding it here would be cargo cult.
    expect(
      offences(`
      <div class="flex items-end justify-between border-b border-zinc-200">
        <nav class="flex gap-0 overflow-x-auto">
          {#each tabs as tab (tab.id)}<a class="shrink-0 whitespace-nowrap border-b-2 px-4">{tab.label}</a>{/each}
        </nav>
      </div>`),
    ).toEqual([]);
  });

  it('a tab whose border-b-2 comes from a script CONSTANT is seen', () => {
    // #858's last blind spot. `classText` reads the attribute source, so a
    // token held in a const never appeared there and the rail reported zero
    // tabs — the strip was skipped entirely, not examined and cleared. Two real
    // strips hid behind this (@copilot and @codex on #860).
    expect(
      kinds(`
      <script>
        const subTabBase = 'border-b-2 px-3 py-1.5 text-sm font-medium';
        const on = 'border-indigo-500';
        const off = 'border-transparent';
      </script>
      <div class="flex gap-1 border-b border-zinc-200">
        <button class="{subTabBase} {sub === 'a' ? on : off}">One</button>
        <button class="{subTabBase} {sub === 'b' ? on : off}">Two</button>
      </div>`),
    ).toContain('strip-does-not-scroll');
  });

  it('a resolved constant satisfies a REQUIREMENT, because it always applies', () => {
    // The other direction: `{tabBase}` is a bare identifier, so it is applied
    // unconditionally and its tokens are genuinely static. Resolving it must
    // therefore satisfy the requirements, not merely trip detection.
    expect(
      offences(`
      <script>
        const tabBase = 'shrink-0 whitespace-nowrap border-b-2 px-3 py-2';
      </script>
      <div class="flex gap-0 overflow-x-auto border-b border-zinc-200">
        <button class="{tabBase}">One</button>
        <button class="{tabBase}">Two</button>
      </div>`),
    ).toEqual([]);
  });

  it('a TERNARY is not resolved, even when its branches are constants', () => {
    // The restriction that keeps this safe. Only a BARE identifier is inlined;
    // `{a ? x : y}` does not always apply, so it stays an interpolation for
    // `staticPart` to strip. Resolving it would re-open the one-armed-ternary
    // hole closed in 2d0266f.
    //
    // The mutation that proves this is specific, and the first one I tried was
    // NOT it: resolving the branch identifiers while LEAVING the braces changes
    // nothing, because `staticPart` strips the braces either way, so this test
    // passed and looked proven. The mutation that fails it resolves the
    // branches AND drops the braces — which is what "resolving a ternary" would
    // actually mean. A weaker mutation reporting a pass is the instrument
    // measuring nothing again.
    const k = kinds(`
      <script>
        const pinned = 'shrink-0 whitespace-nowrap';
        const loose = '';
      </script>
      <div class="flex gap-0 overflow-x-auto border-b border-zinc-200">
        <button class="border-b-2 {compact ? pinned : loose}">One</button>
        <button class="border-b-2 {compact ? pinned : loose}">Two</button>
      </div>`);
    expect(k).toContain('tab-can-shrink');
    expect(k).toContain('tab-can-wrap');
  });

  it('a constant SHADOWED by an each-binding is not resolved', () => {
    // @copilot on #865. `{#each tabs as tabBase}` rebinds the name, so
    // `{tabBase}` inside that block is the loop item, not the module constant.
    // Inlining the constant's classes there would describe the element by
    // markup it does not have — a SILENT false pass.
    //
    // The response is to drop the name rather than resolve it scope-aware, and
    // the trade is deliberate: the rail becomes unresolvable, which is loud
    // (`RAILS_WITH_NO_TABS` fails on it by name) where a wrong inlining is not.
    // Here that means no strip is detected at all, so no offence is reported —
    // and the repository pin is what would catch it in a real file.
    expect(
      offences(`
      <script>
        const tabBase = 'shrink-0 whitespace-nowrap border-b-2 px-3 py-2';
      </script>
      <div class="flex gap-0 border-b border-zinc-200">
        {#each views as tabBase (tabBase.id)}
          <button class="{tabBase}">One</button>
        {/each}
      </div>`),
    ).toEqual([]);
  });

  it('a constant shadowed by {@const} is not resolved either', () => {
    // @copilot on #865, second binding form. `{@const}` is the likeliest
    // deliberate shadow of the three, since it exists to name a value computed
    // per iteration.
    expect(
      offences(`
      <script>
        const tabBase = 'shrink-0 whitespace-nowrap border-b-2 px-3 py-2';
      </script>
      <div class="flex gap-0 border-b border-zinc-200">
        {#each views as v (v.id)}
          {@const tabBase = v.klass}
          <button class="{tabBase}">One</button>
        {/each}
      </div>`),
    ).toEqual([]);
  });

  it('a constant built at runtime is NOT resolved', () => {
    // Only string literals and interpolation-free templates count. Guessing at
    // a value assembled at runtime would be worse than not seeing it — so the
    // rail is simply not resolved, which the coverage pins below record.
    expect(
      offences(`
      <script>
        const tabBase = ['border-b-2', size].join(' ');
      </script>
      <div class="flex gap-0 border-b border-zinc-200">
        <button class="{tabBase}">One</button>
        <button class="{tabBase}">Two</button>
      </div>`),
    ).toEqual([]);
  });

  it('`truncate` on the LABEL satisfies the no-wrap requirement', () => {
    // Tailwind's `truncate` IS `white-space: nowrap` (plus ellipsis), and
    // `ViewTabs` — the saved-view strip on every list page — writes it that way
    // on an inner span. Measured with its real class strings at 390px, a
    // 43-char label: with `truncate` the tab is 38px tall (one line), without
    // it 58px (two). Demanding `whitespace-nowrap` on the tab would have
    // reported correct markup rendering in every list in the portal.
    expect(
      offences(`
      <script>
        const tabBase = 'flex shrink-0 max-w-[14rem] items-center gap-1 border-b-2 px-3 py-2';
      </script>
      <div class="flex items-center gap-2 border-b border-zinc-200">
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <button class="{tabBase}"><span class="truncate">One</span></button>
          <button class="{tabBase}"><span class="truncate">Two</span></button>
        </div>
      </div>`),
    ).toEqual([]);
  });

  it('a CONDITIONAL label where only one branch truncates is reported', () => {
    // @codex and @copilot on #865. A `some()` over descendants accepted this:
    // the `{:else}` span can still wrap, so one possible label overflows. The
    // rule is now "every element child is covered", not "some descendant is".
    expect(
      kinds(`
      <div class="flex gap-0 overflow-x-auto border-b border-zinc-200">
        {#each tabs as tab (tab.id)}
          <a class="shrink-0 border-b-2 px-4">
            {#if compact}<span class="truncate">{tab.label}</span>{:else}<span>{tab.label}</span>{/if}
          </a>
        {/each}
      </div>`),
    ).toContain('tab-can-wrap');
  });

  it('an unrelated nested control with truncate does not cover a plain label', () => {
    // The other half of the same finding: `truncate` on something that is not
    // the label. The label span has no covering class, so the tab is reported.
    expect(
      kinds(`
      <div class="flex gap-0 overflow-x-auto border-b border-zinc-200">
        {#each tabs as tab (tab.id)}
          <a class="shrink-0 border-b-2 px-4">
            <span>{tab.label}</span>
            <span class="truncate text-xs">x</span>
          </a>
        {/each}
      </div>`),
    ).toContain('tab-can-wrap');
  });

  it('a tab with its OWN text cannot delegate no-wrap to a child', () => {
    // `hasOwnText`: `{tab.label}` sitting directly in the tab is text that
    // wraps like any other, so a covered child does not rescue it.
    expect(
      kinds(`
      <div class="flex gap-0 overflow-x-auto border-b border-zinc-200">
        {#each tabs as tab (tab.id)}
          <a class="shrink-0 border-b-2 px-4">{tab.label}<span class="truncate">•</span></a>
        {/each}
      </div>`),
    ).toContain('tab-can-wrap');
  });

  it('a NON-INTERACTIVE tab element is still a tab', () => {
    // @copilot on #865. `ViewTabs` renders its ACTIVE tab as a <div>, because
    // that tab contains a caret <button> and a button cannot nest in a button.
    // With `a`/`button` only, the active branch of a strip on every list page
    // was never checked, so a regression limited to it passed the gate.
    //
    // Widening was measured first: coverage is identical either way — 20 rails,
    // 13 strips, the same twelve files. `border-b-2` does the discriminating,
    // not the tag name.
    expect(
      kinds(`
      <div class="flex items-center gap-2 border-b border-zinc-200">
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <div class="flex shrink-0 border-b-2 px-3 py-2"><span>Active</span></div>
          <button class="flex shrink-0 border-b-2 px-3 py-2"><span class="truncate">Other</span></button>
        </div>
      </div>`),
    ).toContain('tab-can-wrap');
  });

  it('text rendered through {#if} directly in the tab counts as its own text', () => {
    // @copilot on #865. `hasOwnText` read only immediate fragment nodes, so
    // `{#if}{tab.label}{:else}{tab.label}{/if}` looked text-free — and the tab
    // then delegated the no-wrap requirement to a truncating span beside it,
    // while the block renders unwrapped text directly in the tab.
    //
    // The walk descends through control flow and stops at child ELEMENTS.
    expect(
      kinds(`
      <div class="flex gap-0 overflow-x-auto border-b border-zinc-200">
        {#each tabs as tab (tab.id)}
          <a class="shrink-0 border-b-2 px-4">
            {#if compact}{tab.short}{:else}{tab.label}{/if}
            <span class="truncate">•</span>
          </a>
        {/each}
      </div>`),
    ).toContain('tab-can-wrap');
  });

  it('a tab with NEITHER whitespace-nowrap nor truncate is still reported', () => {
    // The spare above must not become a blanket pass: `truncate` has to be
    // present somewhere on the tab, not merely possible.
    expect(
      kinds(`
      <div class="flex gap-0 overflow-x-auto border-b border-zinc-200">
        {#each tabs as tab (tab.id)}<a class="shrink-0 border-b-2 px-4"><span>{tab.label}</span></a>{/each}
      </div>`),
    ).toContain('tab-can-wrap');
  });

  it('reports an unparseable file rather than passing it', () => {
    // A gate that silently skips what it cannot read can be switched off by a
    // toolchain change nobody notices.
    expect(kinds('<div class="flex border-b"><button class="border-b-2">')).toContain('unparseable');
  });
});

/**
 * The gate against the REAL TREE — #858, and the finding that made it necessary.
 *
 * Every case above feeds a synthetic string to `offences()`. None of them runs
 * the repository walk, so none of them measures how much of the portal this
 * gate actually covers — and when this block was written the answer was 3 of
 * 20 rails, which is how a blind gate passed its own twelve tests and reported
 * `OK` across 153 files (@copilot on #860). The counts live in the assertions
 * below rather than in this paragraph, which is the only way a coverage note
 * stops going stale — it went stale twice while #858 was being closed.
 *
 * `check-grid-filters.test.ts` and `check-hook-teardown.test.ts` assert against
 * the real tree; this file did not. These are that assertion, and the
 * file-count floor is the half that is easy to omit — a walk over zero files
 * produces `[]` exactly like a clean tree does
 * (`hrn:node:hadronmemory.com:hadron-portal:review:a-spare-test-must-reach-the-matcher`).
 */
describe('the repository as it stands', () => {
  const scan = () =>
    svelteFilesUnder('src').map((file) => ({ file, ...analyse(readFileSync(file, 'utf8')) }));

  /**
   * The strips this predicate can currently SEE, by path.
   *
   * Exact rather than a count, so the coverage set cannot change silently.
   *
   * Every strip the portal has is now here — #858's three predicate fixes
   * ({#each}, Tailwind variants, class constants) closed the last of the blind
   * spots, and this list grew from three files to twelve across them. The
   * rails NOT here are pinned separately as `RAILS_WITH_NO_TABS`, so "the rest
   * are not strips" is an assertion rather than an assumption.
   *
   * If you are here because you added a tab strip, add it — and check the gate
   * really SEES it rather than only appending the path. If you are here because
   * this failed unexpectedly, a rail has changed shape and that is the question
   * to answer before editing the list.
   */
  const SEEN_AS_STRIPS = [
    'src/lib/components/table/ViewTabs.svelte',
    'src/routes/app/account/+layout.svelte',
    'src/routes/app/agents/[id]/+page.svelte',
    'src/routes/app/apps/[appId]/+page.svelte',
    'src/routes/app/assets/+page.svelte',
    'src/routes/app/memories/+page.svelte',
    'src/routes/app/memories/[id]/+layout.svelte',
    'src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte',
    'src/routes/app/orgs/[id]/+layout.svelte',
    'src/routes/app/orgs/[id]/agents/+page.svelte',
    'src/routes/app/orgs/[id]/memories/+page.svelte',
    'src/routes/app/workers/[id]/+page.svelte',
  ];

  /** Thirteen strips across twelve files — the agent detail page carries two. */
  const STRIPS_TOTAL = 13;

  /**
   * The rails that resolve to NO tabs — pinned by name, because the CI line
   * says they are not tab strips and that is an inference the predicate does
   * not make (@codex on #865).
   *
   * Each was read and is genuinely not a strip: a chat header, a banner, a
   * browser header, a form row, two editor toolbars, a marketing panel. What
   * makes the claim safe is that this list is EXACT — a new rail landing here
   * because its classes come from an imported or runtime-built constant fails
   * this test rather than being quietly described as a non-strip.
   */
  const RAILS_WITH_NO_TABS = [
    'src/lib/components/AgentChat.svelte',
    'src/lib/components/ImpersonationBanner.svelte',
    'src/lib/components/MemoryBrowser.svelte',
    'src/lib/components/SelectUser.svelte',
    'src/lib/dashboard/DashboardEditor.svelte',
    'src/lib/dashboard/DashboardEditor.svelte',
    'src/routes/+page.svelte',
    // #919: the profile page's strip holds ONE tab (Workers) today, below the
    // gate's two-tab threshold. It is a real strip and is already written the
    // scrolling way (overflow-x-auto rail, shrink-0 whitespace-nowrap tab), so
    // it needs no exemption from the rule, only from this count: move it to
    // SEEN_AS_STRIPS when a second tab lands.
    'src/routes/app/user/[id]/+page.svelte',
  ];

  it('the rails resolving to NO tabs are exactly the known non-strips', () => {
    const noTabRails: string[] = [];
    for (const { file, railsSeen, stripsSeen } of scan()) {
      for (let i = 0; i < railsSeen - stripsSeen; i += 1) noTabRails.push(file);
    }
    expect(noTabRails.sort()).toEqual([...RAILS_WITH_NO_TABS].sort());
  });

  it('walks a plausible number of real .svelte files', () => {
    // The mirror of every "no offences" assertion in this file: an empty file
    // list produces the same clean result as a clean tree, so the walk has to
    // be proven to have happened at all.
    expect(svelteFilesUnder('src').length).toBeGreaterThan(100);
  });

  it('has no tab strip that stops scrolling', () => {
    const offenders = scan()
      .filter((r) => r.offences.length > 0)
      .map((r) => `${r.file}: ${r.offences.map((o: { kind: string }) => o.kind).join(', ')}`);
    expect(offenders).toEqual([]);
  });

  it('recognises exactly the strips it is known to cover, BY NAME', () => {
    const seen = scan()
      .filter((r) => r.stripsSeen > 0)
      .map((r) => r.file)
      .sort();
    expect(seen).toEqual(SEEN_AS_STRIPS);
  });

  it('finds far more rails than it can resolve into strips — the gap IS #858', () => {
    const rails = scan().reduce((n, r) => n + r.railsSeen, 0);
    const strips = scan().reduce((n, r) => n + r.stripsSeen, 0);

    expect(strips).toBe(STRIPS_TOTAL);
    // A floor, not an equality: an unrelated PR adding a `flex border-b` row
    // should not fail this suite, but the walk collapsing should.
    expect(rails).toBeGreaterThanOrEqual(20);
    // Stated as an assertion so it reads as a defect under repair rather than a
    // property of the design. Delete it when the gap closes.
    expect(rails).toBeGreaterThan(strips);
  });

  it('WOULD flag a real repository file that lost its scroll class', () => {
    // The other direction, run over real content rather than a fixture: proof
    // that the walk reaches the matcher and that a genuine regression in a
    // covered file fails. #859's mutation check missed its bug by mutating one
    // case; this mutates EVERY instance and asserts the mutation applied, since
    // a no-op edit reads as a passing guard.
    const file = 'src/routes/app/memories/[id]/nodes/[nodeId]/+page.svelte';
    const original = readFileSync(file, 'utf8');
    const mutated = original.replaceAll('overflow-x-auto', '');

    expect(mutated).not.toBe(original);
    expect(analyse(original).offences).toEqual([]);
    expect(offences(mutated).map((o) => o.kind)).toContain('strip-does-not-scroll');
  });
});
