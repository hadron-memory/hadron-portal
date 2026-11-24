/**
 * #1086 — a horizontally scrolling tab strip says that it scrolls.
 *
 * The tab strips already scroll (#858/#747), but mobile browsers hide the
 * horizontal scrollbar, so at 390px the node page showed three of its nine
 * tabs and nothing said the rest existed. This is affordance only, with no new
 * chrome and no change to what the strip is or how it scrolls:
 *
 * - a fade on each edge that has more tabs past it, gone at that end, marked
 *   by `data-overflow-start` / `data-overflow-end` and painted by the
 *   `.scroll-hint` mask in app.css;
 * - the active tab scrolled into view on mount and whenever the active key
 *   changes, so a deep link (`?tab=settings`) lands on a visible tab.
 *
 * The reveal on a key change waits a frame: Svelte runs an action's `update`
 * BEFORE the tabs' own attributes move, so a synchronous reveal found the OLD
 * active tab (Atilla's P2 on #1111, a static-button strip like the node page's).
 *
 * One noun: this feature is the "scroll cue" (the edge marks plus what paints from them: the tab
 * strips' `.scroll-hint` mask, the data table's `.table-scroll-cue` overlays). The action keeps the name
 * `scrollHint`, and the `data-overflow-*` marks and `.scroll-hint` class stay as they are: tab strips and
 * tests key on them, so a rename would be churn with no reader benefit (#2503).
 *
 * The reveal sets the strip's own `scrollLeft` rather than calling
 * `scrollIntoView`, which also scrolls the PAGE vertically when the strip is
 * below the fold.
 */

/** Fade width in px; a revealed tab is kept this far clear of the edge. */
export const SCROLL_HINT_PAD = 24;

/** Which edges have content past them. 1px of slack absorbs sub-pixel scrolls. */
export function overflowEdges(el: { scrollLeft: number; scrollWidth: number; clientWidth: number }): {
  start: boolean;
  end: boolean;
} {
  return {
    start: el.scrollLeft > 1,
    end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
  };
}

/**
 * The scrollLeft that shows a tab spanning `tab.start`–`tab.end` (px in the
 * strip's content), clear of the fade; the current one if it is already shown.
 */
export function revealScrollLeft(
  view: { scrollLeft: number; clientWidth: number },
  tab: { start: number; end: number },
): number {
  if (tab.start < view.scrollLeft + SCROLL_HINT_PAD) return Math.max(0, tab.start - SCROLL_HINT_PAD);
  if (tab.end > view.scrollLeft + view.clientWidth - SCROLL_HINT_PAD)
    return tab.end - view.clientWidth + SCROLL_HINT_PAD;
  return view.scrollLeft;
}

const ACTIVE = '[data-active], [aria-current="page"], [aria-selected="true"]';

/**
 * Svelte action for a horizontally scrolling tab strip. `active` is the
 * strip's current tab key: it is only a change signal, and the tab itself is
 * found by `data-active`, `aria-current="page"` or `aria-selected="true"`.
 * Add the `scroll-hint` class for the fade.
 *
 * The mount-time `reveal()` scrolls to ANY element inside the node that matches that selector, so
 * it applies to every user of this action, including DataTable. Nothing inside a DataTable cell
 * matches today; a future cell that carries `data-active`, `aria-current="page"` or
 * `aria-selected="true"` would get an unrequested sideways scroll on mount (#2503).
 */
export function scrollHint(node: HTMLElement, active?: unknown) {
  let current = active;
  let frame = 0;
  let revealFrame = 0;

  // The content element is re-resolved on every mark: a keyed block or a re-rendered table can replace
  // it, and a ResizeObserver on the old, detached element would go silent (#2503).
  let content: Element | null = null;
  const watchContent = () => {
    const next = node.firstElementChild;
    if (next === content) return;
    if (content) observer?.unobserve(content);
    content = next;
    if (content) observer?.observe(content);
  };

  const mark = () => {
    frame = 0;
    watchContent();
    const edges = overflowEdges(node);
    node.toggleAttribute('data-overflow-start', edges.start);
    node.toggleAttribute('data-overflow-end', edges.end);
  };

  // Passive and frame-throttled: a scroll fires per frame at most anyway, and
  // `mark` only toggles two attributes.
  const onScroll = () => {
    if (!frame) frame = requestAnimationFrame(mark);
  };

  const reveal = () => {
    const tab = node.querySelector<HTMLElement>(ACTIVE);
    if (tab) {
      const strip = node.getBoundingClientRect();
      const rect = tab.getBoundingClientRect();
      const start = rect.left - strip.left + node.scrollLeft;
      node.scrollLeft = revealScrollLeft(node, { start, end: start + (rect.right - rect.left) });
    }
    mark();
  };

  // Guarded like `fillViewport`: without ResizeObserver the hint still sets on
  // mount, on scroll and on window resize.
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(mark) : null;
  observer?.observe(node);
  // The strip's content can change width without the strip's own box changing: a table whose columns
  // are resized or whose rows reshape, or tabs that wrap in. Watch the content element too (#2461).
  watchContent();
  node.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  reveal();

  return {
    update(next?: unknown) {
      if (next === current) return;
      current = next;
      if (revealFrame) cancelAnimationFrame(revealFrame);
      revealFrame = requestAnimationFrame(() => {
        revealFrame = 0;
        reveal();
      });
    },
    destroy() {
      observer?.disconnect();
      node.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
      if (revealFrame) cancelAnimationFrame(revealFrame);
    },
  };
}
