/**
 * portal#2344 / #2377: the section's "Loading…" line (an answer for another App/page is pending)
 * is a persistent LiveRegion: empty while the answer matches the URL, holding the text while it
 * does not, and the same element once the matching answer lands. The `$app/state` stub is not
 * reactive, so the URL is set once before mount and the loader's answer (the `register` prop) moves.
 */
import { afterEach, expect, it } from 'vitest';
import { mountComponent, tick } from '$lib/test/mountComponent';
import { reactiveProps } from '$lib/test/reactiveProps.svelte';
import { announcedStatusRegion } from '$lib/test/firstPopulatedStatusText';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';
import DefinitionRegisterSection from './DefinitionRegisterSection.svelte';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team' };
const entry = { code: 'build.ready', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: 'hrn:node:acme.com:base:tasks:build', definedBy: null };
const agent = { id: 'g1', name: 'Builder', urn: 'hrn:agent:acme.com:builder' };
const ready = (key: string) => ({
  kind: 'ready', apps: [app], app, appId: app.id, limit: 20, offset: 0, definitionUrn: entry.taskUrn, key,
  index: { kind: 'ok', page: { entries: [entry], total: 1, hasMore: false } },
});
const mounted: Array<{ unmount: () => void }> = [];
afterEach(() => { while (mounted.length) mounted.pop()!.unmount(); resetStubPage(); });

it('the loading region is empty before, holds the text during, and is the same element after', async () => {
  setStubPage('http://localhost/app/agents/g1/definitions/tasks%3Abuild?app=app-1');
  const props = reactiveProps({ register: ready('app-1|20|0'), agent, basePath: '/app/agents/g1/definitions/tasks%3Abuild' } as Record<string, unknown>);
  const m = mountComponent(DefinitionRegisterSection as never, props as never);
  mounted.push(m);
  await tick(3);

  // The section has two persistent regions (the Agent-unavailable note, then this loading/not-available one):
  // the loading line lives in the last.
  const loadingRegion = () => [...m.target.querySelectorAll<HTMLElement>('[role="status"]')].at(-1) ?? null;
  const region = loadingRegion();
  expect(region, 'the region exists while the answer matches').not.toBeNull();
  expect(region!.textContent?.trim()).toBe(''); // BEFORE
  expect(m.target.textContent).toContain('build.ready');

  props.register = ready('app-2|20|0'); // an answer for another App: stale under this URL
  await tick(3);
  expect(announcedStatusRegion(m.target)).toBe(region); // DURING
  expect(region!.textContent?.trim()).toBe('Loading…');

  props.register = ready('app-1|20|0');
  await tick(3);
  expect(loadingRegion()).toBe(region); // AFTER
  expect(region!.isConnected).toBe(true);
  expect(region!.textContent?.trim()).toBe('');
});

// portal#2376: Tailwind 4 space-y puts the margin on the sibling BEFORE a non-last child, so an empty last region
// would leave one spacing unit of trailing space. The last region cancels it only while it is empty and last.
it('the last region cancels the space-y unit it would otherwise leave when empty', async () => {
  setStubPage('http://localhost/app/agents/g1/definitions/tasks%3Abuild?app=app-1');
  const m = mountComponent(DefinitionRegisterSection as never, reactiveProps({ register: ready('app-1|20|0'), agent, basePath: '/app/agents/g1/definitions/tasks%3Abuild' } as Record<string, unknown>) as never);
  mounted.push(m);
  await tick(3);
  const last = [...m.target.querySelectorAll<HTMLElement>('[role="status"]')].at(-1)!;
  expect(last.className).toContain('last:empty:-mt-3');
});
