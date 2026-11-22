// portal#2488: what paints outside its own table cell, measured on the real page in a real browser.
// The function is serialised into the page, so it must stay self-contained (no imports, no closures).
//
// An ancestor only clips when it is not display:inline: `overflow:hidden` and `text-overflow:ellipsis` do
// nothing on an inline box, which is exactly how an inline `truncate` link escapes its cell (#1962 audit).
// The older harness probes treat any overflow:hidden ancestor as a clip and so cannot see that defect.
export const ESCAPE_PX = 0.5;
export function probeCellEscapes(escapePx) {
  const out = [];
  const clips = el => {
    const st = getComputedStyle(el);
    if (st.display === 'inline') return false;
    return ['hidden', 'clip', 'auto', 'scroll'].includes(st.overflowX);
  };
  const clippedBelow = (node, td) => { for (let a = node; a && a !== td; a = a.parentElement) if (clips(a)) return true; return false; };
  const columnOf = td => td.closest('table')?.querySelectorAll('thead th')[td.cellIndex]?.textContent?.trim() ?? String(td.cellIndex);
  for (const td of document.querySelectorAll('tbody td')) {
    const cell = td.getBoundingClientRect();
    const col = columnOf(td);
    const record = (kind, what, left, right, el) => {
      const px = Math.max(cell.left - left, right - cell.right);
      if (px > escapePx) out.push({ col, kind, what: what.slice(0, 40), px: Math.round(px * 10) / 10, cellW: Math.round(cell.width), ...(el ? { label: (el.getAttribute('aria-label') ?? '').slice(0, 40) } : {}) });
    };
    // Text glyphs: the box of every text run that no real clip contains.
    const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      if (!n.textContent.trim() || clippedBelow(n.parentElement, td)) continue;
      const range = document.createRange(); range.selectNodeContents(n);
      for (const r of range.getClientRects()) record('text', n.textContent.trim(), r.left, r.right);
    }
    // Boxes: a pill, chip or button whose painted chrome (a background or a border) leaves the cell. A transparent
    // box paints nothing, so the 44px coarse-pointer hit area of an icon button is not an escape (portal#2488 QA
    // of the screenshot: the icons sit inside the cell).
    for (const el of td.querySelectorAll('*')) {
      const st = getComputedStyle(el);
      if (st.position === 'fixed' || st.position === 'absolute' || st.display === 'none' || st.display === 'contents') continue;
      if (clippedBelow(el.parentElement, td)) continue;
      const painted = st.backgroundColor !== 'rgba(0, 0, 0, 0)' || st.backgroundImage !== 'none' || parseFloat(st.borderLeftWidth) > 0 || parseFloat(st.borderRightWidth) > 0;
      if (!painted || el instanceof SVGElement) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      record('box', el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : ''), r.left, r.right, el);
    }
  }
  return out;
}
