import { describe, expect, it } from 'vitest';
import { COMPILED_BOOT_PROMPT_TYPE, COMPILED_PROMPT_HINT_ID } from './compiled-boot-prompt';

// portal#1903: the one definition is what the page and its fixtures share, so the VALUE is pinned here against the
// server's node type, not derived from either side.
describe('compiled boot prompt constants', () => {
  it('names the server node type and the hint id the read-only fields point at', () => {
    expect(COMPILED_BOOT_PROMPT_TYPE).toBe('compiled-boot-prompt');
    expect(COMPILED_PROMPT_HINT_ID).toBe('compiled-prompt-hint');
  });
});
