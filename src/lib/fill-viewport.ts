/**
 * #878 — size an editor to the viewport height left below it, keeping its
 * footer (the Save row) visible without scrolling.
 *
 * The Source editors on the node page used fixed guesses: Content was
 * `h-[calc(100vh-18rem)]` and Abstract only `min-h-[120px]`. How much sits
 * ABOVE the editor varies per node — breadcrumbs, a wrapping title, a
 * description, the tab strip — so a constant is too tall for one node and
 * too short for the next. @Holger: the Content one was too high (Save pushed
 * below the fold), the Abstract one not high enough.
 *
 * So the height is MEASURED: the viewport height, minus where the editor
 * starts on the page, minus the footer below it, minus the padding the page
 * layout puts under its content.
 */

/** Never shrink below this, so a short or landscape viewport keeps a usable editor. */
export const FILL_MIN_HEIGHT = 200;

/**
 * The editor height that ends at the bottom of the viewport with `below`
 * pixels of footer and page padding still showing.
 *
 * `top` is measured from the top of the DOCUMENT, not the viewport, so the
 * answer does not change as the user scrolls.
 */
export function fillHeight(opts: {
  viewportHeight: number;
  top: number;
  below: number;
  min?: number;
}): number {
  const min = opts.min ?? FILL_MIN_HEIGHT;
  return Math.max(min, Math.floor(opts.viewportHeight - opts.top - opts.below));
}

function px(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The space the page puts under `node`: the bottom padding and border of every
 * ancestor. That is the layout's gutter (`py-8` on the app shell today),
 * measured rather than restated, so a layout change cannot silently leave the
 * Save row half off-screen.
 */
function trailingSpace(node: HTMLElement): number {
  let total = 0;
  for (let el = node.parentElement; el && el !== document.documentElement; el = el.parentElement) {
    const cs = getComputedStyle(el);
    // A border with no style takes no space. Browsers already report its width
    // as 0; jsdom reports the `medium` default, so the style is checked too.
    const border =
      cs.borderBottomStyle === 'none' || cs.borderBottomStyle === 'hidden' || !cs.borderBottomStyle
        ? 0
        : px(cs.borderBottomWidth);
    total += px(cs.paddingBottom) + border;
  }
  return total;
}

/**
 * Svelte action: keep `node` filling the viewport below it.
 *
 * `footer` is the element under the editor that must stay visible (the Save
 * row); its height and top margin are measured, so a wrapping footer is
 * accounted for. Recomputes on window resize and whenever the page's layout
 * changes size. A write happens only when the height actually changes, which
 * is what stops the observer from re-triggering itself.
 */
export function fillViewport(node: HTMLElement, footer?: HTMLElement | null) {
  let current = footer ?? null;

  const resize = () => {
    const rect = node.getBoundingClientRect();
    const top = rect.top + window.scrollY;
    let below = trailingSpace(node);
    if (current) {
      below += current.offsetHeight + px(getComputedStyle(current).marginTop);
    }
    const next = fillHeight({ viewportHeight: window.innerHeight, top, below });
    if (Math.abs(node.offsetHeight - next) > 1) node.style.height = `${next}px`;
  };

  // Guarded like `clampProbe`: without ResizeObserver (an older browser or an
  // embedded webview) the editor still measures once and on window resize —
  // it just misses layout changes that do not resize the window
  // (@copilot on #887).
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null;
  observer?.observe(document.body);
  if (current) observer?.observe(current);
  window.addEventListener('resize', resize);
  resize();

  return {
    update(nextFooter?: HTMLElement | null) {
      if (current) observer?.unobserve(current);
      current = nextFooter ?? null;
      if (current) observer?.observe(current);
      resize();
    },
    destroy() {
      observer?.disconnect();
      window.removeEventListener('resize', resize);
    },
  };
}
