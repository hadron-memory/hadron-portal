/**
 * portal#1654 items 4 and 6 — the definition section's heading, and a
 * stale-response guard: an answer for another App or page is not drawn under
 * the controls of this one (the App view already had one; this section had none).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import DefinitionRegisterSection from './DefinitionRegisterSection.svelte';
import { resetStubPage, setStubPage } from '$lib/test/stubs/app-stores';

const app = { id: 'app-1', name: 'Team', urn: 'hrn:app:acme.com:team' };
const entry = { code: 'build.ready', state: 'MAPPED', taskLoc: 'tasks:build', taskUrn: 'hrn:node:acme.com:base:tasks:build', definedBy: null };
const agent = { id: 'g1', name: 'Builder', urn: 'hrn:agent:acme.com:builder' };
const ready = (key: string) => ({
  kind: 'ready', apps: [app], app, appId: app.id, limit: 20, offset: 0, definitionUrn: entry.taskUrn, key,
  index: { kind: 'ok', page: { entries: [entry], total: 1, hasMore: false } },
});
const draw = (key: string, search: string) => {
  setStubPage(`http://localhost/app/agents/g1/definitions/tasks%3Abuild${search}`);
  return render(DefinitionRegisterSection as never, { props: { register: ready(key), agent, basePath: '/app/agents/g1/definitions/tasks%3Abuild' } as never }).body;
};
afterEach(() => resetStubPage());

describe('definition section', () => {
  it('headed "Codes that send work to this task"', () => {
    const out = draw('app-1|20|0', '?app=app-1');
    expect(out).toContain('Codes that send work to this task');
    expect(out).not.toContain('Codes for this task loc');
  });
  it('draws the answer when it is for the URL being shown', () => {
    const out = draw('app-1|20|0', '?app=app-1');
    expect(out).toContain('build.ready');
    expect(out).not.toContain('Loading…');
  });
  it.each([
    ['another page', '?app=app-1&offset=20'],
    ['another limit', '?app=app-1&limit=50'],
    ['another App', '?app=app-2'],
  ])('does not draw an answer for %s under this URL', (_n, search) => {
    const out = draw('app-1|20|0', search);
    expect(out).not.toContain('build.ready');
    expect(out).toContain('Loading…');
  });
});
