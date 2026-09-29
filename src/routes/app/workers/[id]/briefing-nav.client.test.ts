/**
 * #1010 / @codex on #857 — the briefing editor must re-seed when the worker
 * changes under a reused component.
 *
 * CLIENT lane, and it has to be: the defect lives entirely in the component
 * lifecycle. SvelteKit reuses this component across /app/workers/A →
 * /app/workers/B (the page's own comment says so, citing #251), and the
 * Superforms store is seeded ONCE from the initial data. Left unreset, it holds
 * A's override while the route posts to B — so Save writes one worker's
 * individuality onto another, with nothing on screen looking wrong.
 *
 * A server render never mounts, so the `node` lane cannot see any of this.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { flushSync } from 'svelte';
import { superValidate } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { mountComponent } from '$lib/test/mountComponent';
import { setStubPage } from '$lib/test/stubs/app-stores';
import { navigationGuards, resetNavigationGuards } from '$lib/test/stubs/app-navigation';
import { updateBriefingSchema } from './schema';
import Page from './+page.svelte';

function worker(id: string, promptOverride: string | null) {
  return {
    id,
    appId: 'app-1',
    agentId: 'agent-1',
    name: id === 'w-a' ? 'Ada' : 'Dara',
    slug: id === 'w-a' ? 'ada' : 'dara',
    urn: `hrn:worker:hadronmemory.com:team:${id}`,
    role: 'engineer',
    promptOverride,
    prompt: `BOUND TEMPLATE FOR ${id}${promptOverride ? `\n\n${promptOverride}` : ''}`,
    memoryId: null,
    retiredAt: null,
    heldByUserId: null,
    heldAt: null,
    createdAt: '1789430400000',
    agent: { id: 'agent-1', name: 'Engineer', urn: 'hrn:agent:x:engineer', systemPrompt: 'You are {{name}}.' },
    app: { id: 'app-1', name: 'Team', urn: 'hrn:app:x:team', organizationId: 'org-1' },
  };
}

async function dataFor(w: ReturnType<typeof worker>) {
  return {
    worker: w,
    briefingForm: await superValidate(
      { promptOverride: w.promptOverride ?? '' },
      zod4(updateBriefingSchema),
      { errors: false },
    ),
    initialTab: 'briefing',
    initialView: 'source',
    workerSessions: [],
    sessionsTruncated: false,
    worklog: [],
    worklogTotal: 0,
  };
}

function overrideBox(target: HTMLElement): HTMLTextAreaElement {
  const el = target.querySelector('textarea#promptOverride');
  if (!el) throw new Error('the override editor is not on screen');
  return el as HTMLTextAreaElement;
}

/** Open the Source view, where the override editor lives. */
function openSource(target: HTMLElement) {
  const btn = [...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Source');
  if (!btn) throw new Error('no Source toggle');
  btn.click();
  flushSync();
}

/** Fire every recorded afterNavigate callback, as a real navigation would. */
function fireAfterNavigate() {
  for (const g of navigationGuards) {
    if (g.fn === 'afterNavigate') (g.callback as (nav: unknown) => void)({ type: 'link' });
  }
  flushSync();
}

beforeEach(() => {
  resetNavigationGuards();
  setStubPage('https://example.test/app/workers/w-a?tab=briefing', { id: 'w-a' });
});

describe('#1010 — the no-JS path keeps its view (@codex/@copilot on #857)', () => {
  it('shows the agent system prompt as the inherited Source template (#1241)', async () => {
    const mounted = mountComponent(Page as never, { data: await dataFor(worker('w-a', 'X')) } as never);
    try {
      openSource(mounted.target);
      expect(mounted.target.textContent).toContain('You are {{name}}.');
      expect(overrideBox(mounted.target).value).toBe('X');
    } finally {
      mounted.unmount();
    }
  });

  it('the form action carries tab and view, not just the action name', async () => {
    const mounted = mountComponent(Page as never, { data: await dataFor(worker('w-a', 'X')) } as never);
    try {
      openSource(mounted.target);
      const action = mounted.target.querySelector('form[method="POST"]')?.getAttribute('action') ?? '';
      // A bare `?/updateBriefing` replaces the query string, so a JS-off submit
      // lands on Profile/Rendered — and a failure leaves the preserved text and
      // the error in a panel that reader can no longer see.
      expect(action).toContain('tab=briefing');
      expect(action).toContain('view=source');
      expect(action).toContain('/updateBriefing');
    } finally {
      mounted.unmount();
    }
  });
});

describe('#1010 — an unsaved draft is not discarded silently', () => {
  it('registers a beforeNavigate guard, the only moment the reader can still cancel', async () => {
    // `afterNavigate` re-seeds the editor, and by then the navigation has
    // already happened. Superforms' tainted guard runs on `beforeNavigate`,
    // which is why the option — not a bigger afterNavigate — is the fix.
    const mounted = mountComponent(Page as never, { data: await dataFor(worker('w-a', 'X')) } as never);
    try {
      expect(navigationGuards.some((g) => g.fn === 'beforeNavigate')).toBe(true);
    } finally {
      mounted.unmount();
    }
  });
});

describe('#1010 — the briefing editor re-seeds when the worker changes', () => {
  it('shows the NEW worker’s override after a worker-to-worker navigation', async () => {
    const mounted = mountComponent(Page as never, { data: await dataFor(worker('w-a', 'ADA-ONLY TEXT')) } as never);
    try {
      openSource(mounted.target);
      expect(overrideBox(mounted.target).value).toBe('ADA-ONLY TEXT');

      // The navigation: new loader data, SAME component instance.
      (mounted.props as { data: unknown }).data = await dataFor(worker('w-b', 'DARA-ONLY TEXT'));
      fireAfterNavigate();

      // A navigation also drops back to Rendered — the same reset the node page
      // does when its node changes — so reopen Source exactly as a reader would.
      openSource(mounted.target);
      const box = overrideBox(mounted.target);
      // The assertion that matters is the NEGATIVE one: Ada's text reaching a
      // form that posts to Dara's route is the bug, and it is silent.
      expect(box.value).not.toBe('ADA-ONLY TEXT');
      expect(box.value).toBe('DARA-ONLY TEXT');
    } finally {
      mounted.unmount();
    }
  });

  it('clears a previous worker’s SAVE RESULT, not just its text', async () => {
    // @codex on #857: reusing the instance for worker B under A's "Override
    // saved" banner asserts something about a worker it never touched.
    //
    // The banner is driven through the ACTION-RESULT path (@copilot's other
    // finding on the same commit), so this exercises both fixes at once: the
    // form prop seeds the message, and afterNavigate must clear it.
    const posted = await superValidate(
      { promptOverride: 'ADA-ONLY TEXT' },
      zod4(updateBriefingSchema),
      { errors: false },
    );
    const mounted = mountComponent(Page as never, {
      data: await dataFor(worker('w-a', 'ADA-ONLY TEXT')),
      form: { form: { ...posted, message: { type: 'success', text: 'Override saved.' } } },
    } as never);
    try {
      openSource(mounted.target);
      const before = [...mounted.target.querySelectorAll('[role="status"]')].map((e) => e.textContent);
      expect(before.some((txt) => txt?.includes('Override saved'))).toBe(true);

      (mounted.props as { data: unknown }).data = await dataFor(worker('w-b', 'DARA-ONLY TEXT'));
      fireAfterNavigate();
      openSource(mounted.target);

      const after = [...mounted.target.querySelectorAll('[role="status"]')].map((e) => e.textContent);
      expect(after.some((txt) => txt?.includes('Override saved'))).toBe(false);
    } finally {
      mounted.unmount();
    }
  });

  it('clears the editor when the new worker has no override', async () => {
    // The emptier direction of the same fault: navigating from a worker WITH an
    // override to one without must not leave the first worker's text in a box
    // whose Save button now points at the second.
    const mounted = mountComponent(Page as never, { data: await dataFor(worker('w-a', 'ADA-ONLY TEXT')) } as never);
    try {
      openSource(mounted.target);
      (mounted.props as { data: unknown }).data = await dataFor(worker('w-b', null));
      fireAfterNavigate();
      openSource(mounted.target);

      expect(overrideBox(mounted.target).value).toBe('');
    } finally {
      mounted.unmount();
    }
  });
});
