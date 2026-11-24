import { createHash } from 'node:crypto';
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

/** One counted region: its 1-based line (for messages only) and its identity (what the ratchet tracks). */
export type StatusSite = { line: number; identity: string };

/**
 * How many status regions are mounted by an `{#if}`/`{:else}` branch itself: a `role="status"`, or a
 * `role={expression}` (an alert/status hybrid, whose status half is inserted already populated), that is a
 * child of the branch, alone or among others, directly, through a `{#key}`, or nested in plain elements
 * (portal#2391: `{#if a}<div><p role="status">` inserts the populated region just the same). An element that is
 * always rendered with the `{#if}` INSIDE it is not a child of the branch, so it is never counted, and the
 * scan does not look inside a component, which may render its own persistent region.
 */
export function conditionalStatusRegions(src: string): number {
  return conditionalStatusSites(src).length;
}

/** The 1-based line of each region counted by `conditionalStatusRegions`. */
export function conditionalStatusSites(src: string): number[] {
  return scanStatusSites(src).map((s) => s.line);
}

/**
 * A stable identity per counted region, in source order, so the ratchet can tell a swap within one file from no
 * change. It is `testid:<value>` when the element has a literal `data-testid`, else `<tag>:<hash>`, the hash being
 * the first 8 hex digits of a SHA-1 over the whitespace-normalised opening tag and the enclosing branch condition
 * (`if <test>` or `else <test>`). It holds no line number, so it survives edits elsewhere in the file. Identical
 * tag and condition twice get a `~2`, `~3` ordinal so the two stay distinct.
 */
export function conditionalStatusIdentities(src: string): string[] {
  return scanStatusSites(src).map((s) => s.identity);
}

/** What changed between a baseline's identities and the scan's: separately, so a swap is not invisible. */
export function ratchetDiff(baseline: readonly string[], now: readonly string[]): { added: string[]; removed: string[] } {
  const was = new Set(baseline);
  const is = new Set(now);
  return { added: now.filter((i) => !was.has(i)), removed: baseline.filter((i) => !is.has(i)) };
}

function scanStatusSites(src: string): StatusSite[] {
  const ast = parse(src, { modern: true }) as unknown as { fragment: Fragment };
  const sites: StatusSite[] = [];
  const seen = new Map<string, number>();
  const squash = (t: string) => t.replace(/\s+/g, ' ').trim();
  const direct = (nodes: Node[]): Node[] =>
    nodes.flatMap((n) => (n.type === 'KeyBlock' ? direct((n.fragment?.nodes ?? [])) : [n]));
  const identify = (n: Node, condition: string): string => {
    const testid = (n.attributes ?? []).find((a) => a.type === 'Attribute' && a.name === 'data-testid');
    const literal = testid && Array.isArray(testid.value) && testid.value.length === 1 && testid.value[0].type === 'Text' ? testid.value[0].data?.trim() : undefined;
    const base = literal
      ? `testid:${literal}`
      : `${(n as { name?: string }).name ?? 'element'}:${createHash('sha1')
          .update(`${squash(src.slice(n.start ?? 0, n.fragment?.nodes[0]?.start ?? (n as { end?: number }).end ?? 0))}|${condition}`)
          .digest('hex')
          .slice(0, 8)}`;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}~${count}`;
  };
  // Descend through plain elements only: a nested block is walked on its own, a component is opaque.
  const collect = (nodes: Node[], condition: string) => {
    for (const n of direct(nodes)) {
      if (n.type !== 'RegularElement' && n.type !== 'SvelteElement') continue;
      const role = roleOf(n);
      if (role === 'status' || role === null) sites.push({ line: src.slice(0, n.start ?? 0).split('\n').length, identity: identify(n, condition) });
      else collect(n.fragment?.nodes ?? [], condition);
    }
  };
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    const node = n as Node & { test?: { start: number; end: number } };
    if (node.type === 'IfBlock') {
      const test = squash(src.slice(node.test?.start ?? 0, node.test?.end ?? 0));
      collect(node.consequent?.nodes ?? [], `if ${test}`);
      if (node.alternate && !(node.alternate.nodes.length === 1 && node.alternate.nodes[0].type === 'IfBlock')) collect(node.alternate.nodes, `else ${test}`);
    }
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  walk(ast.fragment);
  return sites;
}
