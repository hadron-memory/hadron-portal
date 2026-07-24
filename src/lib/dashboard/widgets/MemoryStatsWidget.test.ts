import { describe, it, expect } from 'vitest';
import { render } from 'svelte/server';

import MemoryStatsWidget from './MemoryStatsWidget.svelte';

// #636: the Memory Stats widget renders the memory count + a "Create new"
// action. SSR-rendered (no DOM) — assert against the returned body markup.

describe('MemoryStatsWidget.svelte (#636)', () => {
  it('renders the count, a plural label, and a Create-new link', () => {
    const { body } = render(MemoryStatsWidget, {
      props: { memoryCount: 3, loadFailed: false },
    });
    expect(body).toContain('Memory Stats');
    expect(body).toContain('>3<');
    expect(body).toContain('memories');
    expect(body).toContain('href="/app/memories/new"');
    expect(body).toContain('Create new');
  });

  it('uses the singular label for a single memory', () => {
    const { body } = render(MemoryStatsWidget, {
      props: { memoryCount: 1, loadFailed: false },
    });
    expect(body).toContain('>1<');
    // The singular "memory" without the plural "memories".
    expect(body).toMatch(/>\s*memory\s*</);
  });

  it('shows a fallback message and still offers Create-new when the load failed', () => {
    const { body } = render(MemoryStatsWidget, {
      props: { memoryCount: 0, loadFailed: true },
    });
    expect(body).toContain("Couldn't load your memory count.");
    expect(body).toContain('href="/app/memories/new"');
  });
});
