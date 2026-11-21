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

export type Located = { gates: string[]; ownRoleStatus: boolean };

const blankComments = (src: string) => src.replace(/<!--[\s\S]*?-->/g, (c) => ' '.repeat(c.length));
const bodyRange = (f?: { nodes: Ast[] } | null): [number, number] | null => (f && f.nodes.length ? [f.nodes[0].start, f.nodes[f.nodes.length - 1].end] : null);
const inRange = (at: number, r: [number, number] | null) => !!r && at >= r[0] && at < r[1];
const text = (src: string, n: Ast | undefined) => (n ? src.slice(n.start, n.end).replace(/\s+/g, ' ').trim() : '');

function hasStatusRole(n: Ast): boolean {
  return (n.attributes ?? []).some((a) => {
    if (a.type !== 'Attribute' || a.name !== 'role' || !Array.isArray(a.value)) return false;
    return a.value.map((v) => String((v as Ast).data ?? '')).join('').trim() === 'status';
  });
}

/**
 * Returns null unless the marker's text sits in the BODY of the only `{#if}` child of a
 * `<LiveRegion>` (not in the region's attributes, in a comment, or in the `{#if}`'s own
 * condition). `gates` are the control-flow ancestors of that region, outermost first.
 */
export function locateRegion(src: string, marker: string, occurrence = 0): Located | null {
  const code = blankComments(src);
  let at = -1;
  for (let i = 0; i <= occurrence; i++) at = code.indexOf(marker, at + 1);
  if (at < 0) return null;
  const root = parse(src, { modern: true }) as unknown as { fragment: { nodes: Ast[] } };
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
        found = { gates, ownRoleStatus: nested };
      }
      return;
    }
    let next = gates;
    if (node.type === 'IfBlock') next = [...gates, `if ${text(src, node.test)}`];
    else if (node.type === 'EachBlock') next = [...gates, `each ${text(src, node.expression)}`];
    else if (node.type === 'KeyBlock') next = [...gates, `key ${text(src, node.expression)}`];
    else if (node.type === 'AwaitBlock') next = [...gates, `await ${text(src, node.expression)}`];
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v, next);
  };
  walk(root.fragment, []);
  return found;
}
