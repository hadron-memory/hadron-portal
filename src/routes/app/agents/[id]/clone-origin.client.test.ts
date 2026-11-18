// #1335: the Agent detail page names where a clone came from. The origin is the
// server-emitted CURRENT URN of a source the viewer may read; null (and an
// absent field, on a list-shaped agent) is not a clone or not visible, and the
// server makes those indistinguishable, so the page renders NOTHING for them
// and asks nothing further (hrn:node:hadronmemory.com:specs:cor:dmo:050:18).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync } from 'svelte';
import Page from './+page.svelte';
import { pageData } from './page-fixture';
import { mountComponent, tick, type Mounted } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { setStubPage } from '$lib/test/stubs/app-stores';

const mounted: Mounted<any>[] = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); vi.restoreAllMocks(); });

const SOURCE = 'hrn:agent:example.com:source-agent';
const link = (root: HTMLElement, urn = SOURCE) => root.querySelector(`a[href="/app/u/${urn}"]`);
const originLines = (root: HTMLElement) => [...root.querySelectorAll('[data-testid="clone-origin"]')];

async function mountWith(agentOverride: Record<string, unknown>) {
  setStubPage('http://localhost/app/agents/clone');
  const props = reactiveProps({ data: await pageData('clone', null, agentOverride), form: null } as Record<string, unknown>);
  const m = mountComponent(Page as never, props as never); mounted.push(m); await tick(5);
  return { m, props };
}

describe('clone origin on the Agent detail page (#1335)', () => {
  it('shows the emitted URN as a resolver link, once', async () => {
    const { m } = await mountWith({ clonedFromAgentRef: SOURCE });
    expect(originLines(m.target)).toHaveLength(1);
    expect(originLines(m.target)[0].textContent).toContain('Cloned from');
    expect(link(m.target)).not.toBeNull();
  });

  it('renders nothing for null, undefined or empty, with no placeholder', async () => {
    for (const value of [null, undefined, '']) {
      const { m } = await mountWith({ clonedFromAgentRef: value });
      expect(originLines(m.target)).toHaveLength(0);
      expect(m.target.textContent).not.toMatch(/cloned from/i);
      expect(m.target.querySelector('a[href^="/app/u/hrn:agent:example.com"]')).toBeNull();
      mounted.pop()!.unmount();
    }
  });

  it('follows a changed emitted URN (a renamed source) and never keeps the old href', async () => {
    const { m, props } = await mountWith({ clonedFromAgentRef: SOURCE });
    const renamed = 'hrn:agent:example.com:renamed-agent';
    props.data = await pageData('clone', null, { clonedFromAgentRef: renamed });
    flushSync(); await tick(5);
    expect(link(m.target, renamed)).not.toBeNull();
    expect(link(m.target)).toBeNull();
  });

  it('turns a clone into a non-clone silently when the origin goes null', async () => {
    const { m, props } = await mountWith({ clonedFromAgentRef: SOURCE });
    props.data = await pageData('clone', null, { clonedFromAgentRef: null });
    flushSync(); await tick(5);
    expect(originLines(m.target)).toHaveLength(0);
  });

  it('makes no lookup for the origin, for a value or for null', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    await mountWith({ clonedFromAgentRef: SOURCE });
    await mountWith({ clonedFromAgentRef: null });
    expect(spy).not.toHaveBeenCalled();
  });

  it('keeps the link on the resolver route, as the URN chip links everywhere else', async () => {
    const { m } = await mountWith({ clonedFromAgentRef: SOURCE });
    const anchors = [...originLines(m.target)[0].querySelectorAll('a')];
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute('href')).toBe(`/app/u/${SOURCE}`);
  });
});
