import { parse } from 'svelte/compiler';

// The live-region ratchet's scanner (portal#2344). The ratchet itself is live-region-sites.test.ts.

type Node = { type: string; start?: number; data?: string; attributes?: Attr[]; fragment?: Fragment; consequent?: Fragment; alternate?: Fragment | null; body?: Fragment; fallback?: Fragment; pending?: Fragment; then?: Fragment; catch?: Fragment; children?: Node[]; nodes?: Node[] };
type Expr = { type: string; value?: unknown; name?: string; quasis?: Array<{ value: { cooked?: string | null } }>; consequent?: Expr; alternate?: Expr; left?: Expr; right?: Expr; operator?: string; expressions?: Expr[]; start: number; end: number };
type Attr = { type: string; name?: string; value?: true | Array<{ type: string; data?: string; expression?: Expr }> | { type: string; expression?: Expr } };
type Fragment = { nodes: Node[] };

/**
 * Whether a `role={expression}` can resolve to `status`, judged on the branches the expression can take,
 * not on the words in its source. A conditional is checked branch by branch; a string literal is `status` or
 * it is not; `undefined`, `null` and other literals are known not to be; anything opaque (an identifier, a
 * member such as `notice.role`, a call) is UNKNOWN and counts, since it may be `status`.
 */
function canBeStatus(e: Expr | undefined): boolean {
  if (!e) return true;
  switch (e.type) {
    case 'ConditionalExpression': return canBeStatus(e.consequent) || canBeStatus(e.alternate);
    // `a && b` is a falsy `a` or `b`; `a || b` and `a ?? b` can be either side.
    case 'LogicalExpression': return e.operator === '&&' ? canBeStatus(e.right) : canBeStatus(e.left) || canBeStatus(e.right);
    case 'Literal': return e.value === 'status';
    // A static template is its cooked text; one with substitutions is unknown, so it counts.
    case 'TemplateLiteral': return e.expressions?.length ? true : e.quasis?.[0]?.value.cooked === 'status';
    case 'Identifier': return e.name !== 'undefined';
    default: return true;
  }
}

/**
 * The role attribute of an element: a literal string; null for a `role={expression}` that can yield `status`
 * (see `canBeStatus`); 'other' for an expression that cannot (`full ? 'dialog' : undefined`); undefined when absent.
 */
function roleOf(node: Node): string | null | undefined {
  const attr = (node.attributes ?? []).find((a) => a.type === 'Attribute' && a.name === 'role');
  if (!attr) return undefined;
  if (Array.isArray(attr.value) && attr.value.length === 1 && attr.value[0].type === 'Text') return attr.value[0].data?.trim();
  // `role={x}` is one expression tag; `role="{x}"` is a one-chunk array holding the same expression tag. A quoted
  // attribute mixing text and expressions (`role="a{b}"`) is unknown, so it counts.
  const only = Array.isArray(attr.value) ? (attr.value.length === 1 ? attr.value[0] : undefined) : attr.value !== true ? attr.value : undefined;
  const expression = only && only.type === 'ExpressionTag' ? (only as { expression?: Expr }).expression : undefined;
  return only && !expression ? null : canBeStatus(expression) ? null : 'other';
}

/**
 * How many status regions are mounted by an `{#if}`/`{:else}` branch itself: a `role="status"`, or a
 * `role={expression}` (an alert/status hybrid, whose status half is inserted already populated), that is a
 * child of the branch, alone or among others, directly or through a `{#key}`. An element that is always
 * rendered with the `{#if}` INSIDE it is not a child of the branch, so it is never counted.
 */
export function conditionalStatusRegions(src: string): number {
  return conditionalStatusSites(src).length;
}

/** The 1-based line of each region counted by `conditionalStatusRegions`. */
export function conditionalStatusSites(src: string): number[] {
  const ast = parse(src, { modern: true }) as unknown as { fragment: Fragment };
  const sites: number[] = [];
  const direct = (nodes: Node[]): Node[] =>
    nodes.flatMap((n) => (n.type === 'KeyBlock' ? direct((n.fragment?.nodes ?? [])) : [n]));
  const branch = (f: Fragment | null | undefined) => {
    if (!f) return;
    for (const n of direct(f.nodes)) {
      if (n.type !== 'RegularElement' && n.type !== 'SvelteElement') continue;
      const role = roleOf(n);
      if (role === 'status' || role === null) sites.push(src.slice(0, n.start ?? 0).split('\n').length);
    }
  };
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as Node;
    if (node.type === 'IfBlock') {
      branch(node.consequent);
      if (node.alternate && !(node.alternate.nodes.length === 1 && node.alternate.nodes[0].type === 'IfBlock')) branch(node.alternate);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(ast.fragment);
  return sites;
}
