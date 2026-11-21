import { parse } from 'svelte/compiler';

/**
 * Locate a converted live-region site in a Svelte source and report what surrounds it
 * (portal#2375, hrn:node:hadronmemory.com:hadron-portal:components:live-region).
 *
 * A region only announces when it already exists, so it must not be mounted by anything that
 * turns true with its own result. Static analysis cannot tell a result-dependent guard from a
 * static one (`{#if resultVisible}` with `resultVisible = $derived(!!ok)` looks like
 * `{#if canEdit}`), so this does not try: it returns EVERY control-flow ancestor
 * ({#if}/{#each}/{#key}/{#await} and else-if links) as source text, and the test compares that
 * list to one a reviewer has read. A new, changed or derived ancestor fails until it is reviewed.
 */
type Ast = {
  type: string; name?: string; start: number; end: number; data?: string;
  test?: Ast; expression?: Ast; fragment?: { nodes: Ast[] }; consequent?: { nodes: Ast[] }; alternate?: { nodes: Ast[] } | null;
  body?: { nodes: Ast[] }; attributes?: Ast[]; value?: true | Ast[] | Ast; [k: string]: unknown;
};

export type Located = { gates: string[]; hasNestedStatusRole: boolean };

const bodyRange = (f?: { nodes: Ast[] } | null): [number, number] | null => (f && f.nodes.length ? [f.nodes[0].start, f.nodes[f.nodes.length - 1].end] : null);
const inRange = (at: number, r: [number, number] | null) => !!r && at >= r[0] && at < r[1];
const text = (src: string, n: Ast | undefined) => (n ? src.slice(n.start, n.end).replace(/\s+/g, ' ').trim() : '');

function hasStatusRole(n: Ast): boolean {
  return (n.attributes ?? []).some((a) => {
    if (a.type !== 'Attribute' || a.name !== 'role' || !Array.isArray(a.value)) return false;
    return a.value.map((v) => String((v as Ast).data ?? '')).join('').trim() === 'status';
  });
}

type Span = { start: number; end: number };

/**
 * Candidate spans for a marker, in document order: rendered text and `{expression}` tags only (or,
 * with `attr`, element attributes), never an `{#if}` condition, a script, a comment or an attribute
 * when text is asked for. Counting `occurrence` among these means an earlier match in a script or an
 * unrelated attribute cannot shift the selection (Beckett, #2382).
 */
function markerSpans(root: { fragment: { nodes: Ast[] } }, attr: boolean): Span[] {
  const out: Span[] = [];
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as Ast;
    if (node.type === 'Attribute' || node.type === 'SpreadAttribute' || node.type === 'BindDirective' || node.type === 'ClassDirective') {
      if (attr && node.type === 'Attribute') out.push({ start: node.start, end: node.end });
      return; // never descend: an expression inside an attribute is not rendered text
    }
    if (node.type === 'Text' || node.type === 'ExpressionTag' || node.type === 'HtmlTag') { if (!attr) out.push({ start: node.start, end: node.end }); return; }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(root.fragment);
  return out.sort((x, y) => x.start - y.start);
}

/**
 * Returns null unless the marker sits in the BODY of the only `{#if}` child of a `<LiveRegion>`.
 * `marker` is matched in rendered text/expression tags (or element attributes when `attr` is set),
 * `occurrence` counts among those only. `gates` are the control-flow ancestors of that region,
 * outermost first, each with the BRANCH the region is in (`if X`, `else of if X`, `each X`
 * `(key K)`, `await X: then`), so moving a region between branches of an unchanged guard changes
 * the list.
 */
export function locateRegion(src: string, marker: string, occurrence = 0, attr = false): Located | null {
  const root = parse(src, { modern: true }) as unknown as { fragment: { nodes: Ast[] } };
  const hits = markerSpans(root, attr).filter((sp) => src.slice(sp.start, sp.end).includes(marker));
  const span = hits[occurrence];
  if (!span) return null;
  const at = span.start + src.slice(span.start, span.end).indexOf(marker);
  let found: Located | null = null;
  const walk = (n: unknown, gates: string[]) => {
    if (found || !n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach((x) => walk(x, gates));
    const node = n as Ast;
    if (node.type === 'Component' && node.name === 'LiveRegion' && at >= node.start && at < node.end) {
      const kids = (node.fragment?.nodes ?? []).filter((k) => !(k.type === 'Text' && !String(k.data ?? '').trim()) && k.type !== 'Comment');
      const inner = kids[0];
      if (kids.length === 1 && inner.type === 'IfBlock' && (inRange(at, bodyRange(inner.consequent)) || inRange(at, bodyRange(inner.alternate)))) {
        // a role="status" anywhere inside the region is the conditional status element again
        let nested = false;
        const scan = (m: unknown) => {
          if (!m || typeof m !== 'object') return;
          if (Array.isArray(m)) return m.forEach(scan);
          const e = m as Ast;
          if (e.type === 'RegularElement' && hasStatusRole(e)) nested = true;
          for (const v of Object.values(e)) if (v && typeof v === 'object') scan(v);
        };
        scan(node.fragment);
        found = { gates, hasNestedStatusRole: nested };
      }
      return;
    }
    // control-flow blocks: walk each branch under its own label
    const branches: [string, unknown][] | null =
      node.type === 'IfBlock' ? [[`if ${text(src, node.test)}`, node.consequent], [`else of if ${text(src, node.test)}`, node.alternate]]
      : node.type === 'EachBlock' ? [[`each ${text(src, node.expression)}${node.key ? ` (key ${text(src, node.key as Ast)})` : ''}`, node.body], [`each ${text(src, node.expression)}: else`, node.fallback]]
      : node.type === 'AwaitBlock' ? [[`await ${text(src, node.expression)}: pending`, node.pending], [`await ${text(src, node.expression)}: then`, node.then], [`await ${text(src, node.expression)}: catch`, node.catch]]
      : node.type === 'KeyBlock' ? [[`key ${text(src, node.expression)}`, node.fragment]]
      : null;
    if (branches) {
      for (const [label, frag] of branches) walk(frag, [...gates, label]);
      return;
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, gates);
  };
  walk(root.fragment, []);
  return found;
}
