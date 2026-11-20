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
 * Correlation is by tag, not by a parser: each `<Select… />` tag is matched
 * lazily up to its self-closing `/>` (every picker instantiation in the repo
 * is self-closed; a `[^>]*` match would break on `=>` inside onselect), and
 * only that tag's `bind:open={X}` counts — neighbouring dialogs bound in the
 * same file (e.g. ApproveAllDialog beside a SelectOrg) are not picker openers.
 * Each bound X then requires `aria-expanded={X}` in the same file, and each
 * file with a bound picker requires at least one `aria-haspopup="dialog"`.
 * Test stubs and harnesses are out of scope.
 */
const SRC = fileURLToPath(new URL('..', import.meta.url));
const PICKER_TAG = /<Select(?:Agent|App|Memory|Node|Org|PublicAgent|User|Task)\b[\s\S]*?\/>/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.svelte$/.test(name) && !path.includes('/test/') && !path.includes('stub') ? [path] : [];
  });
}

/** The open-state variables bound to a Select* picker in this file. */
function pickerOpenVars(text: string): Set<string> {
  const vars = new Set<string>();
  for (const tag of text.matchAll(PICKER_TAG)) {
    for (const bound of tag[0].matchAll(/bind:open=\{(\w+)\}/g)) vars.add(bound[1]);
  }
  return vars;
}

describe('picker openers announce the dialog (portal#2267)', () => {
  it('finds the picker sites', () => {
    // Guard against a vacuous pass: an empty walk would match nothing.
    const sites = sources(SRC).filter((path) => pickerOpenVars(readFileSync(path, 'utf8')).size > 0);
    expect(sites.length).toBeGreaterThan(10);
  });

  it('every Select* open state is exposed by its opener as aria-expanded, with aria-haspopup="dialog"', () => {
    const missing: string[] = [];
    for (const path of sources(SRC)) {
      const text = readFileSync(path, 'utf8');
      const vars = pickerOpenVars(text);
      if (vars.size === 0) continue;
      if (!text.includes('aria-haspopup="dialog"')) {
        missing.push(`${relative(SRC, path)}: no aria-haspopup="dialog"`);
      }
      for (const v of vars) {
        if (!text.includes(`aria-expanded={${v}}`)) {
          missing.push(`${relative(SRC, path)}: ${v} has no aria-expanded={${v}} opener`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
