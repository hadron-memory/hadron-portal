#!/usr/bin/env node
/**
 * #858 — a horizontal tab strip in the portal's narrow content column must
 * scroll rather than push the page off a phone screen.
 *
 * The content column is ~308px at a 390px viewport. A strip of tabs wider than
 * that overflows the DOCUMENT unless the strip carries `overflow-x-auto`, and
 * unless each tab carries `shrink-0 whitespace-nowrap` — without those, flex
 * compresses the labels into unreadable columns instead of letting the strip
 * scroll. PR #746 established the fix on the App detail page; #854 found the
 * identical defect on the node detail page months later; #859 fixed four more,
 * one of which (`/app/account`) was overflowing the document by 10px and nobody
 * had noticed.
 *
 * Two instances of one class across a gap of months is the argument for a gate.
 *
 * ## Why this PARSES instead of grepping
 *
 * #859 shipped a stop-gap test that matched tokens against file source, and it
 * was decoration for three of the four files it covered: the COMMENTS
 * explaining each fix contained `overflow-x-auto`, `shrink-0` and
 * `whitespace-nowrap`, so deleting a real class left every assertion green.
 * Stripping comments fixes that much — but a regex still cannot answer the
 * question that matters, which is WHICH element scrolls. A file can carry the
 * token on an unrelated row while the actual strip has lost it.
 *
 * So this walks the Svelte AST and checks containment: for every tab found
 * under a rail, some element on the path from the rail DOWN TO that tab must
 * carry `overflow-x-auto`. `/app/assets` is why that path matters rather than
 * just the rail — its rail is a `justify-between` row and the scrolling element
 * is the inner `<nav>` holding the tabs.
 *
 * ## What counts as a tab strip
 *
 * Shape, not ARIA. An `role="tablist"`-keyed rule was tried on paper and is
 * WRONG here: the node detail page's strip is plain `<button>`s with no roles
 * at all, so it would miss the only page that was actually broken while
 * flagging one that was not.
 *
 *   rail — an element whose class carries `flex` and `border-b` (the underline
 *          rail every tab strip in this repo draws), but not `border-b-2`
 *   tab  — an `<a>` or `<button>` under that rail whose class carries
 *          `border-b-2` (the per-tab underline)
 *
 * A rail with two or more tabs is a strip. Two, not three: `/app/memories` and
 * `/app/orgs/[id]/agents` both have exactly two and both sat at exactly 308px
 * in a 308px column — one added tab or one longer translated label from
 * breaking.
 *
 * The pair is deliberately narrow. It does NOT fire on a segmented control
 * (`role="group"` with two buttons and no bottom rail) or a button row, which
 * are not tab strips and for which `overflow-x-auto` would be noise — per
 * `hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`,
 * a gate that over-fires grows an exclusion list, and an exclusion list is
 * where a real offender hides. This gate has no exclusion list.
 *
 * ## The caveat it enforces, stated because it is a real cost
 *
 * Setting `overflow-x` to a non-visible value forces the computed `overflow-y`
 * to `auto`. A strip rendering something VERTICALLY outside its box — a
 * dropdown, an absolutely-positioned badge — would begin clipping. Every strip
 * in this repo is plain text tabs (the orgs count badge rides inside its button
 * in normal inline flow), so none does. A future strip with a popover in it
 * should keep `shrink-0` on the tabs and suppress this check deliberately,
 * with a comment saying why — not by quietly widening the rail predicate.
 *
 * ## WHAT THIS GATE SEES — read this before trusting a green run
 *
 * Measured on this commit: of TWENTY rails in `src/`, this predicate recognises
 * THIRTEEN as tab strips. A green run means "the 13 strips I can parse are
 * fine", NOT "every tab strip in the portal is safe at phone width".
 *
 * "Safe", not "scrolls": a `flex-wrap` strip passes without scrolling at all.
 *
 * The other SEVEN are not blind spots. Each was examined and is genuinely not a
 * tab strip — a header row, a banner, a toolbar, an aspect-ratio box: `flex` +
 * `border-b` with no `border-b-2` children. They are true negatives, and the
 * `border-b-2` requirement is what excludes them. Listing them here because
 * "20 rails, 13 strips" otherwise reads as seven more things to fix, which is
 * how a denominator becomes its own kind of false claim:
 *
 *   AgentChat, ImpersonationBanner, MemoryBrowser, SelectUser,
 *   DashboardEditor (x2), routes/+page
 *
 * FIXED, and recorded because the shape recurs: a class token supplied by a
 * script CONSTANT used to be invisible — `classText` reads the attribute source,
 * so `class="{subTabBase} …"` showed no `border-b-2` and the rail reported zero
 * tabs. Two real strips hid behind it, `ViewTabs` (which renders on every list
 * page) and `/app/orgs/[id]/memories` (which was genuinely broken).
 * `classConstants`/`inlineConstants` are the repair, and they inline ONLY a
 * bare identifier — a ternary stays conditional.
 *
 * FIXED, and recorded because the shape recurs: a Tailwind VARIANT used to
 * satisfy every one of these regexes — `sm:overflow-x-auto` matches a `\b`
 * pattern because `:` is a word boundary, while applying only from 640px up.
 * `unconditional()` is the repair, and the detection/requirement split below is
 * what keeps it from causing the opposite failure.
 *
 * FIXED, and recorded because the shape recurs: `{#each}` used to account for
 * eight more. A looped strip is ONE `<a>`/`<button>` node in the AST however
 * many tabs it renders, so counting AST nodes reported one tab and skipped the
 * rail — including all three strips #859 fixed. `repeats` in
 * `elementsWithAncestry` is the repair. Teaching the gate to see them found two
 * unguarded strips immediately, one of which was real (`/app/orgs/[id]`).
 *
 * There is no known blind spot left. That is a stronger claim than this file
 * has ever made, so it is the one to re-verify rather than inherit: the
 * suite pins WHICH strips are seen, by name, and `railsSeen` beside
 * `stripsSeen` is what would show the gap reopening.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'svelte/compiler';

/** `border-b` but not `border-b-2` / `border-b-4`: `-` is a word boundary. */
const RAIL_BORDER = /\bborder-b(?![-\w])/;
const TAB_BORDER = /\bborder-b-2(?![-\w])/;
const FLEX = /\bflex(?![-\w])/;
const SCROLLS = /\boverflow-x-auto\b/;
const NO_SHRINK = /\bshrink-0\b/;
/**
 * What stops a tab's label wrapping. `truncate` is the second spelling and has
 * to be here: Tailwind's `truncate` IS `overflow:hidden; text-overflow:ellipsis;
 * white-space:nowrap`, so it satisfies this requirement outright.
 *
 * `ViewTabs.svelte` — the saved-view strip on EVERY list page — writes it that
 * way, `truncate` on the label span inside a `max-w-[14rem]` tab. Measured with
 * its real class strings at 390px, one 43-char label: with `truncate` the tab
 * is 224px and 38px tall (one line); without it, 58px tall (two lines). The
 * span's computed `white-space` reads `nowrap` in the first case.
 *
 * Demanding `whitespace-nowrap` there would have been a false positive on a
 * component rendering in every list in the portal — and the "fix" would have
 * been to add a redundant class to correct markup.
 */
const NO_WRAP = /\b(?:whitespace-nowrap|truncate)\b/;

/**
 * `flex-wrap` is the OTHER correct answer to #858, and the gate has to know it.
 *
 * The requirement is that a strip must not push the page off a phone screen.
 * Scrolling is one way; wrapping onto a second line is another, and the chatbot
 * sub-tab bar on the agent detail page chose it deliberately (`flex flex-wrap
 * gap-1`). Demanding `overflow-x-auto` there would be a FALSE POSITIVE, and
 * demanding `shrink-0 whitespace-nowrap` would be actively wrong — those exist
 * to stop a non-wrapping strip squashing, and on a wrapping rail
 * `whitespace-nowrap` makes a long label unbreakable, which is how you get the
 * overflow back.
 *
 * So a wrapping rail is not an exclusion: it is a second satisfying shape, and
 * the tests pin both. Per
 * `hrn:node:hadronmemory.com:hadron-portal:review:ci-gate-prefilter-must-be-proven`,
 * the alternative — listing this file as an exception — is where a real
 * offender would later hide.
 *
 * It is only satisfying ON A FLEX CONTAINER, though: `flex-wrap` is ignored
 * outside one, so this token is always tested together with `FLEX` on the SAME
 * element. A bare `flex-wrap` on a non-flex ancestor changes nothing about the
 * layout and must not excuse a strip that overflows.
 */
const WRAPS = /\bflex-wrap\b/;

/** `min-w-0` — what lets a flex item shrink below its content. */
const CAN_SHRINK = /\bmin-w-0\b/;

/**
 * Tags that can be a tab.
 *
 * `div`/`span`/`li` are here because a tab is not always an interactive
 * element: `ViewTabs` renders its ACTIVE tab as a `<div>`, since that tab
 * contains a caret `<button>` and a button cannot nest inside a button. With
 * `a`/`button` only, the active branch of a strip on every list page in the
 * portal was never checked, so a regression limited to it would pass
 * (@copilot on #865).
 *
 * Measured before widening, because a wider tab predicate is how a gate starts
 * over-firing: coverage is IDENTICAL either way — 20 rails, 13 strips, the same
 * twelve files. It reclassifies nothing; it only stops skipping the active tab.
 * The `border-b-2` requirement is what does the discriminating, not the tag.
 */
const TAB_TAGS = new Set(['a', 'button', 'div', 'span', 'li']);

/**
 * Class text with every VARIANT-PREFIXED token dropped.
 *
 * This gate protects exactly ONE viewport — the ~308px content column at 390px
 * — and a Tailwind variant is the one way to carry a required class while it is
 * inactive there. `sm:overflow-x-auto` satisfies a word-boundary regex (`:` IS
 * a word boundary) while applying only from 640px up, so the phone-width
 * overflow this gate exists to catch would sail through CI. `dark:` and
 * `hover:` are conditional for different reasons and are no better.
 *
 * Dropping any token containing `:` is deliberately blunt and errs toward
 * REPORTING: an element whose required class is conditional gets flagged, which
 * is the safe direction for a gate about a layout defect.
 *
 * This runs on the output of `staticPart`, not on raw class text, so by the
 * time it sees anything the interpolations are already gone and branch tokens
 * do NOT count — see `staticPart` for why that reversed #860. Its own job is
 * only the variant prefixes.
 *
 * @copilot on #863, and #858's fourth fix.
 */
function unconditional(cls) {
  return cls
    .split(/\s+/)
    .filter((token) => !token.includes(':'))
    .join(' ');
}

/**
 * Class text with every `{…}` interpolation removed, leaving what is applied
 * UNCONDITIONALLY.
 *
 * This REVERSES a decision made in #860, and the reversal is the point.
 * `classText` deliberately kept interpolations so that
 * `class="border-b-2 {compact ? 'shrink-0' : 'shrink-0'}"` would not be
 * reported for a class the element really does have. But that reasoning only
 * holds when EVERY branch supplies the token, and nothing checked that:
 * `{compact ? 'overflow-x-auto' : ''}` satisfied the predicate while the false
 * arm rendered a strip that overflows (@copilot on #863).
 *
 * Requiring the token in the static part is blunt, and it can report a strip
 * that genuinely interpolates a layout class in every branch. Measured across
 * `src/`: NO strip supplies any of the four required classes only from inside
 * an interpolation, so that costs nothing today — and if one is written later,
 * a false positive is loud and gets fixed, where this false negative was
 * silent. Same trade as the detection/requirement split above, in the same
 * direction.
 *
 * Interpolations are still read for DETECTION, so a tab whose `border-b-2` is
 * interpolated is still found and still checked.
 */
function staticPart(cls) {
  let out = '';
  let depth = 0;
  for (const ch of cls) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
}

/**
 * The full text of an element's `class`, expressions included.
 *
 * Taken as a raw source slice rather than by reading Text nodes, because a
 * Svelte class is routinely part static and part interpolated —
 * `class="border-b-2 px-4 {active ? 'x' : 'y'}"` — and DETECTION must see the
 * whole thing: a tab whose `border-b-2` is interpolated is still a tab.
 *
 * What this returns is therefore the RAW text, used for detection only.
 * REQUIREMENTS read `el.active`, which is this run through `staticPart` and
 * `unconditional` — so an interpolated or variant-prefixed token does NOT
 * satisfy a requirement. That split is deliberate and each half has tests;
 * see the note on `staticPart`.
 *
 * Returns '' for an element with no class at all, and for `class:foo` directives
 * (a different attribute type), which no strip in this repo uses for these
 * layout tokens.
 */
/**
 * Module-level `const NAME = 'string literal'` declarations, as a name → text
 * map. Only plain string literals and interpolation-free template literals
 * count: a value assembled at runtime is not something this can resolve, and
 * guessing would be worse than not seeing it.
 *
 * This is #858's last blind spot. A strip written as
 *
 *   const subTabBase = 'border-b-2 px-3 py-1.5 …';
 *   <button class="{subTabBase} {active ? … : …}">
 *
 * carries `border-b-2` nowhere in the attribute source, so `classText` saw a
 * tabless rail and the strip was skipped entirely (@copilot and @codex on
 * #860). Two real strips hid behind it.
 */
/**
 * Every name bound by the TEMPLATE — `{#each … as name, i}`, `{#await … then
 * name}`, `{#snippet name(param)}`, `{:catch e}`.
 *
 * Collected so `classConstants` can refuse to resolve a name the template
 * rebinds. `{#each tabs as tabBase}` makes `{tabBase}` inside that block the
 * loop item, NOT the module constant, and inlining the constant's classes there
 * would describe an element by markup it does not have (@copilot on #865).
 *
 * The response is to DROP such a name rather than to resolve it scope-aware.
 * That is deliberate: the result is a rail this gate cannot resolve, and an
 * unresolvable rail is not silent — it lands in `railsSeen - stripsSeen`, where
 * the `RAILS_WITH_NO_TABS` pin fails on it by name. A wrong inlining would be
 * silent; a dropped one is loud. No instance exists in the repo today.
 */
function templateBoundNames(ast) {
  const names = new Set();
  const addPattern = (pattern) => {
    if (!pattern || typeof pattern !== 'object') return;
    if (pattern.type === 'Identifier') names.add(pattern.name);
    for (const value of Object.values(pattern)) {
      if (Array.isArray(value)) value.forEach(addPattern);
      else if (value && typeof value === 'object' && 'type' in value) addPattern(value);
    }
  };
  const seen = new Set();
  const walk = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    if (node.type === 'EachBlock') {
      addPattern(node.context);
      if (node.index) names.add(node.index);
    }
    if (node.type === 'AwaitBlock') {
      addPattern(node.value);
      addPattern(node.error);
    }
    if (node.type === 'SnippetBlock') {
      if (node.expression?.type === 'Identifier') names.add(node.expression.name);
      (node.parameters ?? []).forEach(addPattern);
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value === 'object' && 'type' in value) walk(value);
    }
  };
  walk(ast.fragment);
  return names;
}

function classConstants(ast) {
  const found = new Map();
  const shadowed = templateBoundNames(ast);
  const body = ast.instance?.content?.body ?? [];
  for (const node of body) {
    if (node.type !== 'VariableDeclaration' || node.kind !== 'const') continue;
    for (const d of node.declarations ?? []) {
      if (d.id?.type !== 'Identifier' || !d.init) continue;
      // A name the template rebinds is not this constant wherever it appears,
      // so it is not resolved at all. See `templateBoundNames`.
      if (shadowed.has(d.id.name)) continue;
      if (d.init.type === 'Literal' && typeof d.init.value === 'string') {
        found.set(d.id.name, d.init.value);
      } else if (d.init.type === 'TemplateLiteral' && d.init.expressions?.length === 0) {
        found.set(d.id.name, d.init.quasis.map((q) => q.value.cooked ?? '').join(''));
      }
    }
  }
  return found;
}

/**
 * Inline `{name}` interpolations that resolve to a known string constant.
 *
 * ONLY a bare identifier is inlined, and that restriction is the whole safety
 * of it: `{tabBase}` always applies, so its tokens are genuinely unconditional
 * and belong in the static text. `{active ? a : b}` does NOT always apply, so
 * it is left as an interpolation for `staticPart` to strip — resolving it would
 * re-open the one-armed-ternary hole closed in 2d0266f.
 */
function inlineConstants(cls, constants) {
  if (constants.size === 0) return cls;
  return cls.replace(/\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name) =>
    constants.has(name) ? constants.get(name) : whole,
  );
}

function classText(el, source, constants = new Map()) {
  const attr = (el.attributes ?? []).find((a) => a.type === 'Attribute' && a.name === 'class');
  if (!attr) return '';
  if (attr.value === true) return '';
  const parts = Array.isArray(attr.value) ? attr.value : [attr.value];
  if (parts.length === 0) return '';
  const start = parts[0].start;
  const end = parts[parts.length - 1].end;
  const raw =
    typeof start === 'number' && typeof end === 'number' ? source.slice(start, end) : '';
  return inlineConstants(raw, constants);
}

/**
 * Every element in the template, each with the chain of element ancestors
 * above it — the chain is what makes the containment check possible — and with
 * `repeats`, the number of `{#each}` bodies it sits inside.
 *
 * `repeats` exists because THE AST IS NOT THE PAGE. A strip written as
 *
 *   <div class="flex gap-0 border-b">
 *     {#each tabs as tab}<a class="border-b-2">{tab.label}</a>{/each}
 *   </div>
 *
 * contains exactly ONE `<a>` node however many tabs it renders, so counting AST
 * nodes reported one tab and the rail was skipped as "not a strip". That is the
 * single biggest hole this gate shipped with — eight of twenty rails, including
 * all three strips #859 fixed (@codex on #860).
 *
 * Only the each block's BODY increments the count. Its `{:else}` fallback
 * renders when the collection is empty, so an element there is rendered at most
 * once and is not repeated.
 */
export function elementsWithAncestry(ast, source) {
  // Resolved once per file, not per element: the map is module-scoped.
  const constants = classConstants(ast);
  const found = [];
  const seen = new Set();
  const visit = (node, ancestors, repeats) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    let nextAncestors = ancestors;
    if (node.type === 'RegularElement') {
      const cls = classText(node, source, constants);
      // Text belonging to THIS element rather than to a child — a plain text
      // node, or an expression tag like `{tab.label}`, which wraps the same
      // way. Used by `cannotWrap`: an element with its own text cannot delegate
      // the no-wrap requirement to its children.
      const hasOwnText = (node.fragment?.nodes ?? []).some(
        (c) =>
          (c.type === 'Text' && (c.data ?? c.raw ?? '').trim() !== '') ||
          c.type === 'ExpressionTag',
      );
      const el = {
        name: node.name,
        hasOwnText,
        // `cls` is the raw class text and is what DETECTION reads — whether a
        // thing is a rail or a tab. Permissive on purpose: a strip whose
        // `border-b` is variant-prefixed is still a strip worth checking, and
        // being strict here would make the gate MISS it.
        cls,
        // `active` keeps only the unconditionally-applied tokens and is what
        // REQUIREMENTS read — whether it scrolls, wraps, or pins its tabs.
        // Strict on purpose, twice over: a required class that only applies
        // from 640px up does not fix a 390px overflow, and one that only
        // applies on one arm of a ternary does not fix the other arm.
        active: unconditional(staticPart(cls)),
        start: node.start,
        ancestors,
        repeats,
      };
      found.push(el);
      nextAncestors = [...ancestors, el];
    }
    for (const [key, value] of Object.entries(node)) {
      const childRepeats = node.type === 'EachBlock' && key === 'body' ? repeats + 1 : repeats;
      if (Array.isArray(value)) value.forEach((c) => visit(c, nextAncestors, childRepeats));
      else if (value && typeof value === 'object' && 'type' in value)
        visit(value, nextAncestors, childRepeats);
    }
  };
  visit(ast.fragment, [], 0);
  return found;
}

/**
 * One source, analysed: the strips this predicate could SEE, and the offences
 * among them. The two are returned together on purpose — a caller that reports
 * offences without reporting how many strips it recognised is reporting "no
 * problems found" when the honest claim is "nothing examined". That gap is what
 * the blind-spot note above is about, and `stripsSeen` is the number the gate's
 * own suite asserts on so the coverage cannot silently drop to zero.
 */
export function analyse(source) {
  let ast;
  try {
    ast = parse(source, { modern: true });
  } catch {
    // A file this parser cannot read is not a silent pass: say so, so a syntax
    // change in the toolchain cannot turn the gate off without anyone noticing.
    return {
      railsSeen: 0,
      stripsSeen: 0,
      offences: [{ kind: 'unparseable', detail: 'svelte/compiler could not parse this file' }],
    };
  }

  const all = elementsWithAncestry(ast, source);
  const rails = all.filter((e) => FLEX.test(e.cls) && RAIL_BORDER.test(e.cls) && !TAB_BORDER.test(e.cls));
  const out = [];
  let stripsSeen = 0;

  for (const rail of rails) {
    const tabs = all.filter(
      (e) => TAB_TAGS.has(e.name) && TAB_BORDER.test(e.cls) && e.ancestors.includes(rail),
    );
    // A tab inside an `{#each}` that is itself inside this rail stands for
    // however many the loop renders — which is the whole reason the strip was
    // written as a loop. Counting it as ONE is what made eight rails invisible,
    // so it counts as "enough to be a strip" on its own.
    //
    // `> rail.repeats` rather than `> 0`: when the RAIL is itself inside an
    // each block, only a FURTHER each block between rail and tab means the tabs
    // repeat within one strip.
    const effectiveTabs = tabs.reduce((n, t) => n + (t.repeats > rail.repeats ? 2 : 1), 0);
    if (effectiveTabs < 2) continue;
    stripsSeen += 1;

    // Containment: the element that solves the overflow may be the rail itself
    // or anything between it and the tabs — `/app/assets` scrolls on an inner
    // <nav>, and a wrapping rail wraps for everything below it.
    const pathTo = (tab) => [rail, ...tab.ancestors.slice(tab.ancestors.indexOf(rail) + 1)];
    const satisfies = (pred) => tabs.every((tab) => pathTo(tab).some((el) => pred(el)));

    // Scrolling IS path-shaped: an `overflow-x-auto` anywhere above the tabs
    // creates a scroll container that contains their overflow.
    const scrolls = satisfies((el) => SCROLLS.test(el.active));

    // A flex item cannot shrink below its content unless it can: `min-width`
    // defaults to `auto`, which resolves to the content-based minimum.
    //
    // This matters ONLY for an element BETWEEN the rail and the scroller,
    // and the exception is the reason. Per the flexbox spec a flex item that is
    // itself a SCROLL CONTAINER has an automatic minimum size of zero — so the
    // scroller does not need `min-w-0` to shrink, and in this repo the scroller
    // is always a direct child of the rail. Measured, because @codex read it
    // the other way and named two real files: forcing `min-width: auto` on the
    // scroller in BOTH `/app/assets` and `/app/orgs/[id]` leaves document
    // overflow at 0, unchanged, with the strip still scrolling.
    //
    // Insert one non-scrolling flex `<div>` between rail and scroller, though,
    // and the same forcing takes document overflow from 0 to 580px — that
    // element has no `overflow` of its own, so its automatic minimum binds and
    // it refuses to shrink. That shape has no instance here yet, which is
    // exactly when it is cheap to gate.
    const scrollerFor = (tab) => pathTo(tab).find((el) => SCROLLS.test(el.active));
    if (scrolls) {
      const blockers = new Set();
      for (const tab of tabs) {
        const chain = pathTo(tab);
        const scroller = scrollerFor(tab);
        for (const el of chain.slice(1, chain.indexOf(scroller))) {
          if (!CAN_SHRINK.test(el.active) && !SCROLLS.test(el.active)) blockers.add(el);
        }
      }
      for (const el of blockers) out.push({ kind: 'scroller-cannot-shrink', start: el.start });
    }

    /**
     * The element that actually LAYS OUT a tab — whose flex rules decide
     * whether that tab wraps.
     *
     * Wrapping is NOT path-shaped, which is the difference from scrolling:
     * `flex-wrap` only wraps an element's DIRECT flex items (@copilot on #863).
     * A `flex flex-wrap` rail whose tabs sit inside a single inner `flex` row
     * wraps that one row and nothing else — the tabs stay on one line and
     * overflow, while a path-shaped test would call the strip satisfied.
     *
     * So: climb from the tab while each element still stands for exactly ONE
     * RENDERED tab. The first element that does not is the container laying
     * those units out; the one below it is the item.
     *
     * NOT "the highest element sharing the tab's repeat depth" — that was the
     * first attempt and it is wrong for STATIC tabs, where every element shares
     * depth 0 and the search returns the rail (@copilot on #863). Repeat depth
     * is one input to `holdsOneRenderedTab`, not the question.
     *
     *   rail(flex-wrap) > {#each} div > button   -> container RAIL,      wraps ✓
     *   rail(flex-wrap) > div.flex > {#each} a   -> container div.flex,  no    ✗
     *   rail(flex-wrap) > div.flex > button ×2   -> container div.flex,  no    ✗
     *   rail(flex-wrap) > button ×2              -> container RAIL,      wraps ✓
     */
    /**
     * Does this element stand for exactly ONE RENDERED tab?
     *
     * Both halves are needed. One tab NODE under it is not enough — if that
     * node repeats deeper than the element does, the element holds the whole
     * loop, so many rendered tabs share it as a single flex item.
     */
    /**
     * Can NO text inside this element wrap?
     *
     * `white-space` is inherited, so the class may sit on the element or on
     * everything below it — but "somewhere below it" is NOT enough, which is
     * the correction here. A `some()` over descendants accepted
     * `{#if compact}<span class="truncate">…{:else}<span>…{/if}`, where one
     * possible label still wraps, and accepted an unrelated nested control
     * carrying `truncate` beside a plain label (@codex and @copilot on #865).
     *
     * So: the element itself carries it, OR it has no text of its own and
     * EVERY element child is covered in the same way. `ViewTabs`'s tab is a
     * <button> whose sole child is `<span class="truncate">{v.name}</span>` —
     * no own text, one covered child — which is why that real case passes
     * while both counter-examples do not.
     *
     * `hasOwnText` counts an expression tag too: `{tab.label}` sitting directly
     * in the tab is text that wraps like any other.
     */
    const childrenOf = (el) =>
      all.filter((e) => e.ancestors.length > 0 && e.ancestors[e.ancestors.length - 1] === el);
    const cannotWrap = (el) => {
      if (NO_WRAP.test(el.active)) return true;
      if (el.hasOwnText) return false;
      const kids = childrenOf(el);
      return kids.length > 0 && kids.every(cannotWrap);
    };

    const tabsUnder = (el) => tabs.filter((t) => t === el || t.ancestors.includes(el));
    const holdsOneRenderedTab = (el) => {
      const under = tabsUnder(el);
      return under.length === 1 && under[0].repeats === el.repeats;
    };

    /**
     * The container that lays a tab out, and the ITEM it lays out.
     *
     * Both matter. The container's `flex-wrap` decides whether the units wrap.
     * The ITEM — the repeated wrapper when there is one, the tab otherwise — is
     * the box that actually has to fit, so `shrink-0` on a wrapper stops it
     * fitting, and `whitespace-nowrap` on a wrapper is INHERITED by the tab
     * inside it and stops its label breaking (@codex on #863). Measured on the
     * agent sub-tab bar at 390px with one 46-char label: either class on the
     * WRAPPER takes document overflow from 0 to 17px, and the button's computed
     * `white-space` reads `nowrap` — inheritance, not a coincidence.
     */
    const layoutOf = (tab) => {
      // `pathTo` stops above the tab, because a SCROLLER may be the rail or
      // anything between — never the tab itself. The layout container is found
      // from the chain WITH the tab on the end, since a tab that is its own
      // unit is laid out by the rail directly.
      const chain = [...pathTo(tab), tab];
      // Climb while each element still stands for one rendered tab. The first
      // element that does NOT is the one laying those units out — it is the
      // flex container whose items they are, and whose `flex-wrap` decides
      // whether they wrap. The one below it is the item.
      let i = chain.length - 1;
      while (i > 0 && holdsOneRenderedTab(chain[i])) i -= 1;
      return { container: chain[i], item: chain[i + 1] ?? tab };
    };
    // `flex-wrap` only does anything on a FLEX CONTAINER — the property is
    // ignored outside one. So the wrapping element must carry `flex` (or
    // `inline-flex`, which FLEX also matches) AS WELL, on the same element.
    // Accepting a bare `flex-wrap` anywhere on the path would let a token with
    // no effect excuse a strip that genuinely overflows (@copilot on #863).
    const wraps = tabs.every((tab) => {
      const { container } = layoutOf(tab);
      return !!container && WRAPS.test(container.active) && FLEX.test(container.active);
    });

    if (!scrolls && !wraps) {
      out.push({ kind: 'strip-does-not-scroll', start: rail.start, tabs: tabs.length });
    }

    // The two solutions want OPPOSITE tab classes, so the requirement inverts
    // rather than switching off.
    //
    // A SCROLLING strip needs its tabs pinned — without `shrink-0` flex squashes
    // them, without `whitespace-nowrap` labels wrap and the strip grows down.
    //
    // A WRAPPING strip needs them NOT pinned, and that is not a style opinion.
    // Measured in the running app on the agent sub-tab bar at 390px, same 46-char
    // label in a 308px rail:
    //
    //   plain                 tab 308px, 2 lines,  document overflow 0
    //   shrink-0              tab 342px, 1 line,   document overflow 17px
    //   whitespace-nowrap     tab 342px, 1 line,   document overflow 17px
    //
    // Either class alone reintroduces exactly the defect this gate exists to
    // prevent, so a wrapping rail carrying them is REPORTED. Skipping the tab
    // checks entirely — which is what this did — accepted a strip that
    // overflows, while the comment above claimed those classes were wrong
    // (@copilot on #863).
    //
    // On a wrapping strip the LAYOUT ITEM is checked as well as the tab, and it
    // is not a formality: the item is the box that has to fit, `white-space` is
    // INHERITED, and the same two classes on a repeated wrapper produce the
    // same 17px (@codex on #863). Checking only the nested tab passed that.
    for (const tab of tabs) {
      if (wraps) {
        const { item } = layoutOf(tab);
        const boxes = item === tab ? [tab] : [tab, item];
        for (const box of boxes) {
          if (NO_SHRINK.test(box.active))
            out.push({ kind: 'wrapping-tab-cannot-shrink', start: box.start });
          if (NO_WRAP.test(box.active))
            out.push({ kind: 'wrapping-tab-cannot-break', start: box.start });
        }
      } else {
        if (!NO_SHRINK.test(tab.active)) out.push({ kind: 'tab-can-shrink', start: tab.start });
        if (!cannotWrap(tab)) out.push({ kind: 'tab-can-wrap', start: tab.start });
      }
    }
  }
  // `railsSeen` is reported beside `stripsSeen` because THE GAP BETWEEN THEM IS
  // THE BUG. A rail this predicate found but could not resolve into 2+ tabs is
  // not an innocent bystander — it is a tab strip going unchecked. The gate's
  // suite asserts both numbers so the gap cannot widen unnoticed, and so that
  // closing it (#858) is a visible, deliberate edit rather than a silent drift.
  return { railsSeen: rails.length, stripsSeen, offences: out };
}

/** Offences in one Svelte source. Exported for the gate's own test suite. */
export function offences(source) {
  return analyse(source).offences;
}

const MESSAGES = {
  'strip-does-not-scroll':
    'This tab strip neither scrolls nor wraps, so at phone widths it pushes the page off the right edge. Fix it EITHER by adding `overflow-x-auto` to the rail or an element between it and the tabs (plus `shrink-0 whitespace-nowrap` on each tab), OR by putting `flex flex-wrap` on the element that lays the tabs out. See #858.',
  'tab-can-shrink':
    'This tab has no `shrink-0`, so flex compresses the labels into unreadable columns instead of letting the strip scroll. See #858.',
  'tab-can-wrap':
    'This tab has no `whitespace-nowrap`, so a long label wraps and the strip grows vertically rather than horizontally. See #858.',
  'scroller-cannot-shrink':
    'This element sits between the tab rail and the scrolling element and has no `min-w-0`, so as a flex item its `min-width: auto` resolves to its content width and it refuses to shrink — the page overflows instead of the strip scrolling. Measured: 580px of document overflow at 390px. Add `min-w-0` here. (The scroller itself does not need it: a flex item that is a scroll container already has an automatic minimum size of zero.) See #858.',
  'wrapping-tab-cannot-shrink':
    'This tab is on a WRAPPING strip but carries `shrink-0`, so a label wider than the phone column cannot shrink and pushes the page off the right edge. Measured: 342px in a 308px rail, 17px of document overflow. `shrink-0` is for SCROLLING strips — remove it here, or make the strip scroll instead. See #858.',
  'wrapping-tab-cannot-break':
    'This tab is on a WRAPPING strip but carries `whitespace-nowrap`, so a long label cannot break onto a second line and pushes the page off the right edge. Measured: 342px in a 308px rail, 17px of document overflow. `whitespace-nowrap` is for SCROLLING strips — remove it here, or make the strip scroll instead. See #858.',
  unparseable: 'This file could not be parsed, so the tab-strip gate could not check it. See #858.',
};

function lineOf(source, index) {
  return typeof index === 'number' ? source.slice(0, index).split('\n').length : 1;
}

/**
 * Every `.svelte` file under `dir`. Exported so the gate's own suite runs THIS
 * walk over the real tree rather than only feeding synthetic strings to the
 * predicate — the gap @copilot found on #860, and the reason a gate covering 3
 * of 20 rails passed its own twelve tests.
 */
export function svelteFilesUnder(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) svelteFilesUnder(full, acc);
    else if (entry.endsWith('.svelte')) acc.push(full);
  }
  return acc;
}

function main() {
  const files = svelteFilesUnder('src');
  let failed = 0;
  let stripsSeen = 0;
  let railsSeen = 0;
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const { railsSeen: rails, stripsSeen: seen, offences: found } = analyse(source);
    railsSeen += rails;
    stripsSeen += seen;
    for (const o of found) {
      failed += 1;
      console.log(`::error file=${file},line=${lineOf(source, o.start)}::${MESSAGES[o.kind]}`);
    }
  }
  if (failed > 0) {
    console.log(`\n${failed} tab-strip problem(s) across ${files.length} .svelte files.`);
    process.exit(1);
  }
  // Report the DENOMINATOR, not just the verdict — silence over a strip this
  // gate never parsed is not evidence about that strip (see the blind-spot note
  // at the top).
  //
  // And say "do not overflow", not "scroll": a `flex-wrap` strip PASSES without
  // scrolling, so claiming every parsed strip scrolls is false about the agent
  // sub-tab bar specifically (@copilot on #863). The check is about phone-width
  // overflow; scrolling is one of two ways to satisfy it.
  console.log(
    `OK — the ${stripsSeen} tab strip(s) this gate can parse do not overflow a phone screen (${files.length} .svelte files).`,
  );
  console.log(
    `The other ${railsSeen - stripsSeen} rail(s) matching flex+border-b resolved to no border-b-2 children. Today all seven are genuinely not tab strips, and the suite pins them BY NAME — but this line reports what the predicate resolved, not that the rest are safe: a strip whose classes come from an imported or runtime-built constant would land here too. See #858.`,
  );
}

// Only run when invoked directly, so the test suite can import the predicate.
if (process.argv[1] && process.argv[1].endsWith('check-tab-strips.mjs')) main();
