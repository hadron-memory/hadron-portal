/**
 * #417 — the Usage tab carries no "Usage events" caption above the toolbar.
 *
 * The tab itself is already labelled "Usage" (memory-detail.tab.usage), so an
 * h2 repeating "Usage events" named nothing new — build-portal-ui ground rule
 * 3: if removing a heading loses nothing, remove it. Pinned in both
 * directions so a copy tweak cannot quietly bring a caption back: the
 * heading is gone AND the pane controls that shared its row still render.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const EVENTS = [
  {
    id: 'ue-1',
    type: 'read',
    nodeLoc: 'a/b',
    appId: null,
    sessionId: null,
    model: 'claude',
    tokensIn: 10,
    tokensOut: 5,
    createdAt: '2026-06-01T00:00:00Z',
  },
];

function body() {
  return render(Page, {
    props: {
      data: {
        graph: { id: 'mem-1', name: 'Notes' },
        events: EVENTS,
      } as never,
    },
  }).body;
}

describe('memory Usage tab markup (#417)', () => {
  it('has no "Usage events" caption (the tab is already labelled Usage)', () => {
    expect(body()).not.toContain('Usage events');
  });

  it('still renders the Table | Chart pane controls', () => {
    const html = body();
    expect(html).toContain('>Table</button>');
    expect(html).toContain('>Chart</button>');
  });
});
