import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * portal#2267 — every Select* modal picker's opener announces what it opens.
 * The picker components render only the dialog; the opener button lives in
 * each calling page, so the pair (`aria-haspopup="dialog"` naming the popup
 * kind, `aria-expanded` naming the state) is added per opener. Older picker
 * sites predate the convention the newer ones were built with (SelectUser
 * #401, org-memories #384, app-members #655) and were retrofitted here.
 * A source-level pin, because the failure it guards is an addition nobody
 * notices: a new opener without the pair passes every behavioural test here
 * (jsdom asserts nothing about announcement) and quietly stops telling screen
 * readers it opens a dialog.
 *
 * portal#2340 P3-2 hardened the pin from file-level presence to per-opener
 * correlation, after both review seats of #2326 showed the old scan accepts a
 * shared expression: one `aria-expanded={open}` anywhere in the file covered
 * every opener in it, so sibling openers rendered from an {#each} all reported
 * expanded while one picker was open. The rules, all loud:
 *
 * - **Discovery, not a list.** Picker component names are derived from the
 *   `Select*.svelte` files under src/lib/components (recursively — that is
 *   where agent-tasks/SelectTask lives), and instantiations are matched by
 *   the `<Select[A-Z]…` pattern. A tag naming an unknown `Select*` component
 *   fails: either the component is missing or a non-picker borrowed the name.
 * - **Containment.** A tag span ends at its own `>` (`=>` inside handlers
 *   does not close it), and an instantiation that is not self-closed fails
 *   outright — the old lazy `[\s\S]*?/>` match would overrun a
 *   `<SelectX …></SelectX>` into later markup and borrow another tag's
 *   `bind:open`.
 * - **No silent skips.** `bind:open={state.open}` (a member expression) is
 *   not silently dropped: any `bind:open=` whose value is not a plain
 *   identifier the scan can correlate fails the test.
 * - **Per-opener correlation.** Every `<button>` that assigns a bound open
 *   var to true must carry `aria-haspopup="dialog"` and an `aria-expanded={…}`
 *   expression referencing that var — any expression (`{open}`,
 *   `{open && choosing === field}`, …), so a derived guard is legal. And when
 *   that button sits inside `{#each …}` blocks, the expression must also
 *   reference each block's item variable: a button rendered once per item
 *   with an expression that cannot tell the items apart makes every sibling
 *   report expanded while one picker is open (#2340 P3-1).
 * - **Fallback.** A bound var whose opener cannot be attributed to any button
 *   (opened through a function, not an inline `v = true` assignment) keeps
 *   the #2267 file-level requirement: an `aria-expanded={…}` expression
 *   referencing the var and an `aria-haspopup="dialog"`, somewhere in the
 *   file.
 *
 * Test stubs and harnesses are out of scope (path segments `test`/`tests` or
 * containing `stub`, matched per segment on either separator).
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));
const COMPONENTS = join(SRC, 'lib', 'components');

/** Picker component names, derived from the Select*.svelte files themselves. */
function pickerComponents(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pickerComponents(path);
    return /^Select[A-Z]\w*\.svelte$/.test(name) ? [name.replace(/\.svelte$/, '')] : [];
  });
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    const excluded = path.split(/[\\/]/).some((segment) => /^tests?$/.test(segment) || segment.toLowerCase().includes('stub'));
    return /\.svelte$/.test(name) && !excluded ? [path] : [];
  });
}

/**
 * The attribute span of a tag starting at `start`: up to (and including) its
 * own closing `>`. A `>` inside a `{…}` expression (`{a > b}`, `{() => x}`) or
 * inside a quoted attribute value is not the end of the tag. Returns null when
 * no such `>` exists before the text ends.
 */
function tagSpan(text: string, start: number): { end: number; selfClosed: boolean } | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (c === '"' || c === "'")) quote = c;
    else if (depth === 0 && c === '>') return { end: i + 1, selfClosed: text[i - 1] === '/' };
  }
  return null;
}

/** Item identifiers of one `{#each xs as item (key)}`-shaped open token. */
function eachItemVars(token: string): string[] {
  const as = token.replace(/\}\s*$/, '').match(/\bas\b([\s\S]*)$/);
  if (!as) return [];
  const clause = as[1].replace(/\([^()]*\)\s*$/, ''); // keyed each: the (key) tail
  // The item part stops at a top-level `, index` tail; commas inside {…}
  // destructure stay part of the item.
  let depth = 0;
  let cut = clause.length;
  for (let i = 0; i < clause.length; i++) {
    if (clause[i] === '{') depth++;
    else if (clause[i] === '}') depth--;
    else if (clause[i] === ',' && depth === 0) { cut = i; break; }
  }
  return [...clause.slice(0, cut).matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
}

/** The {#each} item vars in scope at `index` (valid Svelte nests blocks). */
function enclosingEachItems(text: string, index: number): string[][] {
  const tokens = [
    ...[...text.matchAll(/\{#each\b[^}]*\}/g)].map((m) => ({ i: m.index!, items: eachItemVars(m[0]) })),
    ...[...text.matchAll(/\{\/each\}/g)].map((m) => ({ i: m.index!, items: null })),
  ].sort((a, b) => a.i - b.i);
  const stack: string[][] = [];
  for (const token of tokens) {
    if (token.i >= index) break;
    if (token.items) stack.push(token.items);
    else stack.pop();
  }
  return stack;
}

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Every Select* instantiation's bound open var, hard-failing on the unparseable. */
function boundVars(text: string, path: string, problems: string[], components: string[]): string[] {
  const vars: string[] = [];
  for (const match of text.matchAll(/<(Select[A-Z]\w*)\b/g)) {
    const where = `${relative(SRC, path)}:${lineAt(text, match.index!)}`;
    if (!components.includes(match[1])) {
      problems.push(`${where}: <${match[1]}> is not a Select*.svelte under src/lib/components`);
      continue;
    }
    const span = tagSpan(text, match.index!);
    if (!span || !span.selfClosed) {
      problems.push(`${where}: <${match[1]}> is not a self-closed tag the scan can bound (write <${match[1]} … /> or teach the scanner)`);
      continue;
    }
    const tag = text.slice(match.index!, span.end);
    // `bind:open={x}` and the shorthand `bind:open` (which binds the variable `open`).
    for (const binding of tag.matchAll(/\bbind:open(?:=\{([^}]*)\})?(?=[\s/>])/g)) {
      const value = (binding[1] ?? 'open').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(value)) vars.push(value);
      else problems.push(`${where}: bind:open={${value}} is not a plain identifier the scan can correlate (portal#2340 P3-2)`);
    }
  }
  return vars;
}

describe('picker openers announce the dialog (portal#2267, per-opener since portal#2340)', () => {
  const components = pickerComponents(COMPONENTS);
  const at = (text: string, index: number) => text.slice(0, index).split('\n').length;

  /** Per-opener correlation on each button that opens a bound var. */
  function openerProblems(text: string, path: string, vars: string[]): { problems: string[]; unattributable: string[] } {
    const problems: string[] = [];
    const buttons = [...text.matchAll(/<button\b/g)].flatMap((match) => {
      const span = tagSpan(text, match.index!);
      return span ? [{ index: match.index!, tag: text.slice(match.index!, span.end) }] : [];
    });
    const unattributable: string[] = [];
    for (const v of vars) {
      const openers = buttons.filter((button) => new RegExp(`\\b${v}\\s*=\\s*true\\b`).test(button.tag));
      if (openers.length === 0) { unattributable.push(v); continue; }
      for (const opener of openers) {
        const where = `${relative(SRC, path)}:${at(text, opener.index)}`;
        if (!opener.tag.includes('aria-haspopup="dialog"')) {
          problems.push(`${where}: opener of ${v} has no aria-haspopup="dialog"`);
        }
        const expanded = [...opener.tag.matchAll(/aria-expanded=\{([^}]*)\}/g)].map((m) => m[1]);
        if (expanded.length === 0) {
          problems.push(`${where}: opener of ${v} has no aria-expanded={…}`);
          continue;
        }
        for (const expr of expanded) {
          if (!new RegExp(`\\b${v}\\b`).test(expr)) {
            problems.push(`${where}: aria-expanded={${expr}} does not reference the bound var ${v}`);
          }
          // A button rendered per {#each} item must discriminate by the item,
          // or every sibling reports expanded while one picker is open.
          for (const items of enclosingEachItems(text, opener.index)) {
            if (items.length === 0 || items.some((item) => new RegExp(`\\b${item}\\b`).test(expr))) continue;
            problems.push(
              `${where}: opener of ${v} renders per {#each} item but aria-expanded={${expr}} cannot tell the items apart — reference an item variable (${items.join(', ')}) (portal#2340 P3-1)`,
            );
          }
        }
      }
    }
    return { problems, unattributable };
  }

  function scan(): string[] {
    const problems: string[] = [];
    for (const path of sources(SRC)) {
      const text = readFileSync(path, 'utf8');
      const vars = [...new Set(boundVars(text, path, problems, components))];
      const { problems: opener, unattributable } = openerProblems(text, path, vars);
      problems.push(...opener);
      // #2267 file-level fallback, only for vars no button could be attributed to.
      if (unattributable.length > 0 && !text.includes('aria-haspopup="dialog"')) {
        problems.push(`${relative(SRC, path)}: no aria-haspopup="dialog"`);
      }
      for (const v of unattributable) {
        if (![...text.matchAll(/aria-expanded=\{([^}]*)\}/g)].some((m) => new RegExp(`\\b${v}\\b`).test(m[1]))) {
          problems.push(`${relative(SRC, path)}: ${v} has no aria-expanded={…} expression referencing it`);
        }
      }
    }
    return problems;
  }

  it('discovers the picker components', () => {
    // Guard against a vacuous pass: no components found would match nothing.
    expect(components.length).toBeGreaterThan(0);
    expect(components).toContain('SelectNode');
  });

  it('finds the picker sites', () => {
    // Guard against a vacuous pass: an empty walk (or a broken one that
    // flags everything) would correlate nothing.
    const problems: string[] = [];
    const sites = sources(SRC).filter((path) => boundVars(readFileSync(path, 'utf8'), path, problems, components).length > 0);
    expect(problems).toEqual([]);
    expect(sites.length).toBeGreaterThan(10);
  });

  it('every Select* opener button announces the dialog and its own open state', () => {
    expect(scan()).toEqual([]);
  });
});

describe('the scanner itself fails closed (portal#2340 BLIND P2s)', () => {
  const known = ['SelectNode'];
  const run = (text: string) => {
    const problems: string[] = [];
    const vars = boundVars(text, 'src/routes/x/+page.svelte', problems, known);
    return { vars, problems };
  };

  it('does not end a tag at a > inside an attribute expression', () => {
    const text = '<SelectNode disabled={count > 0} bind:open={picker} />';
    expect(tagSpan(text, 0)).toEqual({ end: text.length, selfClosed: true });
    expect(run(text)).toEqual({ vars: ['picker'], problems: [] });
  });

  it('does not end a tag at a > inside a quoted attribute value or arrow body', () => {
    expect(run('<SelectNode title="a > b" bind:open={picker} />').vars).toEqual(['picker']);
    expect(run('<SelectNode onpick={(n) => n.id > 0 && go(n)} bind:open={picker} />').vars).toEqual(['picker']);
  });

  it('sees the shorthand bind:open as a bound var named open', () => {
    expect(run('<SelectNode bind:open />')).toEqual({ vars: ['open'], problems: [] });
    expect(run('<SelectNode bind:open onpick={pick} />').vars).toEqual(['open']);
  });

  it('keeps refusing what it cannot correlate', () => {
    expect(run('<SelectNode bind:open={state.open} />').problems).toHaveLength(1);
    expect(run('<SelectNode bind:open={picker}></SelectNode>').problems).toHaveLength(1);
  });
});
