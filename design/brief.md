# hadron-portal — design brief for Claude Design

Read this before extracting a design system from this repo. It tells you which
parts of the code are the real system and which parts are drift, and which
rules a design has to follow so the handoff can be built without translating it.

The **source of truth for brand color** is the platform spec
[`hrn:node:hadronmemory.com:specs:cor:brd:010:01`](https://hadronmemory.com/app/u/hrn:node:hadronmemory.com:specs:cor:brd:010:01).
The code below implements that spec.

## Stack

- SvelteKit 2 + Svelte 5 (runes). Designs come back as Svelte components, not
  React.
- Tailwind CSS v4, **CSS-first**: every token is in [`src/app.css`](../src/app.css)
  under `@theme`. There is no `tailwind.config.js`.
- `@tailwindcss/typography` (`prose`) renders node bodies (markdown).
- Icons: mostly hand-inlined SVG with `stroke="currentColor"`, `stroke-width="2"`,
  in the Lucide/Feather style. `lucide-svelte` is installed and used in a few
  places. Use Lucide icons in new designs.
- `bits-ui` is listed in `package.json` but **nothing imports it**. Don't assume a
  headless component library: menus, dialogs and tabs are hand-built.

## Color: token names are slots, not hues

Brand colors are installed by **overriding Tailwind's own scales**, so
`indigo-*` and `amber-*` utility classes render the brand palette. **The name
tells you the role, not the color.** `bg-indigo-600` is teal, not indigo.

| Family | Tailwind slot | Role | Anchors |
|---|---|---|---|
| Primary (cool) | `indigo-50…950` | Identity and chrome: primary buttons, links, focus and active states, headers | `#8ecae6` (200) · `#219ebc` (400) · `#023047` (900) |
| Accent (warm) | `amber-300…700` | CTAs, highlights, badges, "act here / notice this". **Use sparingly; never navigation** | `#ffb703` (400) · `#fb8500` (500) |
| Neutral | stock `zinc` | Text, surfaces, borders, dividers, muted and disabled states | Tailwind default |

- One ramp per family serves both themes. There is no separate dark palette.
- Status colors use stock Tailwind and aren't brand colors: `red` for errors,
  `green` for success, `rose-700`/`rose-300` for unresolved wikilinks.
- In your output, use the Tailwind class names (`bg-indigo-600`), not hex
  values, so a later palette change re-skins your designs too.

## Themes

- **Dark is the default.** The portal ignores `prefers-color-scheme`; light
  mode applies only after the user clicks the toggle (stored in
  `localStorage.theme`). Design dark first, but ship both.
- Dark mode is **class-based**: `.dark` on `<html>`, applied with
  `@custom-variant dark`. Write every color as a light/dark pair, e.g.
  `text-zinc-900 dark:text-white`.
- Page background: `#fafafa` (light) and `#09090b` / `zinc-950` (dark).
- In light mode, form controls get a global override in `app.css` (white
  background, `zinc-300` border), so inputs need no per-page light styling.

## Typography

- The system UI font stack (Tailwind's default `font-sans`). There's no web font.
- `font-mono` is used heavily for URNs, IDs and code.
- Page title: `text-2xl font-bold text-zinc-900 dark:text-white`. Section
  heading: `text-xl font-semibold`. Body and controls: `text-sm`. Sidebar
  section labels: `text-[10px] font-semibold uppercase tracking-wider text-zinc-400`.

## Recurring patterns (copy these)

| Element | Classes |
|---|---|
| Primary button | `rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50` |
| CTA button (accent) | `rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50` |
| Card | `rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900` |
| Text input | `w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-white` |
| Sidebar item (active) | `rounded-md px-3 py-2 text-sm bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-white` |
| Sidebar item (idle) | `text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900` |

**Known drift; don't copy it:**
- The error and success banners (`bg-red-950 text-red-300`,
  `bg-green-950 text-green-300`) are dark-only and look wrong in light mode.
  Design them as light/dark pairs.
- Accent buttons are sometimes used as everyday primary buttons. Per the spec,
  the accent is reserved for the single call to action that matters on a view.
- The usage chart's y-axis labels are clipped: `10000` renders as `0000`.
- On a phone, the node-detail tab bar scrolls sideways, but nothing shows that
  it can: tabs just disappear off the right edge.

**Not drift:** charts deliberately use a separate categorical data-viz palette
(blue `#2a78d6` / orange `#eb6834`, stepped per theme in
[UsageActivityChart.svelte](../src/lib/components/UsageActivityChart.svelte)),
checked for contrast in both themes. The brand ramps are for chrome, not data
series.

## Screenshots

[`screenshots/`](screenshots/) holds the current UI at 1440×900, plus 390×844
for the mobile shots. Every view is shown in dark and light. The folder is
**gitignored** because the shots show real account and org data; capture them
locally against the dev server:

| File prefix | View |
|---|---|
| `01-dashboard` | Dashboard (also mobile) |
| `02-org-memories-datatable` | An org's Memories list: the canonical `DataTable` |
| `03-memory-detail` | Memory detail (tab layout) |
| `04-node-detail` | Node detail with rendered markdown (also mobile) |
| `05-org-profile-tabs` | Org profile tab |

## App shell

- **Top `Nav`** ([Nav.svelte](../src/lib/components/Nav.svelte)): logo on the
  left, a **command palette** (`CommandBar`) centered, then links, the theme
  toggle and sign-in on the right. On mobile it collapses to a menu.
- **Left sidebar** ([app/+layout.svelte](../src/routes/app/+layout.svelte)):
  `w-48`, sticky and collapsible. It holds nav items, an "Organization" section
  with the active org and an `OrgSwitcher`, and a "User Account" block (avatar +
  `@handle`) pinned to the bottom.
- **Detail pages are tab layouts**: org, memory and node detail each have a
  breadcrumb, then a title with its URN, then a tab bar. On the org page the
  title and URN appear only on the Profile tab; every other tab shows its own
  section heading.

## Hard rules a design must follow

1. **Every list is a `DataTable`**
   ([DataTable.svelte](../src/lib/components/table/DataTable.svelte), backed by
   TanStack Table). Every list comes with the same frame: one row holding search,
   the saved-view tabs and a Columns toggle; a sticky, sortable, resizable header;
   and a pagination footer. Design what goes **inside the cells** and the empty
   states; don't design a bespoke list or card grid. The exceptions are data that
   isn't tabular: a chat thread, a tree, a graph or flow canvas.
2. **Any reference to another entity shows its URN** using
   [Urn.svelte](../src/lib/components/Urn.svelte): a monospace chip with
   copy-URN and copy-URL buttons, optionally linked. A name alone isn't enough.
   If a URN is null, show nothing, not an empty chip.
3. **Every user-visible string goes through `t()`** (`$lib/i18n/t`). Leave room
   for longer translations: no fixed-width labels, and let text wrap.
4. **Accessibility.** Controls are reachable by keyboard (tables already sort
   with Enter/Space and resize with the arrow keys). Color is never the only
   signal; an unresolved wikilink, for example, also keeps its `[[…]]` brackets
   and a wavy underline. Icon-only buttons need an accessible name.
5. **Content is markdown rendered with `prose`.** Inline code is a tinted
   rounded chip with no backticks. Wikilinks get a dotted underline, so a reader
   can tell an in-graph link from an outbound one.

## Domain vocabulary

Organization → Apps / Agents / **Memories** → **Nodes** (markdown body,
properties, edges to other nodes). Also: Workers (named team members, human or
AI), Channels, Team chat, Tasks. Each of these is addressed by a URN such as
`hrn:node:hadronmemory.com:hadron-portal:review`.

## Handoff expectations

- Deliver Svelte 5 components (runes: `$props`, `$state`, `$derived`) styled
  with Tailwind utilities from the table above. No new CSS files and no new
  tokens unless the brand spec changes.
- Reuse existing components where one fits: `DataTable`, `Urn`, `Breadcrumb`,
  `Nav`, `CommandBar`, `WorkerBadge`, `TreeView`.
- Show light and dark states, empty, loading and error states, and a narrow
  viewport (`sm` breakpoint and below).
