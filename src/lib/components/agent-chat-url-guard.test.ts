import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(
  fileURLToPath(new URL('./AgentChat.svelte', import.meta.url)),
  'utf8',
);

/**
 * #789 — a source-level invariant, and it needs a word of justification because
 * asserting on source is unusual.
 *
 * The fix for #789 is a `destroyed` guard inside `syncChatIdToUrl`, chosen over
 * five guards at five call sites so that the next call site someone adds is
 * covered for free. That choice is only sound while `syncChatIdToUrl` really is
 * the ONLY thing in this component that mutates the URL. A second
 * `replaceState` added elsewhere would bypass the guard silently — no type
 * error, no failing behavioural test, and the symptom (a URL rewritten on a
 * page the user already left) is invisible until someone reports something
 * inexplicable.
 *
 * The component's own behaviour is not reachable from this repo's component
 * tests: they use `render` from `svelte/server`, so `onMount` and `onDestroy`
 * never run and the teardown window this guards cannot be entered. Rather than
 * write a behavioural test that would pass with or without the fix — the exact
 * shape
 * `hrn:node:hadronmemory.com:hadron-portal:review:a-spare-test-must-reach-the-matcher`
 * warns about — this pins
 * the structural property the fix actually rests on.
 */
describe('AgentChat — the URL guard has exactly one place to live (#789)', () => {
  it('mutates the URL through a single replaceState call', () => {
    const calls = SOURCE.match(/\breplaceState\s*\(/g) ?? [];
    expect(calls).toHaveLength(1);
  });

  it('routes that one call through syncChatIdToUrl', () => {
    // The call must sit inside the guarded helper, not merely be unique. If it
    // moved out, the count above would still be 1 while the guard was bypassed.
    const helper = SOURCE.match(
      /function syncChatIdToUrl[\s\S]*?\n {2}}/,
    )?.[0];
    expect(helper, 'syncChatIdToUrl not found — was it renamed?').toBeDefined();
    expect(helper).toContain('replaceState(');
  });

  it('guards that helper on a destroyed flag set in onDestroy', () => {
    const helper = SOURCE.match(/function syncChatIdToUrl[\s\S]*?\n {2}}/)?.[0] ?? '';
    // The early return must precede the URL read: reading window.location on a
    // torn-down component is harmless, but acting on it is the bug.
    const guardAt = helper.indexOf('if (destroyed) return;');
    const urlReadAt = helper.indexOf('new URL(window.location.href)');
    expect(guardAt).toBeGreaterThan(-1);
    expect(urlReadAt).toBeGreaterThan(guardAt);

    expect(SOURCE).toMatch(/onDestroy\(\(\) => \{\s*destroyed = true;/);
  });
});
